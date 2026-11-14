/* 存量纠偏：历史"赠课卡优先扣次"改为"主卡优先"（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 背景：2026-11-13 之前的选卡排序是赠课卡优先（is_bonus 排最前），导致同时持有
 * 主次卡+赠课卡的会员，历史预约扣次可能先扣了赠课卡。新规则已改为先主卡、赠课殿后。
 * 本脚本把"新规则下本应扣主卡"的历史预约挪回主卡：
 *   1. booking.user_package_id / package_name 改指主卡（取消退还逻辑自动跟随，无需另改）
 *   2. 主卡 remaining_credits 扣减 N 次、赠课卡 remaining_credits 加回 N 次
 *
 * 纠偏资格（复刻 booking.service.js 新选卡规则的过滤条件）：
 *   - booking 扣的是赠课卡（user_package_id → is_bonus=true 且 count_card），credits_deducted>0，
 *     status ∈ booked/completed（cancelled 的扣退已抵消，净额为零，不处理）
 *   - 存在主卡（非赠课 count_card，未作废）满足：门店匹配、有效期覆盖课程日期、
 *     舞种匹配、可用星期匹配、可用时段匹配
 *   - 主卡"当时"剩余次数足够：按当前余额 + 该主卡在此预约之后产生的扣次倒推
 *     （人工变更/赠送无法精确还原，以 dry-run 预览明细人工把关）
 *   - 无合格主卡 → 跳过（属合法的兜底消耗，如当时主卡已扣完/过期/舞种不符）
 *
 * 幂等：纠偏后 booking 已改挂主卡，重跑不会再命中；跳过的记录条件不变仍跳过。
 *
 * 用法（脚本自动读后端根目录 .env，也可显式传 MONGODB_URI 覆盖）：
 *  node scripts/fix-bonus-first-deduction.js            # 预览
 *  node scripts/fix-bonus-first-deduction.js --apply    # 写库
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const APPLY = process.argv.includes('--apply');

// 新规则（先主卡）的上线时间；仅纠偏此之前创建的预约，之后的数据由新代码保证顺序
const NEW_RULE_CUTOFF = new Date('2026-11-13T17:31:00+08:00');

// —— 以下过滤条件与 booking.service.js 口径一致 ——
const bjYmd = (d) => new Date(new Date(d).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const toMinutes = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// 有效期覆盖课程日期（pkgCoversDate 口径：仅校验 end_date，到期日当天全天有效）
function coversDate(pkg, dateStr) {
  if (!pkg.end_date || !dateStr) return true;
  return bjYmd(pkg.end_date) >= String(dateStr).slice(0, 10);
}

// 舞种匹配（packageMatchesDanceStyle 口径：空限制=不限）
function matchesDance(pkg, danceId) {
  if (!danceId) return true;
  const limit = pkg.dance_style_limit || [];
  if (limit.length === 0) return true;
  const target = String(danceId);
  return limit.some(id => String(id) === target);
}

// 可用星期匹配（packageMatchesWeekday 口径：空限制=整周可用，0=周日）
function matchesWeekday(pkg, dateStr) {
  const limit = pkg.weekday_limit || [];
  if (limit.length === 0 || !dateStr) return true;
  const day = new Date(`${String(dateStr).slice(0, 10)}T00:00:00+08:00`).getUTCDay();
  return limit.includes(day);
}

// 可用时段匹配（packageMatchesTimeWindow 口径：双边界独立，边界含等于）
function matchesTimeWindow(pkg, startTime) {
  const b = pkg.usable_before || '';
  const a = pkg.usable_after || '';
  if (!b && !a) return true;
  if (!startTime) return true;
  const start = toMinutes(startTime);
  const bMin = b ? toMinutes(b) : null;
  const aMin = a ? toMinutes(a) : null;
  if (bMin !== null && aMin !== null) return start <= bMin || start >= aMin;
  if (bMin !== null) return start <= bMin;
  if (aMin !== null) return start >= aMin;
  return true;
}

// 门店匹配（预约入口过滤口径：本店或跨店授权）
function matchesStore(pkg, storeId) {
  if (!storeId) return true;
  const target = String(storeId);
  if (String(pkg.store_id) === target) return true;
  return (pkg.extra_store_ids || []).some(s => String(s) === target);
}

// booking.package_name 快照（packageLabel.buildPackageFields 口径：取 package_snapshot.name）
function pkgSnapshotName(pkg) {
  return (pkg.package_snapshot && pkg.package_snapshot.name) || '';
}
// 明细显示用主卡名（含 remark 兜底，仅用于预览可读性）
function pkgDisplayName(pkg) {
  return pkgSnapshotName(pkg) || pkg.remark || '次卡';
}

/**
 * 执行纠偏逻辑（供 CLI 与冒烟脚本共用）
 * @param {Object} opts
 * @param {boolean} opts.apply - true 写库，false 仅预览
 * @returns {Promise<Object>} 统计结果
 */
async function runMigration({ apply = false } = {}) {
  const Booking = require('../src/models/Booking');
  const UserPackage = require('../src/models/UserPackage');

  const result = {
    candidates: 0, corrected: 0, skippedNoMain: 0, skippedNoEligible: 0,
    details: [], byMember: {},
  };

  // [1] 取全部赠课次卡，逐会员归组其赠课卡扣次预约（按创建时间升序，保证"当时余额"倒推正确）
  const bonusPkgs = await UserPackage.find({ is_bonus: true, package_type: 'count_card' })
    .select('user_id remaining_credits package_snapshot.name member_snapshot');
  const bonusIds = bonusPkgs.map(p => p._id);
  if (bonusIds.length === 0) return result;

  const bonusById = new Map(bonusPkgs.map(p => [String(p._id), p]));

  // 会员全部历史扣次预约（含挂主卡的），用于倒推主卡"当时余额"；cancelled 净额为零不参与
  const bookings = await Booking.find({
    user_package_id: { $in: bonusIds },
    credits_deducted: { $gt: 0 },
    status: { $in: ['booked', 'completed'] },
    created_at: { $lt: NEW_RULE_CUTOFF },
  }).select('user_id user_package_id package_name credits_deducted status created_at dance_style_id store_id schedule_date schedule_start_time course_name');

  if (bookings.length === 0) return result;
  const userIds = [...new Set(bookings.map(b => String(b.user_id)))];

  // [2] 每个会员：主卡集合 + 全部有效扣次预约（正序），逐条候选纠偏
  const userMains = await UserPackage.find({
    user_id: { $in: userIds },
    is_bonus: { $ne: true },
    package_type: 'count_card',
    status: { $ne: 'voided' }, // 作废卡不作为纠偏目标
  }).select('user_id remaining_credits end_date dance_style_limit weekday_limit usable_before usable_after store_id extra_store_ids is_suspended status remark package_snapshot.name member_snapshot');

  // 会员全部有效扣次预约（含挂主卡/赠课卡），按创建时间升序（供"当时余额"倒推）
  const allUserBookings = await Booking.find({
    user_id: { $in: userIds },
    credits_deducted: { $gt: 0 },
    status: { $in: ['booked', 'completed'] },
  }).select('user_id user_package_id credits_deducted status created_at').sort({ created_at: 1 }).lean();

  const mainsByUser = new Map();
  userMains.forEach(p => {
    const k = String(p.user_id);
    if (!mainsByUser.has(k)) mainsByUser.set(k, []);
    mainsByUser.get(k).push(p);
  });

  // 主卡"当时"余额 = 当前余额 + 该主卡在时刻 T 之后产生的扣次总和
  // （T 之后创建、挂在该主卡上的有效预约已消耗了余额，须加回归位；本纠偏运行中已挪到主卡的预约同样计入）
  const laterCharged = new Map(); // key: mainId → [{t, credits}] 本运行中已挪入主卡的预约（含 apply 前的模拟）
  const mainRemainingAt = (main, t) => {
    const mainId = String(main._id);
    let sum = main.remaining_credits;
    // 静态部分：原本就挂主卡的历史预约
    for (const b of allUserBookings) {
      if (String(b.user_package_id) !== mainId) continue;
      const bt = new Date(b.created_at).toISOString();
      if (bt > t) sum += b.credits_deducted;
    }
    // 动态部分：本运行中挪到主卡的预约
    const after = laterCharged.get(mainId);
    if (after) for (const item of after) { if (item.t > t) sum += item.credits; }
    return sum;
  };

  for (const uid of userIds) {
    const mains = mainsByUser.get(uid) || [];
    const candidates = bookings
      .filter(b => String(b.user_id) === uid)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const booking of candidates) {
      result.candidates += 1;
      const bonus = bonusById.get(String(booking.user_package_id));
      const credits = booking.credits_deducted;
      const courseDate = booking.schedule_date || '';
      const t = new Date(booking.created_at).toISOString();

      // 资格过滤：门店/有效期/舞种/星期/时段 + "当时"余额足够
      const eligible = mains
        .filter(m => matchesStore(m, booking.store_id))
        .filter(m => coversDate(m, courseDate))
        .filter(m => matchesDance(m, booking.dance_style_id))
        .filter(m => matchesWeekday(m, courseDate))
        .filter(m => matchesTimeWindow(m, booking.schedule_start_time))
        .filter(m => mainRemainingAt(m, t) >= credits)
        .sort((a, b) => {
          const ae = a.end_date ? new Date(a.end_date).getTime() : Infinity;
          const be = b.end_date ? new Date(b.end_date).getTime() : Infinity;
          if (ae !== be) return ae - be;
          return new Date(a.created_at) - new Date(b.created_at);
        });

      const memberName = (bonus.member_snapshot && (bonus.member_snapshot.real_name || bonus.member_snapshot.nick_name)) || uid;
      const detail = {
        member: memberName,
        booking: String(booking._id).slice(-6),
        course: `${booking.course_name || ''} ${courseDate} ${booking.schedule_start_time || ''}`.trim(),
        credits,
        bonusRemaining: bonus.remaining_credits,
        createdAt: booking.created_at,
        main: null, mainRemainingAtT: 0, status: '',
      };

      if (eligible.length === 0) {
        // 区分：完全没有主卡 vs 有主卡但不满足条件
        if (mains.length === 0) { result.skippedNoMain += 1; detail.status = '跳过（无主次卡）'; }
        else { result.skippedNoEligible += 1; detail.status = '跳过（主卡当时不可用：次数不足/舞种/有效期/门店等）'; }
        result.details.push(detail);
        continue;
      }

      const main = eligible[0];
      const remainAtT = mainRemainingAt(main, t);
      detail.main = `${pkgDisplayName(main)}（剩 ${main.remaining_credits}）${main.is_suspended ? '［当前停卡中］' : ''}`;
      detail.mainRemainingAtT = remainAtT;
      detail.status = apply ? '已纠偏' : '待纠偏';

      // 执行：booking 改挂主卡 + 两侧余额调整（模拟与写库同步维护内存态，保证后续候选倒推一致）
      if (apply) {
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { user_package_id: main._id, package_name: pkgSnapshotName(main), package_type: 'count_card' } }
        );
        await UserPackage.updateOne({ _id: main._id }, { $inc: { remaining_credits: -credits } });
        await UserPackage.updateOne({ _id: bonus._id }, { $inc: { remaining_credits: credits } });
        main.remaining_credits -= credits;
        bonus.remaining_credits += credits;
        result.corrected += 1;
      }
      // 记入模拟账本：本预约今后视为挂主卡（无论 apply 与否，预览也按纠偏后口径推演后续候选）
      booking.user_package_id = main._id;
      const mainId = String(main._id);
      if (!laterCharged.has(mainId)) laterCharged.set(mainId, []);
      laterCharged.get(mainId).push({ t, credits });

      result.byMember[memberName] = (result.byMember[memberName] || 0) + 1;
      result.details.push(detail);
    }
  }

  return result;
}

async function main() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`[fix-bonus-first] 数据库: ${db.databaseName}  模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览，加 --apply 执行）'}`);

  const r = await runMigration({ apply: APPLY });

  console.log('\n===== 纠偏汇总 =====');
  console.log(`赠课卡扣次候选: ${r.candidates} 条`);
  console.log(`${APPLY ? '已纠偏' : '待纠偏'}（挪回主卡）: ${r.corrected} 条`);
  console.log(`跳过-无主次卡: ${r.skippedNoMain} 条`);
  console.log(`跳过-主卡当时不可用: ${r.skippedNoEligible} 条`);
  if (Object.keys(r.byMember).length > 0) {
    console.log(`\n涉及会员: ${JSON.stringify(r.byMember)}`);
  }
  if (r.details.length > 0) {
    console.log('\n----- 明细 -----');
    r.details.forEach((d, i) => {
      console.log(`[${i + 1}] ${d.member} | ${d.course} | 扣${d.credits}次 | #${d.booking} | 赠课卡余${d.bonusRemaining}${d.main ? ` → ${d.main}（当时余≥${d.mainRemainingAtT}）` : ''} | ${d.status}`);
    });
  }
  if (!APPLY) console.log('\n预览完成。确认明细无误后加 --apply 执行写库。');

  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[fix-bonus-first] 执行失败:', err);
    process.exit(1);
  });
}

exports.runMigration = runMigration;
