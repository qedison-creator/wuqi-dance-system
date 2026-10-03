/* 存量迁移：按天口径规则从「占天」改为「缩有效期」（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 背景：2026-10 规则重构——不限次卡/每日1节卡扣 N(N≥2) 课时的课，不再"占用 N 个日期"，
 * 改为预约时直接把套餐 end_date 缩短 N 天（取消时加回）。旧规则的历史数据清理与展示回填：
 *   1. 清除全部 Booking.occupied_dates（旧规则死数据，新代码不再读写）
 *   2. 给按天口径时间卡（不限次/每日1节）的历史预约回填 shrink_days = credits_deducted（N≥2 才标记）
 *   3. 历史套餐 end_date 不追溯缩短（按售卖口径保留；确认过的决策）
 *
 * 幂等：可重复执行；shrink_days 已有的预约跳过不改。
 *
 * 用法（脚本自动读后端根目录 .env，也可显式传 MONGODB_URI 覆盖）：
 *  node scripts/migrate-shrink-days.js            # 预览
 *  node scripts/migrate-shrink-days.js --apply    # 写库
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const APPLY = process.argv.includes('--apply');

/**
 * 执行迁移逻辑（供 CLI 与冒烟脚本共用）
 * @param {Object} opts
 * @param {boolean} opts.apply - true 写库，false 仅统计
 * @returns {Promise<Object>} { clearCandidates, clearedOcc, targetPackages, backfillCandidates, statusDist, backfilled, skippedOneCredit }
 */
async function runMigration({ apply = false } = {}) {
  const Booking = require('../src/models/Booking');
  const UserPackage = require('../src/models/UserPackage');

  const result = {
    clearCandidates: 0, clearedOcc: 0,
    targetPackages: 0, backfillCandidates: 0, statusDist: {}, backfilled: 0,
    skippedOneCredit: 0,
  };

  // ---- [1] 清除旧规则的 occupied_dates ----
  // 注意：该字段已从 Booking schema 移除，必须用原生驱动 $unset——
  // mongoose updateMany 对 schema 外字段会静默剥离操作符（matched/modified 照报但字段不清）
  result.clearCandidates = await Booking.collection.countDocuments({ occupied_dates: { $exists: true, $nin: [null, []] } });
  if (apply && result.clearCandidates > 0) {
    const r = await Booking.collection.updateMany({ occupied_dates: { $exists: true } }, { $unset: { occupied_dates: '' } });
    result.clearedOcc = r.modifiedCount;
  }

  // ---- [2] 回填 shrink_days ----
  // 按天口径时间卡：无任何周期限制（不限次）或仅 daily_limit=1（每天1节），与 checkTimeCardLimit 口径一致
  const timeCards = await UserPackage.find({ package_type: 'time_card' }).select('daily_limit weekly_limit monthly_limit');
  const targetPkgIds = timeCards
    .filter(p => (!p.daily_limit && !p.weekly_limit && !p.monthly_limit) || (p.daily_limit === 1 && !p.weekly_limit && !p.monthly_limit))
    .map(p => p._id);
  result.targetPackages = targetPkgIds.length;

  const candidates = await Booking.find({
    user_package_id: { $in: targetPkgIds },
    credits_deducted: { $gte: 2 },
    shrink_days: { $in: [null, undefined] },
  }).select('credits_deducted status');
  result.backfillCandidates = candidates.length;
  candidates.forEach(b => { result.statusDist[b.status] = (result.statusDist[b.status] || 0) + 1; });

  if (apply && candidates.length > 0) {
    for (const b of candidates) {
      await Booking.updateOne({ _id: b._id }, { $set: { shrink_days: b.credits_deducted } });
    }
    result.backfilled = candidates.length;
  }

  // ---- [3] 1课时预约统计（新规则不缩期、不标记）----
  result.skippedOneCredit = await Booking.countDocuments({
    user_package_id: { $in: targetPkgIds },
    credits_deducted: 1,
    shrink_days: { $in: [null, undefined] },
  });

  return result;
}

async function main() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`[migrate] 数据库: ${db.databaseName}  模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览，加 --apply 执行）'}`);

  const r = await runMigration({ apply: APPLY });

  console.log('\n===== 迁移汇总 =====');
  console.log(`[1] 旧"占天"字段 occupied_dates 待清除: ${r.clearCandidates} 条${APPLY ? `，已清除 ${r.clearedOcc} 条` : ''}`);
  console.log(`[2] 按天口径套餐: ${r.targetPackages} 个，需回填 shrink_days 的预约: ${r.backfillCandidates} 条`);
  console.log(`    按状态分布: ${JSON.stringify(r.statusDist)}${APPLY ? `，已回填 ${r.backfilled} 条` : ''}`);
  console.log(`[3] 1课时历史预约（不缩期、不标记）: ${r.skippedOneCredit} 条`);
  console.log('    历史套餐 end_date 不追溯缩短（按售卖口径保留）。');
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
