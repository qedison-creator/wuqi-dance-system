/**
 * 数据中心服务（v7 全新重做：单看板 + 双 Tab，只读聚合）
 *
 * 板块与口径：
 *   - 课时消耗：completed 预约的 credits_deducted 求和（次卡/时间卡都算）
 *   - 每日趋势：按 booking_date 逐天累加消耗课时
 *   - 热门课程：按课程快照汇总消耗课时，附上课会员数
 *   - 热门教练：按教练汇总到课人次（CoachAttendance.checked_in_count，=多少会员来上课）
 *   - 会员排行：消耗课时 TOP10 / 取消次数 TOP10（当月，含取消构成）
 *   - 提醒三类：快到期 / 次数不足 / 很久没来（阈值与套餐状态页同源）+ 已联系标记/恢复
 *   - 课时账单：按会员（汇总+每节课明细）/ 按日期分组；搜索支持姓名/编号/手机号
 *
 * 溯源保证：Booking.member_snapshot 会员快照（新增）+ 课程/教练/舞种快照（已有），
 * 会员/教练/课程删除后账单信息完整无损。
 *
 * 权限：全部为汇总或会员维度数据；审核员不显示会员排行与课时账单。
 */
const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
const BJ = 'Asia/Shanghai';

const Booking = require('../models/Booking');
const UserPackage = require('../models/UserPackage');
const User = require('../models/User');
const Coach = require('../models/Coach');
const CoachAttendance = require('../models/CoachAttendance');
const CoachSalaryStat = require('../models/CoachSalaryStat');
const DcAlertFollowup = require('../models/DcAlertFollowup');
const { broadcastToAdmins } = require('./websocket.service');
const statsService = require('./stats.service');

// ===================== 通用工具 =====================

// 门店ID安全转换：非法字符串降级为 null（全部门店）而非 500
function oid(storeId) {
  if (!storeId) return null;
  try {
    return new mongoose.Types.ObjectId(String(storeId));
  } catch (e) {
    console.warn('[datacenter] 非法 store_id 已忽略:', String(storeId).slice(0, 40));
    return null;
  }
}

function assertNotReviewer(role) {
  if (role === 'reviewer') {
    const err = new Error('审核员仅可查看汇总数据');
    err.statusCode = 403;
    throw err;
  }
}

// 周期解析：today / week / month / lastWeek / lastMonth / custom
function resolveRange(period, startDate, endDate) {
  const now = dayjs().tz(BJ);
  switch (period) {
    case 'today': return { start: now.format('YYYY-MM-DD'), end: now.format('YYYY-MM-DD') };
    case 'week': return { start: now.startOf('isoWeek').format('YYYY-MM-DD'), end: now.endOf('isoWeek').format('YYYY-MM-DD') };
    case 'month': return { start: now.startOf('month').format('YYYY-MM-DD'), end: now.endOf('month').format('YYYY-MM-DD') };
    case 'lastWeek': {
      const s = now.startOf('isoWeek').subtract(7, 'day');
      return { start: s.format('YYYY-MM-DD'), end: s.add(6, 'day').format('YYYY-MM-DD') };
    }
    case 'lastMonth': return { start: now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD'), end: now.subtract(1, 'month').endOf('month').format('YYYY-MM-DD') };
    default: return (startDate && endDate)
      ? { start: startDate, end: endDate }
      : { start: now.format('YYYY-MM-DD'), end: now.format('YYYY-MM-DD') };
  }
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// ===================== 1. 课时消耗总览（含较上期与预约取消率） =====================

async function sumConsumed(storeId, range) {
  const match = {
    status: 'completed',
    booking_date: { $gte: range.start, $lte: range.end },
  };
  if (storeId) match.store_id = storeId;
  const agg = await Booking.aggregate([
    { $match: match },
    { $group: { _id: null, credits: { $sum: { $ifNull: ['$credits_deducted', 0] } }, sessions: { $sum: 1 }, members: { $addToSet: '$user_id' } } },
    { $project: { credits: 1, sessions: 1, members: { $size: '$members' } } },
  ]);
  return agg[0] || { credits: 0, sessions: 0, members: 0 };
}

// 本期取消预约数：仅统计会员主动取消（normal/exempt/quick），
// 排除系统/开放不足/放假等强制取消（min_bookings_not_met/holiday/admin_cancel），避免口径失真
async function countCancelled(storeId, range) {
  const match = {
    status: 'cancelled',
    cancel_type: { $in: ['normal', 'exempt', 'quick'] },
    booking_date: { $gte: range.start, $lte: range.end },
  };
  if (storeId) match.store_id = storeId;
  return Booking.countDocuments(match);
}

// 本期总预约数：区间内排课产生的全部预约（完成 + 待上 + 已取消）
async function countTotalBookings(storeId, range) {
  const match = {
    status: { $in: ['booked', 'completed', 'cancelled'] },
    booking_date: { $gte: range.start, $lte: range.end },
  };
  if (storeId) match.store_id = storeId;
  return Booking.countDocuments(match);
}

exports.getOverview = async ({ storeId, period, startDate, endDate }) => {
  const range = resolveRange(period, startDate, endDate);
  const sid = oid(storeId);
  const cur = await sumConsumed(sid, range);
  // 对比期：等长的上一周期
  const days = dayjs(range.end).diff(dayjs(range.start), 'day') + 1;
  const prevEnd = dayjs(range.start).subtract(1, 'day');
  const prevStart = prevEnd.subtract(days - 1, 'day');
  const prev = await sumConsumed(sid, { start: prevStart.format('YYYY-MM-DD'), end: prevEnd.format('YYYY-MM-DD') });

  // 自动签到（预约会员开课后自动标为 completed）使到课率恒≈100%失真，
  // 改用以更有意义的“预约取消率”：本期取消预约数 ÷ 本期总预约数
  const totalBookings = await countTotalBookings(sid, range);
  const cancelled = await countCancelled(sid, range);
  const cancelRate = totalBookings > 0 ? Math.round(cancelled / totalBookings * 100) : null;
  const diffPct = prev.credits > 0 ? Math.round((cur.credits - prev.credits) / prev.credits * 100) : null;

  return {
    range,
    consumed_credits: cur.credits,
    sessions: cur.sessions,
    members: cur.members,
    diff_pct: diffPct,
    prev_credits: prev.credits,
    cancel_rate: cancelRate,
    cancel_sessions: cancelled,
    total_bookings: totalBookings,
  };
};

// ===================== 2. 每日消耗趋势 =====================

exports.getTrend = async ({ storeId, period, startDate, endDate }) => {
  const range = resolveRange(period, startDate, endDate);
  const match = {
    status: 'completed',
    booking_date: { $gte: range.start, $lte: range.end },
  };
  const sid = oid(storeId);
  if (sid) match.store_id = sid;
  const agg = await Booking.aggregate([
    { $match: match },
    { $group: { _id: '$booking_date', credits: { $sum: { $ifNull: ['$credits_deducted', 0] } }, sessions: { $sum: 1 } } },
  ]);
  const byDate = new Map(agg.map(x => [x._id, x]));
  // 补全区间内每一天（无消课补 0）
  const days = [];
  let cursor = dayjs(range.start);
  const end = dayjs(range.end);
  while (cursor.isBefore(end) || cursor.isSame(end)) {
    const d = cursor.format('YYYY-MM-DD');
    const row = byDate.get(d);
    days.push({ date: d, credits: row ? row.credits : 0, sessions: row ? row.sessions : 0 });
    cursor = cursor.add(1, 'day');
  }
  const peak = days.reduce((m, x) => (x.credits > m.credits ? x : m), days[0] || { credits: 0 });
  return {
    range,
    days,
    insight: peak && peak.credits > 0 ? `最热的一天：${peak.date}，消耗 ${peak.credits} 课时` : '该时间段还没有上课记录',
  };
};

// ===================== 3. 热门课程 =====================

exports.getHotCourses = async ({ storeId, period, startDate, endDate, limit = 5 }) => {
  const range = resolveRange(period, startDate, endDate);
  const match = { status: 'completed', booking_date: { $gte: range.start, $lte: range.end } };
  const sid = oid(storeId);
  if (sid) match.store_id = sid;
  const rows = await Booking.aggregate([
    { $match: match },
    { $group: { _id: '$course_name', credits: { $sum: { $ifNull: ['$credits_deducted', 0] } }, sessions: { $sum: 1 }, people: { $addToSet: '$user_id' } } },
    { $project: { name: '$_id', credits: 1, sessions: 1, people: { $size: '$people' } } },
    { $sort: { credits: -1 } },
    { $limit: Number(limit) },
  ]);
  return { range, list: rows.map(r => ({ name: r.name || '未命名课程', credits: r.credits, sessions: r.sessions, people: r.people })) };
};

// ===================== 4. 热门教练（按到课人次） =====================

exports.getHotCoaches = async ({ storeId, period, startDate, endDate, limit = 5 }) => {
  const range = resolveRange(period, startDate, endDate);
  const match = { archived: false, not_counted: false, course_date: { $gte: range.start, $lte: range.end } };
  const sid = oid(storeId);
  if (sid) match.store_id = sid;
  const rows = await CoachAttendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$coach_id',
        visits: { $sum: '$checked_in_count' },
        sessions: { $sum: 1 },
        coach_name: { $first: '$coach_name' },
      },
    },
    { $sort: { visits: -1 } },
    { $limit: Number(limit) },
  ]);
  // 教练现存的用注册名，已删除的用上课快照名
  const ids = rows.map(r => r._id).filter(Boolean);
  const coaches = ids.length ? await Coach.find({ _id: { $in: ids } }).select('name').lean() : [];
  const nameMap = new Map(coaches.map(c => [String(c._id), c.name]));
  return {
    range,
    list: rows.map(r => ({
      coach_id: r._id,
      name: nameMap.get(String(r._id)) || r.coach_name || '已删除教练',
      visits: r.visits || 0,
      sessions: r.sessions || 0,
    })),
  };
};

// ===================== 5. 会员排行（消耗 TOP10 / 取消 TOP10） =====================

exports.getMemberRank = async ({ storeId, period, startDate, endDate, role }) => {
  assertNotReviewer(role);
  const range = resolveRange(period, startDate, endDate);
  const sid = oid(storeId);
  const baseMatch = { ...(sid ? { store_id: sid } : {}), booking_date: { $gte: range.start, $lte: range.end } };

  const consumeAgg = await Booking.aggregate([
    { $match: { ...baseMatch, status: 'completed' } },
    { $group: { _id: '$user_id', credits: { $sum: { $ifNull: ['$credits_deducted', 0] } }, sessions: { $sum: 1 } } },
    { $sort: { credits: -1 } }, { $limit: 10 },
  ]);
  const monthKey = dayjs().tz(BJ).format('YYYY-MM');
  const cancelMatch = {
    ...(sid ? { store_id: sid } : {}),
    status: 'cancelled', cancel_type: { $in: ['normal', 'exempt'] },
    booking_date: { $gte: `${monthKey}-01` },
  };
  const cancelAgg = await Booking.aggregate([
    { $match: cancelMatch },
    { $group: { _id: '$user_id', count: { $sum: 1 } } },
    { $sort: { count: -1 } }, { $limit: 10 },
  ]);

  const decorate = (rows, withCredits) => rows.map((x, i) => {
    // 会员姓名：快照优先，关联回退
    const snap = x.member_snapshot;
    return {
      rank: i + 1,
      member_id: x._id,
      name: (snap && (snap.real_name || snap.nick_name)) || x._name || '已删除会员',
      code: (snap && snap.member_code) || x._code || '',
      credits: withCredits ? (x.credits || 0) : undefined,
      sessions: x.sessions || 0,
      cancel_count: x.count || 0,
    };
  });

  // 快照/编号补齐：查会员（被删的走"已删除会员"）
  const ids = [...new Set([...consumeAgg, ...cancelAgg].map(x => String(x._id)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('real_name nick_name member_code').lean() : [];
  const uMap = new Map(users.map(u => [String(u._id), u]));
  const deco = (x, withCredits) => {
    const u = uMap.get(String(x._id));
    return {
      rank: 0, member_id: x._id,
      name: u ? (u.real_name || u.nick_name || '已删除会员') : '已删除会员',
      code: (u && u.member_code) || '',
      credits: x.credits || 0, sessions: x.sessions || 0, cancel_count: x.count || 0,
    };
  };
  const consumeTop = consumeAgg.map(x => deco(x, true)).map((x, i) => ({ ...x, rank: i + 1 }));
  const cancelTop = cancelAgg.map(x => deco(x, false)).map((x, i) => ({ ...x, rank: i + 1 }));

  return { range, consume_top: consumeTop, cancel_top: cancelTop };
};

// ===================== 6. 提醒三类（同源阈值）+ 已联系 =====================

exports.getReminders = async ({ storeId, role }) => {
  assertNotReviewer(role);
  const now = dayjs().tz(BJ);
  const monthKey = now.format('YYYY-MM');
  const statusList = await statsService.getPackageStatusList(storeId);

  const followups = await DcAlertFollowup.find({ ...(storeId ? { store_id: storeId } : {}), period_key: monthKey }).lean();
  const doneMap = new Map(followups.map(f => [`${String(f.member_id)}_${f.alert_type}`, f]));
  const withDone = (type, items) => items.map(it => {
    const mid = String(it.member_id || it.user_id || '');
    const done = doneMap.get(`${mid}_${type}`);
    return {
      ...it,
      member_id: it.member_id || it.user_id,
      period_key: monthKey,
      followup_done: !!done,
      followup_info: done ? { operator_name: done.operator_name, created_at: done.created_at } : null,
    };
  });

  const expiring = withDone('expiring', [
    ...statusList.time_card_expiring.map(x => ({ ...x, tip: `有效期剩 ${x.remaining_days} 天` })),
    ...statusList.count_card_expiring.map(x => ({ ...x, tip: `有效期剩 ${x.remaining_days} 天` })),
  ]);
  const lowCredits = withDone('low_credits', statusList.count_card_low.map(x => ({ ...x, tip: `剩余 ${x.remaining_credits} 次` })));
  const dormant = withDone('dormant', statusList.inactive_members.map(x => ({ ...x, tip: `已 ${x.days_since} 天没来上课` })));

  const groups = { expiring, low_credits: lowCredits, dormant };
  const counts = {};
  Object.keys(groups).forEach(k => { counts[k] = groups[k].filter(x => !x.followup_done).length; });
  return { period_key: monthKey, counts, groups };
};

exports.markReminderDone = async ({ storeId, memberId, alertType, periodKey, operator }) => {
  return DcAlertFollowup.findOneAndUpdate(
    { member_id: memberId, alert_type: alertType, period_key: periodKey },
    { store_id: oid(storeId), member_id: memberId, alert_type: alertType, period_key: periodKey, operator_id: operator && operator.id, operator_name: (operator && operator.name) || '' },
    { upsert: true, new: true },
  );
};

exports.undoReminderDone = async ({ memberId, alertType, periodKey }) => {
  return DcAlertFollowup.deleteOne({ member_id: memberId, alert_type: alertType, period_key: periodKey });
};

// ===================== 7. 课时账单 =====================

// 每节课明细（快照兜底：会员/教练/课程删除后信息完整）
function buildBillRow(b, memberInfo) {
  const u = b.user_id && b.user_id._id ? b.user_id : null;
  const snap = b.member_snapshot || {};
  return {
    id: String(b._id),
    member_id: (u && u._id) || b.user_id,
    member_name: (u ? (u.real_name || u.nick_name) : '') || snap.real_name || snap.nick_name || '已删除会员',
    member_code: (u && u.member_code) || snap.member_code || '',
    date: b.booking_date,
    weekday: WEEKDAY_NAMES[dayjs(b.booking_date).day()],
    time: b.booking_time || b.schedule_start_time || '',
    credits: b.credits_deducted || 0,
    course_name: b.course_name || '课程',
    dance_name: b.dance_style_name || '',
    coach_name: b.coach_name || '',
    check_in_method: b.check_in_method || '',
    check_in_label: CHECK_IN_LABELS[b.check_in_method] || '',
    booked_at: b.created_at,
    status: b.status,
  };
}

const CHECK_IN_LABELS = {
  scan: '扫码签到', auto: '自动签到', onsite: '现场签到', admin: '管理员签到',
};

// 课时账单：搜索（姓名/编号/手机号模糊）→ 按会员汇总 + 每节课明细（最近50条/人）
// period 与前端时间切换联动（today/week/month/lastWeek/lastMonth/custom）
exports.getMemberBill = async ({ storeId, search, period, startDate, endDate, role }) => {
  assertNotReviewer(role);
  const range = resolveRange(period || 'custom', startDate, endDate);

  let memberIds = null;
  if (search && search.trim()) {
    const kw = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      $or: [
        { real_name: new RegExp(kw, 'i') }, { nick_name: new RegExp(kw, 'i') },
        { member_code: new RegExp(kw, 'i') }, { phone: new RegExp(kw, 'i') },
        { reserve_phone: new RegExp(kw, 'i') }, { wechat_phone: new RegExp(kw, 'i') },
      ],
    }).select('_id');
    memberIds = users.map(u => u._id);
  }

  const match = {
    status: 'completed',
    booking_date: { $gte: range.start, $lte: range.end },
    ...(storeId ? { store_id: storeId } : {}),
    ...(memberIds ? { user_id: { $in: memberIds } } : {}),
  };
  const docs = await Booking.find(match)
    .sort({ booking_date: -1, created_at: -1 })
    .limit(2000)
    .populate('user_id', 'real_name nick_name member_code')
    .lean();

  // 按会员汇总 + 明细
  const byMember = new Map();
  const byDate = new Map();
  docs.forEach(b => {
    const row = buildBillRow(b, null);
    const uid = String(row.member_id);
    let g = byMember.get(uid);
    if (!g) {
      g = { member_id: uid, name: row.member_name, code: row.member_code, credits: 0, sessions: 0, last_date: row.date, bills: [] };
      byMember.set(uid, g);
    }
    g.credits += row.credits;
    g.sessions += 1;
    if (!g.last_date || row.date > g.last_date) g.last_date = row.date;
    if (g.bills.length < 50) g.bills.push(row);

    let dg = byDate.get(row.date);
    if (!dg) { dg = { date: row.date, credits: 0, sessions: 0, items: [] }; byDate.set(row.date, dg); }
    dg.credits += row.credits;
    dg.sessions += 1;
    dg.items.push(row);
  });

  const members = [...byMember.values()].sort((a, b) => b.credits - a.credits);
  const byDateList = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  // 按日期视图补星期
  byDateList.forEach(g => { g.weekday = WEEKDAY_NAMES[dayjs(g.date).day()]; });

  return {
    range,
    total_credits: members.reduce((s, m) => s + m.credits, 0),
    total_sessions: docs.length,
    members,
    by_date: byDateList,
  };
};

// ===================== 8. WebSocket 即时通知 =====================

// 业务链路（签到消课等）调用：广播脏标记，数据中心页收到后自动重拉对应接口
exports.notifyDataChanged = function (type, storeId, extra = {}) {
  try {
    broadcastToAdmins('datacenter_update', { type, store_id: storeId ? String(storeId) : null, ...extra });
  } catch (e) {
    console.error('[datacenter] WebSocket 通知失败:', e.message);
  }
};
