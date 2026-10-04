/* 存量迁移：时间卡按天口径「历史缩期追溯」（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 背景：V1.1.6 起，「不限次卡 / 每天1节卡」上扣 N(N≥2) 课时的课，改为预约时直接把套餐
 *   end_date 缩短 N 天（取消时加回）。而 migrate-shrink-days.js 当时只给历史预约回填了
 *   shrink_days（供上课记录展示缩期信息），按当时决策未追溯缩短 end_date。
 *   于是出现不一致：上课记录显示缩期 N 天，会员详情页套餐截止日期却还是录入原值；
 *   且这些历史预约一旦被取消，restoreTimeCardShrink 会把 end_date 错误加回 N 天。
 *
 * 本脚本：把改版前（created_at < --before）且未取消（booked/completed）的历史预约，
 *   按其 shrink_days 之和，一次性追溯缩短对应按天口径套餐的 end_date，使数据与展示一致。
 *
 * 分界（--before）：为防止"改版后已缩期的预约被二次缩短"的安全线。默认取 V1.1.6 提交时间
 *   2026-10-03T21:32:18+08:00（早于实际上线时间）。该分界只会导致极少量"改版前已预约但
 *   尚未进入新规则"的预约漏缩，绝不会发生重复缩短——方向安全。
 *
 * 幂等：按套餐维度写 UserPackage.retro_shrink_applied_days 标记（与 end_date 同一次原子更新），
 *   重跑时跳过已处理套餐。
 *
 * 口径（与 checkTimeCardLimit / migrate-shrink-days 一致）：
 *   按天口径 = time_card 且 (无任何周期限制) 或 (仅 daily_limit=1)
 *   仅统计未取消预约（booked/completed）且 shrink_days ≥ 2
 *   「每周X次 / 每月X次」等周期限制卡走课时口径、不缩有效期，其预约无 shrink_days，天然不在此列
 *   已取消预约（cancelled）从未缩期、也从未恢复，保持不处理
 *
 * 用法（脚本自动读后端根目录 .env，也可显式传 MONGODB_URI 覆盖）：
 *   node scripts/migrate-timecard-retro-shrink.js                           # 预览
 *   node scripts/migrate-timecard-retro-shrink.js --apply                   # 写库
 *   node scripts/migrate-timecard-retro-shrink.js --before "2026-10-03T21:32:18+08:00"
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BEIJING_TZ = 'Asia/Shanghai';

const APPLY = process.argv.includes('--apply');
const DEFAULT_BEFORE = '2026-10-03T21:32:18+08:00';
const DETAIL_LIMIT = 50;

// 北京时间口径取日（与 booking.service 的 bjDate 一致）
function bjDate(value) {
  return dayjs(value).tz(BEIJING_TZ);
}

function resolveCutoff(argv) {
  const i = argv.indexOf('--before');
  const raw = i >= 0 ? argv[i + 1] : DEFAULT_BEFORE;
  const d = dayjs(raw);
  if (!d.isValid()) throw new Error(`--before 时间无效: ${raw}`);
  return d.toDate();
}

/**
 * 执行迁移逻辑（供 CLI 与冒烟脚本共用）
 * @param {Object} opts
 * @param {boolean} opts.apply  - true 写库，false 仅统计
 * @param {Date}    opts.before - 改版上线时间分界（created_at 早于此的预约视为改版前）
 * @returns {Promise<Object>} 迁移汇总
 */
async function runMigration({ apply = false, before } = {}) {
  const Booking = require('../src/models/Booking');
  const UserPackage = require('../src/models/UserPackage');

  const cutoff = before || resolveCutoff(process.argv);

  // ---- [1] 按天口径时间卡套餐（尚未追溯过的）----
  const timeCards = await UserPackage.find({
    package_type: 'time_card',
    $or: [
      { daily_limit: null, weekly_limit: null, monthly_limit: null },
      { daily_limit: 1, weekly_limit: null, monthly_limit: null },
    ],
  }).select('daily_limit weekly_limit monthly_limit end_date retro_shrink_applied_days member_snapshot');

  const pendingPkgs = timeCards.filter(p => p.retro_shrink_applied_days === undefined || p.retro_shrink_applied_days === null);
  const pkgById = new Map(pendingPkgs.map(p => [String(p._id), p]));

  // ---- [2] 改版前、未取消、shrink_days ≥ 2 的历史预约 ----
  const candidates = pendingPkgs.length === 0 ? [] : await Booking.find({
    user_package_id: { $in: pendingPkgs.map(p => p._id) },
    status: { $in: ['booked', 'completed'] },
    shrink_days: { $gte: 2 },
    created_at: { $lt: cutoff },
  }).select('user_package_id shrink_days created_at status');

  // ---- [3] 按套餐汇总缩期天数 ----
  const daysByPkg = new Map();
  candidates.forEach(b => {
    const key = String(b.user_package_id);
    daysByPkg.set(key, (daysByPkg.get(key) || 0) + (b.shrink_days || 0));
  });

  const result = {
    cutoff,
    targetPackages: timeCards.length,
    alreadyDonePackages: timeCards.length - pendingPkgs.length,
    candidateBookings: candidates.length,
    affectedPackages: 0,
    totalDays: 0,
    appliedPackages: 0,
    skippedNoEndDate: 0,
    details: [],
  };

  for (const [pkgId, totalDays] of daysByPkg.entries()) {
    if (!totalDays || totalDays <= 0) continue;
    const pkg = pkgById.get(pkgId);
    if (!pkg) continue;
    if (!pkg.end_date) { result.skippedNoEndDate += 1; continue; }

    const oldEnd = pkg.end_date;
    const newEnd = bjDate(oldEnd).subtract(totalDays, 'day').endOf('day').toDate();

    result.affectedPackages += 1;
    result.totalDays += totalDays;
    if (result.details.length < DETAIL_LIMIT) {
      result.details.push({
        package_id: String(pkg._id),
        member: pkg.member_snapshot ? (pkg.member_snapshot.real_name || pkg.member_snapshot.nick_name || '') : '',
        days: totalDays,
        old_end: bjDate(oldEnd).format('YYYY-MM-DD'),
        new_end: bjDate(newEnd).format('YYYY-MM-DD'),
      });
    }

    if (apply) {
      // 乐观锁 + 标记写入同一次原子更新：并发/重复执行都不会二次缩期
      const res = await UserPackage.updateOne(
        {
          _id: pkg._id,
          end_date: oldEnd,
          $or: [
            { retro_shrink_applied_days: { $exists: false } },
            { retro_shrink_applied_days: null },
          ],
        },
        { $set: { end_date: newEnd, retro_shrink_applied_days: totalDays } }
      );
      if (res.modifiedCount === 1) result.appliedPackages += 1;
    }
  }

  return result;
}

async function main() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`[migrate] 数据库: ${db.databaseName}  模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览，加 --apply 执行）'}`);

  const r = await runMigration({ apply: APPLY });

  console.log('\n===== 追溯缩期汇总 =====');
  console.log(`分界时间（早于此视为改版前）: ${dayjs(r.cutoff).tz(BEIJING_TZ).format('YYYY-MM-DD HH:mm:ss')}（北京时间）`);
  console.log(`按天口径套餐: ${r.targetPackages} 个（已追溯过跳过: ${r.alreadyDonePackages} 个）`);
  console.log(`待处理历史预约（未取消、shrink_days≥2、改版前）: ${r.candidateBookings} 条`);
  console.log(`受影响套餐: ${r.affectedPackages} 个，合计缩短 ${r.totalDays} 天${APPLY ? `，成功写库 ${r.appliedPackages} 个` : ''}`);
  if (r.skippedNoEndDate > 0) console.log(`跳过（无截止日）: ${r.skippedNoEndDate} 个`);
  if (r.details.length > 0) {
    console.log(`\n明细（最多展示 ${DETAIL_LIMIT} 条）:`);
    r.details.forEach(d => {
      console.log(`  ${d.member || '(无姓名)'}  套餐 ${d.package_id}  -${d.days}天  ${d.old_end} -> ${d.new_end}`);
    });
    if (r.affectedPackages > r.details.length) console.log(`  ... 其余 ${r.affectedPackages - r.details.length} 个套餐略`);
  }
  if (!APPLY) console.log('\n预览完成。确认无误后加 --apply 执行写库。');

  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[migrate] 执行失败:', err);
    process.exit(1);
  });
}

exports.runMigration = runMigration;