const mongoose = require('mongoose');
const Package = require('../models/Package');
const UserPackage = require('../models/UserPackage');
const PackageActivation = require('../models/PackageActivation');
const PackageExtension = require('../models/PackageExtension');
const PackageChange = require('../models/PackageChange');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Store = require('../models/Store');
const DanceStyle = require('../models/DanceStyle');
const logService = require('./log.service');
const { sendToUser } = require('./websocket.service');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const BEIJING_TZ = 'Asia/Shanghai';

// 规范化可用星期限制：仅保留 0-6（0=周日…6=周六），去重升序；空/非法 → []（整周可用）
function normalizeWeekdayLimit(value) {
  if (!Array.isArray(value)) return [];
  const valid = [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))];
  return valid.sort((a, b) => a - b);
}

exports.normalizeWeekdayLimit = normalizeWeekdayLimit;

const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// 规范化可用时段（双边界独立开关）：
//   返回 { usable_before, usable_after }，均为 'HH:mm' 或 ''（不限）
//   同开且 before >= after 为空窗口 → 抛错（调用方决定提示语）
function normalizeTimeLimit(before, after) {
  const clean = (v) => (typeof v === 'string' && TIME_HHMM_RE.test(v.trim())) ? v.trim() : '';
  const b = clean(before);
  const a = clean(after);
  if (b && a && b >= a) {
    throw new Error(`可用时段设置无效：时段前（${b}）需早于时段后（${a}）`);
  }
  return { usable_before: b, usable_after: a };
}

exports.normalizeTimeLimit = normalizeTimeLimit;

// ========== 赠送课时/赠送有效期 辅助 ==========

// 按自然月顺延日期（北京时间口径），返回 Date
function addNaturalMonths(date, months) {
  return dayjs(date).tz(BEIJING_TZ).add(Number(months), 'month').toDate();
}
exports.addNaturalMonths = addNaturalMonths;

/**
 * 为主卡创建赠课卡（方案B独立赠送卡：固定 count_card、限制/门店快照自主卡、预约时先扣赠送）
 * @param {Object} mainPkg 主卡 doc（需已落库）
 * @param {Object} opts { bonusCredits, bonusExpireMode('follow_main'|'months'), bonusMonths, operatorId, pending, monthsFrom('main_start'|'now') }
 * @returns {Object|null} 赠课卡（bonusCredits<=0 时返回 null）
 */
async function createBonusCardForMain(mainPkg, opts = {}) {
  const bonusCredits = Number(opts.bonusCredits || 0);
  if (!(bonusCredits > 0)) return null;
  const mode = opts.bonusExpireMode === 'months' ? 'months' : 'follow_main';
  const bonusMonths = Number(opts.bonusMonths || 0);
  const pending = !!opts.pending;
  const now = new Date();
  const mainName = (mainPkg.package_snapshot && mainPkg.package_snapshot.name) || '';

  const record = {
    user_id: mainPkg.user_id,
    package_id: null,  // 赠课卡不挂套餐模板，避免污染套餐录入/模板统计
    store_id: mainPkg.store_id,
    extra_store_ids: mainPkg.extra_store_ids || [],
    package_type: 'count_card',
    total_credits: bonusCredits,
    original_total_credits: bonusCredits,
    remaining_credits: bonusCredits,
    is_bonus: true,
    bonus_source_id: mainPkg._id,
    bonus_expire_mode: mode,
    dance_style_limit: mainPkg.dance_style_limit || [],
    weekday_limit: mainPkg.weekday_limit || [],
    usable_before: mainPkg.usable_before || '',
    usable_after: mainPkg.usable_after || '',
    created_by: opts.operatorId || mainPkg.created_by,
    remark: mainName ? `购买${mainName}套餐赠送` : '购买套餐赠送',
    member_snapshot: mainPkg.member_snapshot && typeof mainPkg.member_snapshot.toObject === 'function' ? mainPkg.member_snapshot.toObject() : (mainPkg.member_snapshot || {}),
    package_snapshot: { name: '赠送课时' },
  };

  if (pending) {
    // 待激活：随主套餐联动激活（首约激活/手动激活/定时自动激活共用联动 helper）
    record.is_activated = false;
    record.activated_at = null;
    record.status = 'pending';
    record.auto_activate_at = mainPkg.auto_activate_at || null;
    record.start_date = null;
    record.end_date = null;
    if (mode === 'months' && bonusMonths > 0) {
      record.duration_value = bonusMonths;
      record.duration_unit = 'month';
    } else {
      // 随主套餐：展示时长与主卡一致，激活时复制主卡起止
      record.duration_value = mainPkg.duration_value || null;
      record.duration_unit = mainPkg.duration_unit || 'month';
    }
  } else {
    const startMoment = dayjs(mainPkg.start_date || now).tz(BEIJING_TZ);
    record.is_activated = true;
    record.activated_at = now;
    record.status = 'active';
    record.start_date = startMoment.startOf('day').toDate();
    record.auto_activate_at = null;
    if (mode === 'months' && bonusMonths > 0) {
      // 生效后X个月：主卡起始日（或赠送时刻）+ X 自然月
      const baseMoment = opts.monthsFrom === 'now' ? dayjs(now).tz(BEIJING_TZ) : startMoment;
      const { end_date } = calculateValidityDates(baseMoment, bonusMonths, 'month');
      record.end_date = end_date;
      record.original_end_date = new Date(end_date);
      record.duration_value = bonusMonths;
      record.duration_unit = 'month';
    } else {
      // 随主套餐：复制主卡当前起止（含历史延长/放假顺延结果）
      record.end_date = mainPkg.end_date || null;
      record.original_end_date = mainPkg.original_end_date || mainPkg.end_date || null;
      record.duration_value = mainPkg.duration_value || null;
      record.duration_unit = mainPkg.duration_unit || 'month';
    }
  }

  const bonus = await UserPackage.create(record);
  console.log(`[Package] 赠课卡已创建: 主卡=${mainPkg._id}, 赠课卡=${bonus._id}, ${bonusCredits}节, 模式=${mode}${mode === 'months' ? `(${bonusMonths}个月)` : ''}, 状态=${bonus.status}`);
  return bonus;
}
exports.createBonusCardForMain = createBonusCardForMain;

/**
 * 主卡激活后联动激活其 pending 赠课卡（首约/手动/定时自动激活共用）
 * 赠课卡不单独发微信通知（会员只收主卡一条）
 */
async function activateLinkedBonusCards(mainPkg, options = {}) {
  const bonusCards = await UserPackage.find({
    is_bonus: true,
    bonus_source_id: mainPkg._id,
    status: 'pending',
  }).sort({ created_at: 1 });
  if (bonusCards.length === 0) return [];

  const activated = [];
  for (const bonus of bonusCards) {
    const now = new Date();
    bonus.is_activated = true;
    bonus.activated_at = now;
    bonus.status = 'active';
    if (bonus.bonus_expire_mode === 'months' && bonus.duration_value) {
      // 激活时刻 + X 自然月
      const startMoment = dayjs(now).tz(BEIJING_TZ);
      bonus.start_date = startMoment.startOf('day').toDate();
      const { end_date } = calculateValidityDates(startMoment, bonus.duration_value, 'month');
      bonus.end_date = end_date;
      bonus.original_end_date = new Date(end_date);
    } else {
      // 随主套餐：复制主卡起止
      bonus.start_date = mainPkg.start_date || null;
      bonus.end_date = mainPkg.end_date || null;
      bonus.original_end_date = mainPkg.original_end_date || mainPkg.end_date || null;
    }
    bonus.auto_activate_at = null;
    await bonus.save();
    activated.push(bonus);

    try {
      await PackageActivation.create({
        user_package_id: bonus._id,
        user_id: bonus.user_id,
        package_id: null,
        store_id: bonus.store_id || null,
        activation_type: options.activation_type || 'manual_force',
        booking_id: options.booking_id || null,
        activated_by: options.activated_by || null,
        activated_at: now,
        remark: '随主套餐联动激活',
        member_snapshot: bonus.member_snapshot || {},
        package_snapshot: { name: '赠送课时' },
      });
    } catch (actErr) {
      console.error('[Package] 赠课卡激活记录失败:', actErr.message);
    }

    try {
      await logService.createLog({
        operator_id: options.activated_by || null,
        action: 'activate',
        module: 'package',
        target_id: bonus._id,
        detail: `赠课卡(${bonus._id})随主套餐(${mainPkg._id})联动激活, ${bonus.total_credits}节, 有效期至: ${bonus.end_date ? bonus.end_date.toISOString().split('T')[0] : '长期'}`,
      });
    } catch (logErr) {
      console.error('[Package] 赠课卡激活日志失败:', logErr.message);
    }
  }
  console.log(`[Package] 主卡(${mainPkg._id})联动激活赠课卡 ${activated.length} 张`);
  return activated;
}

// ========== 套餐变更明细值展示格式化 ==========
// PackageChange.changes 写入时保存的是原始字符串值（ObjectId/英文时间串/null/数字星期），
// 查询展示时统一转为可读文案，存量历史数据同样生效。
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const CHANGE_STATUS_TEXT = {
  inactive: '未激活',
  active: '使用中',
  paused: '已暂停',
  expired: '已过期',
  depleted: '已用完',
  exhausted: '已用完'
};
const CHANGE_PACKAGE_TYPE_TEXT = { count_card: '次卡', time_card: '时间卡' };
const CHANGE_DURATION_UNIT_TEXT = { day: '天', month: '个月', year: '年' };
// 这些字段为空表示"不限制"，而非"无"
const EMPTY_AS_UNLIMITED_FIELDS = ['daily_limit', 'weekly_limit', 'monthly_limit', 'weekday_limit', 'dance_style_limit'];

// 格式化单条变更明细的 old_value / new_value
// nameMap：extra_store_ids / dance_style_limit 用的 ID→名称映射
function formatChangeValue(field, raw, nameMap) {
  let val = raw === undefined || raw === null ? '' : String(raw).trim();
  if (val === 'null' || val === 'undefined') val = '';
  if (val === '' || val === '无') {
    return EMPTY_AS_UNLIMITED_FIELDS.indexOf(field) !== -1 ? '不限' : '无';
  }
  switch (field) {
    case 'start_date':
    case 'end_date': {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return dayjs(d).tz(BEIJING_TZ).format('YYYY-MM-DD');
    }
    case 'status':
      return CHANGE_STATUS_TEXT[val] || val;
    case 'package_type':
      return CHANGE_PACKAGE_TYPE_TEXT[val] || val;
    case 'duration_unit':
      return CHANGE_DURATION_UNIT_TEXT[val] || val;
    case 'weekday_limit':
      return val.split(',')
        .map(s => (WEEKDAY_CN[Number(s)] !== undefined ? WEEKDAY_CN[Number(s)] : s))
        .filter(Boolean)
        .join('、');
    case 'extra_store_ids':
    case 'dance_style_limit': {
      const fallback = field === 'extra_store_ids' ? '已删除门店' : '已删除舞种';
      return val.split(',')
        .map(id => (nameMap && nameMap[String(id).trim()]) || fallback)
        .join('、');
    }
    default:
      return val;
  }
}

// ========== 年/月分组统计（全量口径） ==========
// 无有效时间的记录归入此key（与前端保持一致）
const UNKNOWN_MONTH_KEY = '__unknown__';

// 按北京时间聚合某集合的"月份 → { 记录数, 去重会员ID集合 }"
// 该统计基于筛选条件对全部记录聚合，不受会员分页影响
async function aggregateMonthStats(Model, filter, dateField) {
  const agg = await Model.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: '%Y-%m', date: `$${dateField}`, timezone: BEIJING_TZ } },
          user: { $toString: '$user_id' }
        },
        count: { $sum: 1 }
      }
    }
  ]);
  const map = {};
  agg.forEach(row => {
    const key = (row._id && row._id.month) || UNKNOWN_MONTH_KEY;
    if (!map[key]) map[key] = { count: 0, users: new Set() };
    map[key].count += row.count || 0;
    if (row._id && row._id.user) map[key].users.add(row._id.user);
  });
  return map;
}

// 合并多个月份统计map（同一月份记录数累加，会员集合取并集去重）
function mergeMonthStats() {
  const merged = {};
  for (let i = 0; i < arguments.length; i++) {
    const map = arguments[i] || {};
    Object.keys(map).forEach(k => {
      if (!merged[k]) merged[k] = { count: 0, users: new Set() };
      merged[k].count += map[k].count || 0;
      map[k].users.forEach(u => merged[k].users.add(u));
    });
  }
  return merged;
}

// 将月份统计序列化为可传输结构：
// - monthCounts: { 'YYYY-MM': { count: 记录数, memberCount: 去重会员数 } }
// - yearMemberCounts: { 'YYYY': 去重会员数 }（按年去重，避免各月简单相加重复计数）
function serializeMonthStats(stats) {
  const monthCounts = {};
  const yearUsers = {};
  Object.keys(stats || {}).forEach(monthKey => {
    const { count, users } = stats[monthKey];
    monthCounts[monthKey] = { count, memberCount: users.size };
    const year = monthKey === UNKNOWN_MONTH_KEY ? UNKNOWN_MONTH_KEY : monthKey.slice(0, 4);
    if (!yearUsers[year]) yearUsers[year] = new Set();
    users.forEach(u => yearUsers[year].add(u));
  });
  const yearMemberCounts = {};
  Object.keys(yearUsers).forEach(y => {
    yearMemberCounts[y] = yearUsers[y].size;
  });
  return { monthCounts, yearMemberCounts };
}

// 解析 month 参数（YYYY-MM，北京时间）为该月起止时间；无效返回 null
function getMonthRange(month) {
  if (!month || typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const start = dayjs.tz(`${month}-01T00:00:00`, BEIJING_TZ);
  return { start: start.toDate(), end: start.add(1, 'month').toDate() };
}

/**
 * 统一计算套餐起止时间：
 * - start 取开始日期当天的 00:00（北京时间）
 * - end = start + duration - 1 天，并取最后一天的 23:59:59.999（北京时间）
 * 这样无论激活/录入时间几点，服务有效期都按自然日显示，且最后一天全天有效。
 */
function calculateValidityDates(startMoment, durationValue, durationUnit) {
  const start = startMoment.tz(BEIJING_TZ).startOf('day');
  let end;
  if (durationUnit === 'month') {
    end = start.add(durationValue, 'month').subtract(1, 'day').endOf('day');
  } else if (durationUnit === 'year') {
    end = start.add(durationValue, 'year').subtract(1, 'day').endOf('day');
  } else {
    end = start.add(durationValue, 'day').subtract(1, 'day').endOf('day');
  }
  return { start_date: start.toDate(), end_date: end.toDate() };
}

/**
 * 将扁平记录列表按 user_id 分组，同会员的多条记录整合到一个卡片中
 * 每组按最新记录时间倒序排列（有最新记录的会员显示在最前面）
 * @param {Array} records - 扁平记录列表（每条记录包含 user_id, user_name, created_at 等字段）
 * @returns {Array} 分组后的列表
 */
function groupRecordsByUser(records) {
  const groupMap = new Map();
  for (const record of records) {
    const key = record.user_id || String(record._id);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        _id: key,
        user_id: key,
        user_name: record.user_name,
        user_real_name: record.user_real_name || '',
        user_nick_name: record.user_nick_name || '',
        user_phone: record.user_phone || '',
        user_deleted: record.user_deleted || false,
        latest_created_at: null,
        record_count: 0,
        records: []
      });
    }
    const group = groupMap.get(key);
    group.records.push(record);
    group.record_count++;
    const recordTime = new Date(record.created_at || record.activated_at).getTime();
    const groupTime = group.latest_created_at ? new Date(group.latest_created_at).getTime() : 0;
    if (recordTime > groupTime) {
      group.latest_created_at = record.created_at || record.activated_at;
    }
  }
  return Array.from(groupMap.values()).sort((a, b) => {
    const ta = a.latest_created_at ? new Date(a.latest_created_at).getTime() : 0;
    const tb = b.latest_created_at ? new Date(b.latest_created_at).getTime() : 0;
    return tb - ta;
  });
}

exports.getMyPackage = async (userId) => {
  // 先刷新套餐状态（将已过期的 active 标记为 expired）
  await exports.refreshPackageStatus(userId);

  // 作废套餐（voided）不在会员端展示，仅在后台"套餐记录查询"可查
  let packages = await UserPackage.find({ user_id: userId, status: { $ne: 'voided' } })
    .populate('store_id', 'name')
    .populate('extra_store_ids', 'name')
    .populate('dance_style_limit', 'name')
    .populate('bonus_source_id', 'package_snapshot status is_activated is_suspended end_date package_type total_credits daily_limit weekly_limit monthly_limit')
    .sort({ created_at: 1 });

  // 强制修正：已激活且过期的 active 套餐必须标记为 expired，避免前端/后端状态不同步
  const now = new Date();
  const toSave = [];
  packages = packages.map(pkg => {
    if (pkg.status === 'active' && pkg.is_activated && pkg.end_date && now > new Date(pkg.end_date)) {
      pkg.status = 'expired';
      toSave.push(pkg.save());
    }
    // 兜底：老会员预建档套餐可能未存 duration_value/duration_unit，由起止日期临时计算（仅展示用，不写库）
    if ((!pkg.duration_value || Number(pkg.duration_value) <= 0) && pkg.start_date && pkg.end_date) {
      try {
        const sD = new Date(pkg.start_date);
        const eD = new Date(pkg.end_date);
        if (!isNaN(sD.getTime()) && !isNaN(eD.getTime()) && eD > sD) {
          const totalDays = Math.round((eD - sD) / (1000 * 60 * 60 * 24));
          const months = Math.round(totalDays / 30.44);
          if (months >= 1) {
            pkg.duration_value = months;
            pkg.duration_unit = 'month';
          } else if (totalDays > 0) {
            pkg.duration_value = totalDays;
            pkg.duration_unit = 'day';
          }
        }
      } catch (e) {
        // 计算失败静默忽略，不影响主流程
      }
    }
    return pkg;
  });
  if (toSave.length > 0) {
    await Promise.all(toSave);
  }

  const activePackage = packages.find(p => p.status === 'active' && !p.is_suspended && !p.is_bonus);  // 看板主卡不含赠课卡
  const pendingPackages = packages.filter(p => p.status === 'pending');
  const suspendedPackages = packages.filter(p => p.status === 'active' && p.is_suspended);

  let timeCardUsage = null;
  if (activePackage && activePackage.package_type === 'time_card') {
    timeCardUsage = await calcTimeCardUsage(activePackage);
  }

  // 为所有 active 且未停卡的套餐构建统计信息（支持次卡+时间卡同时展示）
  const activePackages = packages.filter(p => p.status === 'active' && !p.is_suspended);
  // 看板排序：时间卡 → 普通次卡 → 赠课卡（三卡并存时赠课卡排最后）
  const statOrder = (pkg) => (pkg.is_bonus ? 2 : (pkg.package_type === 'time_card' ? 0 : 1));
  activePackages.sort((a, b) => statOrder(a) - statOrder(b));
  const activeStats = await Promise.all(activePackages.map(async (pkg) => {
    const stat = {
      _id: pkg._id,
      package_type: pkg.package_type,
      package_name: pkg.is_bonus ? '赠送课时' : (pkg.remark || (pkg.package_type === 'count_card' ? '次卡' : '时间卡')),
    };
    if (pkg.package_type === 'count_card') {
      stat.remaining = pkg.remaining_credits || 0;
      stat.label = pkg.is_bonus ? '赠课剩余' : '次卡剩余';
      stat.isUnlimited = false;
    } else if (pkg.package_type === 'time_card') {
      const usage = await calcTimeCardUsage(pkg);
      if (pkg.daily_limit) {
        stat.remaining = usage.daily_remaining !== null ? usage.daily_remaining : pkg.daily_limit;
        stat.label = '今日剩余';
        stat.isUnlimited = false;
      } else if (pkg.weekly_limit) {
        stat.remaining = usage.weekly_remaining !== null ? usage.weekly_remaining : pkg.weekly_limit;
        stat.label = '本周剩余';
        stat.isUnlimited = false;
      } else if (pkg.monthly_limit) {
        stat.remaining = usage.monthly_remaining !== null ? usage.monthly_remaining : pkg.monthly_limit;
        stat.label = '本月剩余';
        stat.isUnlimited = false;
      } else {
        stat.remaining = -1;
        stat.label = '不限次数';
        stat.isUnlimited = true;
      }
    }
    return stat;
  }));

  // 转为普通对象，并为每个 active 时间卡挂载 timeCardUsage（Mongoose doc 上挂属性不会随 JSON 序列化输出）
  // 修复：原先只为 current（第一个 active 套餐）计算，会员同时持有次卡+时间卡且次卡在前时，
  // 时间卡卡片/详情拿不到周期限制数据
  const packagesData = packages.map(p => p.toObject());
  await Promise.all(packagesData.map(async (obj) => {
    if (obj.status === 'active' && !obj.is_suspended && obj.package_type === 'time_card') {
      if (timeCardUsage && activePackage && String(obj._id) === String(activePackage._id)) {
        obj.timeCardUsage = timeCardUsage;
      } else {
        obj.timeCardUsage = await calcTimeCardUsage(obj);
      }
    }
    // 赠课卡：附加来源主套餐文本（会员端来源行展示）
    if (obj.is_bonus) {
      const src = obj.bonus_source_id && typeof obj.bonus_source_id === 'object' ? obj.bonus_source_id : null;
      // 主套餐名兜底：快照名缺失（录入套餐不挂模板时快照 name 为空）→ 用类型+规格描述
      const srcTypeText = (s) => {
        if (!s) return '';
        if (s.package_type === 'time_card') {
          const limit = s.daily_limit ? `每日${s.daily_limit}次` : s.weekly_limit ? `每周${s.weekly_limit}次` : s.monthly_limit ? `每月${s.monthly_limit}次` : '不限次数';
          return `时间卡·${limit}`;
        }
        return `次卡·${(s.total_credits || 0)}次`;
      };
      const srcName = (src && src.package_snapshot && src.package_snapshot.name) || (src ? srcTypeText(src) : '');
      // 仅当关联丢失（赠课卡无主卡引用）才显示"主套餐已删除"
      obj._sourceText = src ? `主套餐：${srcName || '主套餐'}` : '主套餐已删除';
    }
  }));

  return {
    current: activePackage || null,
    pending: pendingPackages,
    suspended: suspendedPackages.length > 0 ? suspendedPackages : null,
    hasSuspended: suspendedPackages.length > 0,
    history: packagesData,
    timeCardUsage,
    activeStats,
  };
};

/**
 * 获取用户可查看"预约人数/预约情况"的门店 ID 集合（场次预约信息权限隔离）。
 * 有效套餐口径与会员端 _updateCanViewCapacity 一致：
 * - pending（待激活）视为有效
 * - active 且未暂停、未过期视为有效（已激活且 end_date 已过的不算）
 * 覆盖门店 = 有效套餐的 store_id + extra_store_ids（跨店）。
 * 返回值：管理类角色 → null（不限制）；游客 → 空 Set；会员 → 门店 ID 字符串 Set。
 */
exports.getBookingViewableStoreIds = async (user) => {
  if (!user) return new Set();
  const adminRoles = ['super_admin', 'store_manager', 'staff', 'reviewer'];
  if (adminRoles.includes(user.role)) return null;
  const now = new Date();
  const packages = await UserPackage.find({
    user_id: user.id,
    status: { $in: ['pending', 'active'] },
  }).select('status store_id extra_store_ids is_activated end_date is_suspended').lean();
  const storeIds = new Set();
  packages.forEach(pkg => {
    if (pkg.status === 'active' && (pkg.is_suspended || (pkg.is_activated && pkg.end_date && now > new Date(pkg.end_date)))) {
      return;
    }
    if (pkg.store_id) storeIds.add(String(pkg.store_id._id || pkg.store_id));
    (pkg.extra_store_ids || []).forEach(sid => {
      if (sid) storeIds.add(String(sid._id || sid));
    });
  });
  return storeIds;
};

async function calcTimeCardUsage(userPackage) {
  const now = dayjs().tz(BEIJING_TZ);
  const result = {
    weekly_used: null, weekly_limit: null, weekly_remaining: null,
    daily_used: null, daily_limit: null, daily_remaining: null,
    monthly_used: null, monthly_limit: null, monthly_remaining: null,
    next_week_used: null, next_week_remaining: null,
    next_week_start: null, next_week_end: null,
  };

  // 周期限制按"课时"口径统计（与 checkTimeCardLimit 一致）：
  // 每周N次 = N课时额度，上扣2课时的课消耗2额度，而非按预约条数
  const usedCreditsInRange = async (dateFrom, dateTo) => {
    const res = await Booking.aggregate([
      {
        $match: {
          user_id: userPackage.user_id,
          user_package_id: userPackage._id,
          booking_date: { $gte: dateFrom, $lte: dateTo },
          status: { $in: ['booked', 'completed'] },
        }
      },
      {
        $group: { _id: null, total: { $sum: '$credits_deducted' } }
      }
    ]);
    return res.length > 0 ? (res[0].total || 0) : 0;
  };

  if (userPackage.weekly_limit) {
    const weekStart = now.startOf('isoWeek');
    const weekEnd = now.endOf('isoWeek');
    const usedThisWeek = await usedCreditsInRange(weekStart.format('YYYY-MM-DD'), weekEnd.format('YYYY-MM-DD'));
    result.weekly_used = usedThisWeek;
    result.weekly_limit = userPackage.weekly_limit;
    result.weekly_remaining = Math.max(0, userPackage.weekly_limit - usedThisWeek);

    const nextWeekStart = now.add(1, 'week').startOf('isoWeek');
    const nextWeekEnd = now.add(1, 'week').endOf('isoWeek');
    const usedNextWeek = await usedCreditsInRange(nextWeekStart.format('YYYY-MM-DD'), nextWeekEnd.format('YYYY-MM-DD'));
    result.next_week_used = usedNextWeek;
    result.next_week_remaining = Math.max(0, userPackage.weekly_limit - usedNextWeek);
    result.next_week_start = nextWeekStart.format('YYYY-MM-DD');
    result.next_week_end = nextWeekEnd.format('YYYY-MM-DD');
  }

  if (userPackage.daily_limit) {
    const todayStr = now.format('YYYY-MM-DD');
    const usedToday = await usedCreditsInRange(todayStr, todayStr);
    result.daily_used = usedToday;
    result.daily_limit = userPackage.daily_limit;
    result.daily_remaining = Math.max(0, userPackage.daily_limit - usedToday);
  }

  if (userPackage.monthly_limit) {
    const monthStart = now.startOf('month');
    const monthEnd = now.endOf('month');
    const usedThisMonth = await usedCreditsInRange(monthStart.format('YYYY-MM-DD'), monthEnd.format('YYYY-MM-DD'));
    result.monthly_used = usedThisMonth;
    result.monthly_limit = userPackage.monthly_limit;
    result.monthly_remaining = Math.max(0, userPackage.monthly_limit - usedThisMonth);
  }

  return result;
}

// 导出供 member.service 调用
exports._calcTimeCardUsage = calcTimeCardUsage;

// 录入套餐(为用户分配套餐) — 不自动过期旧套餐，新套餐状态为pending
// 辅助函数：为激活记录/延长记录构建会员和套餐快照
// 优先使用 UserPackage 自身的 member_snapshot/package_snapshot（录入时保存），
// 缺失时实时查询 User 和 Package 填充
exports._buildActivationSnapshot = async (userPackage) => {
  let memberSnapshot = {};
  let packageSnapshot = {};

  // 会员快照：优先用 UserPackage 已有快照
  if (userPackage.member_snapshot && (userPackage.member_snapshot.real_name || userPackage.member_snapshot.nick_name)) {
    memberSnapshot = {
      real_name: userPackage.member_snapshot.real_name || '',
      nick_name: userPackage.member_snapshot.nick_name || '',
      phone: userPackage.member_snapshot.phone || '',
      wechat_phone: userPackage.member_snapshot.wechat_phone || '',
      member_code: userPackage.member_snapshot.member_code || '',
    };
  } else {
    // 快照缺失时实时查询
    try {
      const memberDoc = await User.findById(userPackage.user_id).select('real_name nick_name phone wechat_phone member_code').lean();
      if (memberDoc) {
        memberSnapshot = {
          real_name: memberDoc.real_name || '',
          nick_name: memberDoc.nick_name || '',
          phone: memberDoc.phone || '',
          wechat_phone: memberDoc.wechat_phone || '',
          member_code: memberDoc.member_code || '',
        };
      }
    } catch (e) { /* 静默忽略 */ }
  }

  // 套餐快照：优先用 UserPackage 已有快照，再查 Package
  let packageName = '';
  if (userPackage.package_snapshot && userPackage.package_snapshot.name) {
    packageName = userPackage.package_snapshot.name;
  } else if (userPackage.package_id) {
    try {
      const packageDoc = await Package.findById(userPackage.package_id).select('name').lean();
      if (packageDoc) packageName = packageDoc.name || '';
    } catch (e) { /* 静默忽略 */ }
  }
  packageSnapshot = {
    name: packageName,
    package_type: userPackage.package_type || '',
    total_credits: userPackage.total_credits || 0,
    duration_value: userPackage.duration_value || 0,
    duration_unit: userPackage.duration_unit || '',
    start_date: userPackage.start_date || null,
    end_date: userPackage.end_date || null,
  };

  return { member_snapshot: memberSnapshot, package_snapshot: packageSnapshot };
};

/**
 * 通用辅助函数：为套餐修改操作创建 PackageChange 变更记录
 * 用于 delete/suspend/unsuspend 等非 updatePackage 路径的变更记录
 * 失败不阻塞主流程
 * @param {Object} userPackage - Mongoose UserPackage 文档（修改后的状态）
 * @param {Array} changes - 变更明细列表 [{ field, field_label, old_value, new_value }]
 * @param {String|ObjectId} operatorId - 操作人ID
 * @param {String} remark - 备注
 */
exports._recordPackageChange = async (userPackage, changes, operatorId, remark = '') => {
  if (!changes || changes.length === 0) return;
  try {
    let operatorName = '系统';
    const opId = operatorId || userPackage.created_by;
    if (opId) {
      const operator = await User.findById(opId).select('real_name nick_name username');
      if (operator) {
        operatorName = operator.real_name || operator.nick_name || operator.username || '系统';
      }
    }
    const member = await User.findById(userPackage.user_id).select('real_name nick_name reserve_phone wechat_phone member_code').lean();
    const memberSnapshot = member ? {
      real_name: member.real_name || '',
      nick_name: member.nick_name || '',
      phone: member.reserve_phone || member.wechat_phone || '',
      member_code: member.member_code || ''
    } : {};
    const packageSnapshot = {
      package_type: userPackage.package_type || '',
      total_credits: userPackage.total_credits || 0,
      duration_value: userPackage.duration_value || 0,
      duration_unit: userPackage.duration_unit || ''
    };
    await PackageChange.create({
      user_package_id: userPackage._id,
      user_id: userPackage.user_id,
      store_id: userPackage.store_id,
      operator_id: opId || null,
      operator_name: operatorName,
      changes,
      remark,
      member_snapshot: memberSnapshot,
      package_snapshot: packageSnapshot
    });
    console.log(`[Package] 变更记录已保存: 套餐=${userPackage._id}, 变更字段数=${changes.length}, 操作人=${operatorName}`);
  } catch (err) {
    console.error('[Package] 记录变更历史失败:', err.message, err.stack);
  }
};

exports.createPackage = async (data, operatorId) => {
  const { user_id, package_id, store_id, extra_store_ids, package_type, total_credits, duration_value, duration_unit, daily_limit, weekly_limit, monthly_limit, dance_style_limit, weekday_limit, usable_before, usable_after, remark, activate_mode, bonus_credits, bonus_expire_mode, bonus_months, gift_validity_months } = data;

  if (!user_id) throw new Error('用户ID不能为空');
  if (!package_type) throw new Error('套餐类型不能为空');

  const existingActive = await UserPackage.findOne({ user_id, status: 'active' });

  const autoActivateAt = new Date();
  autoActivateAt.setMonth(autoActivateAt.getMonth() + 2);

  // 保存会员和套餐快照，即使后续被删除记录信息也不丢失
  const [memberDoc, packageDoc] = await Promise.all([
    User.findById(user_id).select('real_name nick_name phone wechat_phone member_code').lean(),
    package_id ? Package.findById(package_id).select('name').lean() : null,
  ]);
  const memberSnapshot = memberDoc ? {
    real_name: memberDoc.real_name || '',
    nick_name: memberDoc.nick_name || '',
    phone: memberDoc.phone || '',
    wechat_phone: memberDoc.wechat_phone || '',
    member_code: memberDoc.member_code || '',
  } : {};
  const packageSnapshot = packageDoc ? { name: packageDoc.name || '' } : {};

  const userPackage = await UserPackage.create({
    user_id,
    package_id: package_id || null,
    store_id: store_id || null,
    extra_store_ids: extra_store_ids || [],
    package_type,
    total_credits: total_credits || 0,
    original_total_credits: total_credits || 0,  // 原始录入值，修改 total_credits 时不变
    remaining_credits: total_credits || 0,
    duration_value: duration_value || null,
    duration_unit: duration_unit || 'month',
    daily_limit: daily_limit || null,
    weekly_limit: weekly_limit || null,
    monthly_limit: monthly_limit || null,
    dance_style_limit: Array.isArray(dance_style_limit) ? dance_style_limit : [],
    weekday_limit: normalizeWeekdayLimit(weekday_limit),
    ...normalizeTimeLimit(usable_before, usable_after),
    is_activated: false,
    activated_at: null,
    auto_activate_at: autoActivateAt,
    status: 'pending',
    remark: remark || '',
    created_by: operatorId,
    member_snapshot: memberSnapshot,
    package_snapshot: packageSnapshot,
  });

  // 赠送课时：创建独立赠课卡（pending，随主套餐联动激活）
  const bonusCredits = Number(bonus_credits || 0);
  if (bonusCredits > 0) {
    await createBonusCardForMain(userPackage, {
      bonusCredits,
      bonusExpireMode: bonus_expire_mode === 'months' ? 'months' : 'follow_main',
      bonusMonths: Number(bonus_months || 0),
      operatorId,
      pending: true,
    });
  }
  // 赠送有效期：暂存到主卡，激活时按自然月并入 end_date
  if (Number(gift_validity_months || 0) > 0) {
    userPackage.bonus_validity_months = Number(gift_validity_months);
    await userPackage.save();
  }

  // 记录操作日志
  const durationText = package_type === 'time_card'
    ? `${duration_value}${duration_unit === 'month' ? '个月' : '天'}`
    : `${total_credits}课时`;
  const existingNote = existingActive ? `（当前有使用中的套餐，新套餐待激活）` : '（首个套餐，待激活）';

  if (activate_mode === 'active') {
    // 直接生效：录入后立即激活（赠课/补偿课时场景），起止日期从录入日按时长起算
    await logService.createLog({
      operator_id: operatorId,
      action: 'create',
      module: 'package',
      target_id: userPackage._id,
      detail: `为用户(${user_id})录入${package_type === 'count_card' ? '次卡' : '时间卡'}: ${durationText}（直接生效）`,
    });
    const activated = await exports.activatePackageById(userPackage._id, user_id, {
      activation_type: 'manual_force',
      activated_by: operatorId,
    });
    return activated;
  }

  await logService.createLog({
    operator_id: operatorId,
    action: 'create',
    module: 'package',
    target_id: userPackage._id,
    detail: `为用户(${user_id})录入${package_type === 'count_card' ? '次卡' : '时间卡'}: ${durationText}${existingNote}, 2个月后自动激活`,
  });

  // 推送套餐变更事件给会员端，即时刷新套餐数据
  try {
    sendToUser(user_id, 'package_update', { action: 'create', package_id: String(userPackage._id) });
  } catch (e) {
    console.error('[Package] 推送套餐更新事件失败:', e.message);
  }

  return userPackage;
};

// 激活指定套餐（按ID激活）
exports.activatePackageById = async (packageId, userId, options = {}) => {
  try {
    console.log('[Package] 开始激活套餐, packageId:', packageId, 'userId:', userId, 'options:', options);
    const pkg = await UserPackage.findById(packageId);
    if (!pkg) throw new Error('套餐不存在');
    if (pkg.status !== 'pending') throw new Error('该套餐状态不可激活');
    // 入口防护：赠课卡只随主套餐联动激活，不可单独激活
    if (pkg.is_bonus) throw new Error('赠送课时需随主套餐激活，不可单独激活');
    if (pkg.user_id.toString() !== userId.toString()) throw new Error('无权操作');

    const now = new Date();
    pkg.is_activated = true;
    pkg.activated_at = now;
    pkg.status = 'active';

    // 统一按北京时间自然日计算起止时间
    const startMoment = dayjs(now).tz(BEIJING_TZ);
    pkg.start_date = startMoment.startOf('day').toDate();
    if (pkg.duration_value) {
      const { end_date } = calculateValidityDates(startMoment, pkg.duration_value, pkg.duration_unit);
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    } else {
      const { end_date } = calculateValidityDates(startMoment, 1, 'year');
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    }

    // 赠送有效期：按自然月并入主卡有效期（录入时暂存 bonus_validity_months，激活时生效）
    if (Number(pkg.bonus_validity_months || 0) > 0) {
      pkg.end_date = addNaturalMonths(pkg.end_date, pkg.bonus_validity_months);
      pkg.original_end_date = new Date(pkg.end_date);
    }

    await pkg.save();
    console.log('[Package] 套餐保存成功');

    // 构建激活记录快照（优先使用 UserPackage 已有快照，缺失时实时查询）
    const activationSnapshot = await exports._buildActivationSnapshot(pkg);

    try {
      await PackageActivation.create({
        user_package_id: pkg._id,
        user_id: userId,
        package_id: pkg.package_id || null,
        store_id: pkg.store_id || null,
        activation_type: options.activation_type || options.activationType || 'manual_force',
        booking_id: options.booking_id || null,
        activated_by: options.activated_by || userId,
        activated_at: now,
        remark: options.remark || '',
        member_snapshot: activationSnapshot.member_snapshot,
        package_snapshot: activationSnapshot.package_snapshot,
      });
    } catch (actErr) {
      console.error('[Package] 记录激活日志失败:', actErr.message);
    }

    try {
      await logService.createLog({
        operator_id: userId,
        action: 'activate',
        module: 'package',
        target_id: pkg._id,
        detail: `用户(${userId})套餐已激活, 有效期至: ${pkg.end_date.toISOString().split('T')[0]}`,
      });
    } catch (logErr) {
      console.error('[Package] 记录激活日志失败:', logErr.message);
    }

    try {
      const wechatMessageService = require('./wechat-message.service');
      const User = require('../models/User');
      const user = await User.findById(userId);
      if (user && user.openid) {
        const packageName = pkg.package_type === 'count_card' ? `${pkg.total_credits}次卡` : `${pkg.duration_value || ''}${pkg.duration_unit === 'month' ? '个月' : '天'}时间卡`;
        const endDate = pkg.end_date ? dayjs(pkg.end_date).format('YYYY年MM月DD日') : '长期有效';
        await wechatMessageService.sendPackageActivated(user, packageName, endDate);
      }
    } catch (notifyErr) {
      console.error('[Package] 发送套餐激活通知失败:', notifyErr.message);
    }

    console.log('[Package] 套餐激活成功');

    // 赠送课时联动：主卡激活后同步激活其 pending 赠课卡
    try {
      await activateLinkedBonusCards(pkg, {
        activation_type: options.activation_type || options.activationType || 'manual_force',
        booking_id: options.booking_id || null,
        activated_by: options.activated_by || userId,
      });
    } catch (linkErr) {
      console.error('[Package] 赠课卡联动激活失败:', linkErr.message);
    }

    // 推送套餐变更事件给会员端，即时刷新套餐数据
    try {
      sendToUser(userId, 'package_update', { action: 'activate', package_id: String(pkg._id) });
    } catch (e) {
      console.error('[Package] 推送套餐更新事件失败:', e.message);
    }

    return pkg;
  } catch (err) {
    console.error('[Package] 激活套餐失败:', err);
    console.error('[Package] 错误堆栈:', err.stack);
    throw err;
  }
};

// 激活用户的下一个pending套餐（按录入顺序）
exports.activateNextPackage = async (userId) => {
  const pkg = await UserPackage.findOne({
    user_id: userId,
    status: 'pending',
    is_bonus: { $ne: true },  // 赠课卡随主套餐联动激活，不可单独激活
  }).sort({ created_at: 1 });

  if (!pkg) return null;
  return exports.activatePackageById(pkg._id, userId);
};

// 检查并自动激活pending套餐（定时任务调用）
exports.checkAutoActivation = async () => {
  const now = new Date();
  const packages = await UserPackage.find({
    is_activated: false,
    auto_activate_at: { $lte: now },
    status: 'pending',
    is_bonus: { $ne: true },  // 赠课卡随主套餐联动激活，不单独自动激活
  });

  for (const pkg of packages) {
    // 检查该用户是否有active套餐（如果有active套餐，不自动激活pending）
    const hasActive = await UserPackage.findOne({
      user_id: pkg.user_id,
      status: 'active',
      is_bonus: { $ne: true },
    });
    if (hasActive) continue; // 有active套餐，跳过自动激活

    pkg.is_activated = true;
    pkg.activated_at = now;
    pkg.status = 'active';

    // 统一按北京时间自然日计算起止时间
    const startMoment = dayjs(now).tz(BEIJING_TZ);
    pkg.start_date = startMoment.startOf('day').toDate();
    if (pkg.duration_value) {
      const { end_date } = calculateValidityDates(startMoment, pkg.duration_value, pkg.duration_unit);
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    } else {
      const { end_date } = calculateValidityDates(startMoment, 1, 'year');
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    }

    // 赠送有效期：按自然月并入主卡有效期
    if (Number(pkg.bonus_validity_months || 0) > 0) {
      pkg.end_date = addNaturalMonths(pkg.end_date, pkg.bonus_validity_months);
      pkg.original_end_date = new Date(pkg.end_date);
    }

    await pkg.save();

    // 构建激活记录快照
    const autoActivationSnapshot = await exports._buildActivationSnapshot(pkg);

    try {
      await PackageActivation.create({
        user_package_id: pkg._id,
        user_id: pkg.user_id,
        package_id: pkg.package_id || null,
        store_id: pkg.store_id || null,
        activation_type: 'manual_force',
        activated_by: null,
        activated_at: now,
        remark: '自动激活(超时未使用)',
        member_snapshot: autoActivationSnapshot.member_snapshot,
        package_snapshot: autoActivationSnapshot.package_snapshot,
      });
    } catch (actErr) {
      console.error('[Package] 记录自动激活日志失败:', actErr.message);
    }

    try {
      await logService.createLog({
        operator_id: null,
        action: 'auto_activate',
        module: 'package',
        target_id: pkg._id,
        detail: `用户(${pkg.user_id})套餐已自动激活(超时未使用), 有效期至: ${pkg.end_date.toISOString().split('T')[0]}`,
      });
    } catch (logErr) {
      console.error('[Package] 记录自动激活日志失败:', logErr.message);
    }

    try {
      // 自动激活时，如果是凌晨（0-8点），则不发送消息（用户在睡觉，收到也没用）
      const currentHour = new Date().getHours();
      if (currentHour >= 8) {
        const wechatMessageService = require('./wechat-message.service');
        const User = require('../models/User');
        const user = await User.findById(pkg.user_id);
        if (user && user.openid) {
          const packageName = pkg.package_type === 'count_card' ? `${pkg.total_credits}次卡` : `${pkg.duration_value || ''}${pkg.duration_unit === 'month' ? '个月' : '天'}时间卡`;
          const endDate = pkg.end_date ? dayjs(pkg.end_date).format('YYYY年MM月DD日') : '长期有效';
          await wechatMessageService.sendPackageActivated(user, packageName, endDate);
        }
      } else {
        console.log(`[Package] 自动激活跳过消息发送(凌晨${currentHour}点): ${pkg._id}`);
      }
    } catch (notifyErr) {
      console.error('[Package] 发送自动激活通知失败:', notifyErr.message);
    }

    // 赠送课时联动：定时自动激活主卡后同步激活其 pending 赠课卡
    try {
      await activateLinkedBonusCards(pkg, {
        activation_type: 'manual_force',
        activated_by: null,
      });
    } catch (linkErr) {
      console.error('[Package] 赠课卡联动激活失败:', linkErr.message);
    }
  }

  return { activated_count: packages.length };
};

// 编辑套餐(支持修改套餐类型、课时数、有效期、限制次数等)
// 同时记录字段变更历史到 PackageChange 表（仅记录实际发生变化的字段）
exports.updatePackage = async (id, data, operatorId = null) => {
  const userPackage = await UserPackage.findById(id);
  if (!userPackage) throw new Error('套餐记录不存在');

  // 已激活的套餐只允许修改部分字段
  // 修复：允许已激活次卡修改 total_credits（业务场景：发现套餐录入错误，需调整总次数）
  //   - 同步传递 remaining_credits 保持已消耗次数不变（消耗 = 旧total - 旧remaining + 校验）
  //   - 实际消耗次数 = 旧 total_credits - 旧 remaining_credits，新 remaining_credits = 新 total_credits - 已消耗次数
  const isActivated = userPackage.is_activated;
  // 赠课卡（is_bonus）：附属卡，门店/舞种/时段限制跟随主套餐，不允许单独修改；
  // 仅允许纠错类字段：总次数/剩余次数/状态/备注；到期日仅"自定义月数"模式可改（随主套餐模式跟随主卡顺延）
  let allowedFields;
  if (userPackage.is_bonus) {
    allowedFields = ['total_credits', 'remaining_credits', 'status', 'remark'];
    if (userPackage.bonus_expire_mode === 'months') {
      allowedFields.push('end_date');
      // 未激活的赠课卡：有效期以"月数"录入，激活时自激活日起算
      if (!isActivated) allowedFields.push('duration_value');
    }
  } else if (isActivated) {
    allowedFields = ['total_credits', 'remaining_credits', 'start_date', 'end_date', 'daily_limit', 'weekly_limit', 'monthly_limit', 'dance_style_limit', 'weekday_limit', 'usable_before', 'usable_after', 'status', 'remark', 'extra_store_ids'];
  } else {
    allowedFields = ['package_type', 'total_credits', 'remaining_credits', 'duration_value', 'duration_unit', 'daily_limit', 'weekly_limit', 'monthly_limit', 'dance_style_limit', 'weekday_limit', 'usable_before', 'usable_after', 'status', 'remark', 'extra_store_ids'];
  }

  // 可用时段规范化（双边界；同开且 after>=before 抛错）
  if (data.usable_before !== undefined || data.usable_after !== undefined) {
    const normalized = normalizeTimeLimit(data.usable_before, data.usable_after);
    data.usable_before = normalized.usable_before;
    data.usable_after = normalized.usable_after;
  }

  // 可用星期限制规范化（空/非法 → []，即整周可用）
  if (data.weekday_limit !== undefined) {
    data.weekday_limit = normalizeWeekdayLimit(data.weekday_limit);
  }

  // 记录 duration_value/duration_unit 是否实际发生变化（用于判断是否需要重算有效期）
  const durationValueChanged = data.duration_value !== undefined && Number(data.duration_value) !== Number(userPackage.duration_value);
  const durationUnitChanged = data.duration_unit !== undefined && data.duration_unit !== userPackage.duration_unit;
  const durationChanged = durationValueChanged || durationUnitChanged;
  // 是否显式提供了 end_date（管理员直接调整服务有效期截止日期）
  const hasExplicitEndDate = data.end_date !== undefined && data.end_date !== null && data.end_date !== '';
  const hasExplicitStartDate = data.start_date !== undefined && data.start_date !== null && data.start_date !== '';

  // 已激活次卡修改 total_credits 时，自动同步 remaining_credits
  // 消耗次数从 Booking 表精确查询（credits_deducted - credits_refunded），不依赖 oldTotal-oldRemaining
  // 这样即使 remaining_credits 被历史 bug 污染，也能修正为真实消耗
  if (isActivated && userPackage.package_type === 'count_card' && data.total_credits !== undefined) {
    const newTotal = Number(data.total_credits);
    if (newTotal < 0) throw new Error('总次数不能小于0');

    // 旧数据兼容：如果 original_total_credits 不存在，设置它为修改前的 oldTotal
    // 这样至少保留"修改前的值"作为原始录入值，防止后续修改继续覆盖
    if (userPackage.original_total_credits === undefined || userPackage.original_total_credits === null) {
      userPackage.original_total_credits = Number(userPackage.total_credits) || 0;
    }

    // 精确查询该套餐的实际消耗次数（预约时扣减，取消时退还）
    const bookings = await Booking.find({
      user_package_id: userPackage._id
    }).select('credits_deducted credits_refunded');
    const consumed = bookings.reduce((sum, b) => {
      const deducted = Number(b.credits_deducted) || 0;
      const refunded = Number(b.credits_refunded) || 0;
      return sum + Math.max(0, deducted - refunded);
    }, 0);

    // 新 remaining = 新 total - 实际已消耗次数（不小于0）
    data.remaining_credits = Math.max(0, newTotal - consumed);
    console.log(`[Package] 次卡改总次数: 旧total=${userPackage.total_credits}, 新total=${newTotal}, 原始录入=${userPackage.original_total_credits}, 实际消耗=${consumed}, 新remaining=${data.remaining_credits}`);
  }

  // 收集变更记录：字段名(中文)、旧值、新值
  const fieldLabelMap = {
    total_credits: '总次数',
    remaining_credits: '剩余次数',
    package_type: '套餐类型',
    duration_value: '时长数值',
    duration_unit: '时长单位',
    daily_limit: '每日限制',
    weekly_limit: '每周限制',
    monthly_limit: '每月限制',
    start_date: '开始日期',
    end_date: '到期日期',
    usable_before: '可用时段（前）',
    usable_after: '可用时段（后）',
    status: '状态',
    remark: '备注'
  };
  const changes = [];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      const oldValue = userPackage[key];
      const newValue = data[key];
      // 跳过未实际变化的字段
      if (key === 'dance_style_limit' || key === 'extra_store_ids' || key === 'weekday_limit') {
        // 数组类字段单独处理：仅当长度或内容变化时记录
        const oldArr = Array.isArray(oldValue) ? oldValue.map(String).sort().join(',') : '';
        const newArr = Array.isArray(newValue) ? newValue.map(String).sort().join(',') : '';
        if (oldArr === newArr) continue;
        changes.push({
          field: key,
          field_label: key === 'dance_style_limit' ? '舞种限制' : (key === 'weekday_limit' ? '可用星期' : '附加门店'),
          old_value: oldArr || '无',
          new_value: newArr || '无'
        });
      } else if (String(oldValue) !== String(newValue)) {
        changes.push({
          field: key,
          field_label: fieldLabelMap[key] || key,
          old_value: oldValue === undefined ? '' : String(oldValue),
          new_value: newValue === undefined ? '' : String(newValue)
        });
      }
      userPackage[key] = data[key];
      // 防御：对数组/对象类型字段显式标记已修改，避免 Mongoose 修改检测遗漏导致 save() 不持久化
      if (Array.isArray(data[key]) || (data[key] !== null && typeof data[key] === 'object' && !(data[key] instanceof Date))) {
        userPackage.markModified(key);
      }
    }
  }

  // 有效期重算逻辑（修复漏洞：仅修改周期限制等非有效期字段时不应重算 end_date）：
  // 1. 管理员显式提供了 end_date（直接调整服务有效期）→ 使用管理员提供的日期，不重算
  // 2. 未激活套餐：不重算（激活时再计算）
  // 3. 已激活套餐且 duration_value/duration_unit 实际发生变化 → 从 start_date 重算 end_date
  // 4. 已激活套餐但 duration 未变化（仅修改其他字段如 weekly_limit）→ 保持原有效期不变
  if (hasExplicitEndDate) {
    // 管理员直接调整 end_date，同步更新 original_end_date
    if (userPackage.end_date) {
      userPackage.original_end_date = new Date(userPackage.end_date);
    }
  } else if (isActivated && durationChanged && data.duration_value && data.duration_unit) {
    const startMoment = dayjs(userPackage.start_date || new Date()).tz(BEIJING_TZ);
    const { start_date, end_date } = calculateValidityDates(startMoment, data.duration_value, data.duration_unit);
    userPackage.start_date = start_date;
    userPackage.end_date = end_date;
    userPackage.original_end_date = new Date(end_date);
  }
  // 其他情况：保持原有 start_date/end_date 不变

  await userPackage.save();

  // 记录套餐变更历史（仅当存在字段变更时）
  if (changes.length > 0) {
    try {
      // 取操作人姓名（优先传入的 operatorId，否则取 userPackage.created_by）
      // 注意：变量名不能用 operatorId，会与函数参数同名导致 TDZ ReferenceError
      let operatorName = '系统';
      const opId = operatorId || userPackage.created_by;
      if (opId) {
        const operator = await User.findById(opId).select('real_name nick_name username');
        if (operator) {
          operatorName = operator.real_name || operator.nick_name || operator.username || '系统';
        }
      }
      // 会员快照
      const member = await User.findById(userPackage.user_id).select('real_name nick_name reserve_phone wechat_phone member_code').lean();
      const memberSnapshot = member ? {
        real_name: member.real_name || '',
        nick_name: member.nick_name || '',
        phone: member.reserve_phone || member.wechat_phone || '',
        member_code: member.member_code || ''
      } : {};
      // 套餐快照（保存修改后的当前值，用于变更记录卡片显示套餐名称）
      const packageSnapshot = {
        package_type: userPackage.package_type,
        total_credits: userPackage.total_credits,
        duration_value: userPackage.duration_value,
        duration_unit: userPackage.duration_unit
      };
      await PackageChange.create({
        user_package_id: userPackage._id,
        user_id: userPackage.user_id,
        store_id: userPackage.store_id,
        operator_id: opId || null,
        operator_name: operatorName,
        changes,
        remark: data.remark || '',
        member_snapshot: memberSnapshot,
        package_snapshot: packageSnapshot
      });
      console.log(`[Package] 变更记录已保存: 套餐=${userPackage._id}, 变更字段数=${changes.length}, 操作人=${operatorName}`);
    } catch (err) {
      console.error('[Package] 记录变更历史失败:', err.message, err.stack);
      // 失败不阻塞主流程
    }
  }

  // 推送套餐变更事件给会员端，即时刷新套餐数据
  try {
    sendToUser(userPackage.user_id, 'package_update', { action: 'update', package_id: String(userPackage._id) });
  } catch (e) {
    console.error('[Package] 推送套餐更新事件失败:', e.message);
  }

  return userPackage;
};

// 删除/作废用户套餐
// 分级策略（权益溯源铁律）：
//   - 未激活且从未被使用（无预约/激活/延长引用）的录入错误套餐 → 物理删除
//   - 其余一律作废（status='voided'），保留记录用于会员权益溯源
exports.deleteUserPackage = async (id, operatorId, reason = '', options = {}) => {
  const userPackage = await UserPackage.findById(id);
  if (!userPackage) throw new Error('套餐记录不存在');

  const [bookingCount, activationCount, extensionCount] = await Promise.all([
    Booking.countDocuments({ user_package_id: id }),
    PackageActivation.countDocuments({ user_package_id: id }),
    PackageExtension.countDocuments({ user_package_id: id }),
  ]);
  const neverUsed = bookingCount === 0 && activationCount === 0 && extensionCount === 0;
  const canPhysicallyDelete = !userPackage.is_activated && userPackage.status === 'pending' && neverUsed;
  const typeLabel = userPackage.package_type === 'count_card' ? '次卡' : '时间卡';

  if (canPhysicallyDelete) {
    // 物理删除：录入错误的一次性纠错，不涉权益溯源
    await exports._recordPackageChange(userPackage, [{
      field: 'status',
      field_label: '状态',
      old_value: userPackage.status || 'pending',
      new_value: '已删除'
    }], operatorId, '管理员删除未激活套餐（录入错误）');

    await logService.createLog({
      operator_id: operatorId,
      action: 'delete',
      module: 'package',
      target_id: userPackage._id,
      detail: `物理删除用户(${userPackage.user_id})未激活的${typeLabel}套餐（录入错误）`,
    });

    try {
      sendToUser(userPackage.user_id, 'package_update', { action: 'delete', package_id: String(userPackage._id) });
    } catch (e) {
      console.error('[Package] 推送套餐更新事件失败:', e.message);
    }

    await UserPackage.findByIdAndDelete(id);
    // 主卡物理删除：赠课卡同条件（未激活未使用）一并物理删除
    const deletedBonuses = await UserPackage.deleteMany({
      is_bonus: true,
      bonus_source_id: userPackage._id,
      is_activated: false,
      status: 'pending',
    });
    if (deletedBonuses.deletedCount > 0) {
      console.log(`[Package] 主卡(${id})物理删除，联动删除赠课卡 ${deletedBonuses.deletedCount} 张`);
    }
    return { success: true, mode: 'deleted' };
  }

  // 作废：保留记录（member_snapshot/package_snapshot + PackageChange 变更记录），仅标记 voided
  const oldStatus = userPackage.status;
  userPackage.status = 'voided';
  userPackage.voided_at = new Date();
  userPackage.voided_by = operatorId;
  userPackage.voided_reason = reason || '管理员作废套餐';
  await userPackage.save();

  await exports._recordPackageChange(userPackage, [{
    field: 'status',
    field_label: '状态',
    old_value: oldStatus || 'active',
    new_value: '已作废'
  }], operatorId, reason ? `管理员作废套餐：${reason}` : '管理员作废套餐（保留记录用于权益溯源）');

  await logService.createLog({
    operator_id: operatorId,
    action: 'void',
    module: 'package',
    target_id: userPackage._id,
    detail: `作废用户(${userPackage.user_id})的${typeLabel}套餐${reason ? '（' + reason + '）' : ''}`,
  });

  try {
    sendToUser(userPackage.user_id, 'package_update', { action: 'void', package_id: String(userPackage._id) });
  } catch (e) {
    console.error('[Package] 推送套餐更新事件失败:', e.message);
  }

  // 赠课卡强制联动作废：主套餐作废时其名下所有赠课卡一并作废（业务规则：赠课随主套餐存在，不可独立保留）
  const linkedBonuses = await UserPackage.find({
    is_bonus: true,
    bonus_source_id: userPackage._id,
    status: { $ne: 'voided' },
  });
  for (const bonus of linkedBonuses) {
    bonus.status = 'voided';
    bonus.voided_at = new Date();
    bonus.voided_by = operatorId;
    bonus.voided_reason = `随主套餐作废${reason ? `（${reason}）` : ''}`;
    await bonus.save();
  }
  if (linkedBonuses.length > 0) {
    console.log(`[Package] 主卡(${id})作废，联动作废赠课卡 ${linkedBonuses.length} 张`);
  }

  return { success: true, mode: 'voided' };
};

// 追加赠送：为使用中的主卡追加独立赠课卡（不入2小时撤回、不进数据中心提醒）
// follow_main=复制主卡当前end_date（含历史延长/顺延）；months=赠送时刻+X自然月
exports.addBonusToPackage = async (mainId, data, operatorId) => {
  const mainPkg = await UserPackage.findById(mainId);
  if (!mainPkg) throw new Error('套餐不存在');
  if (mainPkg.is_bonus) throw new Error('赠课卡不支持追加赠送');
  if (mainPkg.status !== 'active') throw new Error('仅使用中的套餐可追加赠送');

  const bonusCredits = Number(data.bonus_credits || 0);
  if (!(bonusCredits >= 1 && bonusCredits <= 99)) throw new Error('赠送课时数需在1-99之间');
  const mode = data.bonus_expire_mode === 'months' ? 'months' : 'follow_main';
  const bonusMonths = Number(data.bonus_months || 0);
  if (mode === 'months' && !(bonusMonths >= 1 && bonusMonths <= 36)) throw new Error('赠送月数需在1-36之间');

  const bonus = await createBonusCardForMain(mainPkg, {
    bonusCredits,
    bonusExpireMode: mode,
    bonusMonths,
    operatorId,
    pending: false,
    monthsFrom: 'now',  // 追加赠送的X个月模式自赠送之日起算
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'create',
    module: 'package',
    target_id: mainPkg._id,
    detail: `为套餐(${mainPkg._id})追加赠送${bonusCredits}节${mode === 'months' ? `，有效期自赠送之日起${bonusMonths}个月` : '，随主套餐有效期'}`,
  });

  try {
    sendToUser(mainPkg.user_id, 'package_update', { action: 'bonus', package_id: String(bonus._id) });
  } catch (e) {
    console.error('[Package] 推送追加赠送事件失败:', e.message);
  }

  return bonus;
};

// 获取套餐列表(管理端 - 套餐模板)
exports.getPackageList = async (query) => {
  const { status, page = 1, pageSize = 20 } = query;
  const filter = {};
  if (status) filter.status = status;
  else filter.status = 'active';

  const list = await Package.find(filter)
    .populate('dance_styles', 'name')
    .sort({ sort_order: 1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Package.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取套餐模板详情
exports.getPackageById = async (id) => {
  const pkg = await Package.findById(id).populate('dance_styles', 'name');
  if (!pkg) throw new Error('套餐不存在');
  return pkg;
};

// 创建套餐模板
exports.createPackageTemplate = async (data) => {
  if (!data.name) throw new Error('套餐名称不能为空');
  if (!data.class_count || data.class_count <= 0) throw new Error('课时数必须大于0');
  if (!data.price || data.price < 0) throw new Error('价格不能为负数');
  if (!data.duration_days || data.duration_days <= 0) throw new Error('有效期天数必须大于0');

  const pkg = await Package.create(data);
  return pkg;
};

// 更新套餐模板
exports.updatePackageTemplate = async (id, data) => {
  const pkg = await Package.findById(id);
  if (!pkg) throw new Error('套餐不存在');

  const allowedFields = ['name', 'description', 'class_count', 'price', 'original_price', 'duration_days', 'dance_styles', 'is_popular', 'sort_order', 'status'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      pkg[key] = data[key];
    }
  }

  await pkg.save();
  return pkg;
};

// 删除套餐模板
exports.checkPackageUsable = async (userId) => {
  const packages = await UserPackage.find({ user_id: userId }).sort({ created_at: 1 });
  const activePackages = packages.filter(p => p.status === 'active' && !p.is_suspended);
  const pendingPackages = packages.filter(p => p.status === 'pending');

  if (activePackages.length > 0) {
    const reasons = [];
    for (const pkg of activePackages) {
      if (pkg.end_date && new Date() > pkg.end_date) {
        reasons.push('套餐已过期');
      } else if (pkg.package_type === 'count_card' && pkg.remaining_credits <= 0) {
        reasons.push('剩余次数不足');
      }
    }
    if (reasons.length > 0 && reasons.length === activePackages.length) {
      return { isUsable: false, memberPackageStatus: 'active', reasons };
    }
    return { isUsable: true, memberPackageStatus: 'active', reasons: [] };
  }

  if (pendingPackages.length > 0) {
    return { isUsable: false, memberPackageStatus: 'pending', reasons: ['套餐待激活'] };
  }

  return { isUsable: false, memberPackageStatus: 'none', reasons: ['暂无有效套餐'] };
};

exports.deletePackage = async (id) => {
  const pkg = await Package.findById(id);
  if (!pkg) throw new Error('套餐不存在');
  await Package.findByIdAndDelete(id);
  return { success: true };
};

exports.getActivationRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id, keyword, month } = query;

  const activationCount = await PackageActivation.countDocuments();
  const activatedPkgCount = await UserPackage.countDocuments({
    is_activated: true,
    status: { $in: ['active', 'expired', 'exhausted'] },
  });
  if (activationCount < activatedPkgCount) {
    await exports.backfillActivationRecords();
  }

  // 回填历史记录中缺失的快照数据（幂等，已修复的记录快速跳过）
  try {
    await exports.repairActivationSnapshots();
  } catch (e) {
    // 忽略修复失败，不影响查询
  }

  // 为支持 keyword 会员搜索：先按 keyword 在 User 表中查到匹配的 user_id 列表
  let matchedUserIds = null;
  if (keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      $or: [
        { real_name: { $regex: escaped, $options: 'i' } },
        { nick_name: { $regex: escaped, $options: 'i' } },
        { reserve_phone: { $regex: escaped, $options: 'i' } },
        { wechat_phone: { $regex: escaped, $options: 'i' } }
      ]
    }).select('_id').lean();
    matchedUserIds = users.map(u => u._id);
  }

  const filter = {};
  if (store_id) filter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
  if (keyword) {
    filter.$or = [
      { user_id: { $in: matchedUserIds } },
      { 'member_snapshot.real_name': { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { 'member_snapshot.phone': { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
    ];
  }

  // 年/月分组统计：全量口径（不带月份过滤，供前端渲染全部月份行及数字）
  const activationMonthStats = await aggregateMonthStats(PackageActivation, filter, 'activated_at');
  const { monthCounts, yearMemberCounts } = serializeMonthStats(activationMonthStats);
  // month 参数（YYYY-MM，北京时间）：按月筛选该月发生的记录
  const monthRange = getMonthRange(month);
  if (monthRange) filter.activated_at = { $gte: monthRange.start, $lt: monthRange.end };

  // 按会员分组：先聚合获取去重 user_id 列表（按最新激活时间倒序），再分页
  const skip = (Number(page) - 1) * Number(pageSize);
  const limit = Number(pageSize);

  const userGroups = await PackageActivation.aggregate([
    { $match: filter },
    { $group: { _id: '$user_id', latest_at: { $max: '$activated_at' }, count: { $sum: 1 } } },
    { $sort: { latest_at: -1 } },
    { $skip: skip },
    { $limit: limit }
  ]);
  const userIds = userGroups.map(g => g._id).filter(Boolean);
  const totalAgg = await PackageActivation.aggregate([
    { $match: filter },
    { $group: { _id: '$user_id' } },
    { $count: 'total' }
  ]);
  const total = (totalAgg[0] && totalAgg[0].total) || 0;

  // 拉取这些 user_id 的全部激活记录（不再分页，分页已在 user 维度完成）
  const fetchFilter = { user_id: { $in: userIds } };
  if (store_id) fetchFilter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
  // month 筛选时仅返回该月发生的记录（前端按月展开查看）
  if (monthRange) fetchFilter.activated_at = { $gte: monthRange.start, $lt: monthRange.end };

  const list = await PackageActivation.find(fetchFilter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('user_package_id', 'member_snapshot package_snapshot package_type total_credits duration_value duration_unit start_date end_date created_by remark')
    .populate('package_id', 'name')
    .populate('activated_by', 'nick_name username')
    .populate('store_id', 'name')
    .sort({ activated_at: -1 });

  const records = list.map(r => {
    const user = r.user_id;
    const pkg = r.user_package_id;
    const operator = r.activated_by || {};
    const typeMap = { first_booking: 'booking', manual_force: 'manual', default: 'default' };
    // 预建档/批量导入的会员套餐由管理员创建（created_by 存在），
    // backfill 时被误标为 first_booking + "系统补录"，
    // 此处修正为"默认激活" + "管理员录入"
    let displayType = typeMap[r.activation_type] || r.activation_type;
    let displayRemark = r.remark || '';
    if (r.remark === '系统补录' && pkg && pkg.created_by) {
      displayType = 'default';
      displayRemark = '管理员录入';
    }
    // 会员自主激活（first_booking 且 activated_by 是会员自己）：不显示操作人
    // 会员自主激活无需多此一举标注操作人，谁都知道是用户自主激活的
    const isSelfActivated = r.activation_type === 'first_booking'
      && r.activated_by && user && String(r.activated_by._id) === String(user._id);
    const operatorName = isSelfActivated ? '' : (operator.nick_name || operator.username || '');
    // 会员信息：user_id populate > UserPackage.member_snapshot > PackageActivation.member_snapshot > UserPackage.remark提取
    const snapshot = r.member_snapshot || {};
    const pkgSnapshot = r.package_snapshot || {};
    const upMemberSnapshot = (pkg && pkg.member_snapshot) ? pkg.member_snapshot : {};
    const upPkgSnapshot = (pkg && pkg.package_snapshot) ? pkg.package_snapshot : {};
    let userRealName = (user && (user.real_name || user.nick_name))
      ? (user.real_name || user.nick_name)
      : (upMemberSnapshot.real_name || upMemberSnapshot.nick_name || snapshot.real_name || snapshot.nick_name || '');
    // 兜底：从 UserPackage.remark 提取（格式："张三 的套餐（会员已删除）"）
    if (!userRealName && pkg && pkg.remark) {
      const nameMatch = pkg.remark.match(/^(.+?)\s*的套餐/);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
        userRealName = nameMatch[1].trim();
      }
    }
    if (!userRealName) userRealName = '未知会员';
    const userDeleted = !user;
    // 套餐信息：populate 失败时回退到快照
    let packageName = '';
    let effectiveDate = null;
    let expireDate = null;
    if (pkg) {
      // UserPackage 存在时，优先使用 package_id populate 的名称，再回退到快照
      packageName = (r.package_id && r.package_id.name) ? r.package_id.name : (upPkgSnapshot.name || pkgSnapshot.name || '');
      if (!packageName) {
        packageName = pkg.package_type === 'count_card' ? `${pkg.total_credits}次卡` : `${pkg.duration_value || ''}${pkg.duration_unit === 'month' ? '个月' : '天'}时间卡`;
      }
      effectiveDate = pkg.start_date || r.activated_at;
      expireDate = pkg.end_date || null;
    } else {
      // UserPackage 也不存在，使用快照
      packageName = pkgSnapshot.name || (pkgSnapshot.package_type === 'count_card' ? `${pkgSnapshot.total_credits}次卡` : `${pkgSnapshot.duration_value || ''}${pkgSnapshot.duration_unit === 'month' ? '个月' : '天'}时间卡`);
      effectiveDate = pkgSnapshot.start_date || r.activated_at;
      expireDate = pkgSnapshot.end_date || null;
    }
    return {
      _id: r._id,
      user_id: r.user_id ? String(r.user_id._id || r.user_id) : '',
      user_name: userRealName,
      user_real_name: (user && user.real_name) ? user.real_name : (upMemberSnapshot.real_name || snapshot.real_name || ''),
      user_nick_name: (user && user.nick_name) ? user.nick_name : (upMemberSnapshot.nick_name || snapshot.nick_name || ''),
      user_phone: (user && user.phone) ? user.phone : (upMemberSnapshot.phone || snapshot.phone || ''),
      user_deleted: userDeleted,
      package_name: packageName,
      type: displayType,
      activation_type: r.activation_type,
      effective_date: effectiveDate,
      expire_date: expireDate,
      created_at: r.created_at,
      activated_at: r.activated_at,
      operator_name: operatorName,
      remark: displayRemark,
    };
  });

  // 按 user_id 分组
  const groupList = groupRecordsByUser(records);

  return { list: groupList, total, monthCounts, yearMemberCounts, page: Number(page), pageSize: Number(pageSize) };
};

exports.getExtensionRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id, keyword, month, user_id } = query;

  // 从会员详情页「查看完整变更记录」钻取时按会员 ID 精确过滤：
  // 会员可能跨门店持有套餐、也可能存在同名会员，按门店/姓名模糊过滤会漏记录，
  // 故有此参数时不再叠加 store_id 与 keyword 条件。
  const drillUserId = (user_id && mongoose.isValidObjectId(user_id))
    ? new mongoose.Types.ObjectId(user_id)
    : null;

  // 为支持 keyword 会员搜索：先按 keyword 在 User 表中查到匹配的 user_id 列表
  let matchedUserIds = null;
  if (keyword && !drillUserId) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      $or: [
        { real_name: { $regex: escaped, $options: 'i' } },
        { nick_name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { reserve_phone: { $regex: escaped, $options: 'i' } },
        { wechat_phone: { $regex: escaped, $options: 'i' } }
      ]
    }).select('_id').lean();
    matchedUserIds = users.map(u => u._id);
  }

  // 延长记录筛选条件（PackageExtension）
  const extFilter = { operation_type: 'extend' };
  // 变更记录筛选条件（PackageChange）
  const pcFilter = {};

  if (drillUserId) {
    extFilter.user_id = drillUserId;
    pcFilter.user_id = drillUserId;
  } else {
    if (store_id) extFilter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
    if (keyword) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      extFilter.$or = [
        { user_id: { $in: matchedUserIds } },
        { 'member_snapshot.real_name': { $regex: escaped, $options: 'i' } },
        { 'member_snapshot.phone': { $regex: escaped, $options: 'i' } }
      ];
    }

    if (store_id) {
      pcFilter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
    }
    if (keyword) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pcFilter.$or = [
        { user_id: { $in: matchedUserIds } },
        { 'member_snapshot.real_name': { $regex: escaped, $options: 'i' } },
        { 'member_snapshot.phone': { $regex: escaped, $options: 'i' } }
      ];
    }
  }

  // 年/月分组统计：全量口径（不带月份过滤，延长记录 + 字段变更记录）
  const [extMonthStats, pcMonthStats] = await Promise.all([
    aggregateMonthStats(PackageExtension, extFilter, 'created_at'),
    aggregateMonthStats(PackageChange, pcFilter, 'created_at')
  ]);
  const { monthCounts, yearMemberCounts } = serializeMonthStats(mergeMonthStats(extMonthStats, pcMonthStats));
  // month 参数（YYYY-MM，北京时间）：按月筛选该月发生的记录
  const monthRange = getMonthRange(month);
  if (monthRange) {
    const createdRange = { $gte: monthRange.start, $lt: monthRange.end };
    extFilter.created_at = createdRange;
    pcFilter.created_at = createdRange;
  }

  // 回填历史记录中缺失的快照数据（幂等）
  try {
    await exports.repairExtensionSnapshots();
  } catch (e) {
    // 忽略修复失败，不影响查询
  }

  // 按会员分组：聚合两个集合的去重 user_id，按最新记录时间倒序，分页
  const skip = (Number(page) - 1) * Number(pageSize);
  const limit = Number(pageSize);

  const [extUserAgg, pcUserAgg] = await Promise.all([
    PackageExtension.aggregate([
      { $match: extFilter },
      { $group: { _id: '$user_id', latest_at: { $max: '$created_at' } } }
    ]),
    PackageChange.aggregate([
      { $match: pcFilter },
      { $group: { _id: '$user_id', latest_at: { $max: '$created_at' } } }
    ])
  ]);

  // 合并两个集合的 user 维度，取每人在两个集合中的最新时间
  const userLatestMap = new Map();
  for (const u of [...extUserAgg, ...pcUserAgg]) {
    if (!u._id) continue;
    const key = String(u._id);
    const existing = userLatestMap.get(key);
    if (!existing || new Date(u.latest_at) > new Date(existing)) {
      userLatestMap.set(key, u.latest_at);
    }
  }
  const sortedUsers = Array.from(userLatestMap.entries())
    .map(([id, latest]) => ({ _id: id, latest_at: latest }))
    .sort((a, b) => new Date(b.latest_at) - new Date(a.latest_at));
  const total = sortedUsers.length;

  const pagedUsers = sortedUsers.slice(skip, skip + limit);
  const userIds = pagedUsers.map(u => u._id);

  // 拉取这些 user_id 的全部记录（延长 + 变更），不再分页
  // 钻取模式（drillUserId）下与上面的筛选保持一致：不再按门店过滤
  const extFetchFilter = { operation_type: 'extend', user_id: { $in: userIds } };
  if (store_id && !drillUserId) extFetchFilter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
  const pcFetchFilter = { user_id: { $in: userIds } };
  if (store_id && !drillUserId) pcFetchFilter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
  // month 筛选时仅返回该月发生的记录（前端按月展开查看）
  if (monthRange) {
    const createdRange = { $gte: monthRange.start, $lt: monthRange.end };
    extFetchFilter.created_at = createdRange;
    pcFetchFilter.created_at = createdRange;
  }

  const [extList, pcList] = await Promise.all([
    PackageExtension.find(extFetchFilter)
      .populate('user_id', 'nick_name real_name phone')
      .populate('user_package_id', 'member_snapshot package_snapshot package_type total_credits duration_value duration_unit end_date remark')
      .populate('package_id', 'name')
      .populate('operated_by', 'nick_name username')
      .populate('store_id', 'name')
      .populate('holiday_id', 'name')
      .sort({ created_at: -1 })
      .lean(),
    PackageChange.find(pcFetchFilter)
      .populate('user_id', 'nick_name real_name phone')
      .populate('user_package_id', 'package_type total_credits duration_value duration_unit')
      .populate('store_id', 'name')
      .populate('operator_id', 'nick_name username real_name')
      .sort({ created_at: -1 })
      .lean()
  ]);

  // 已被撤销的延长记录 ID 集合（revoke 记录的 revoked_extension_id 指向原记录）
  const revokeMarks = await PackageExtension.find({
    user_package_id: { $in: userIds },
    revoked_extension_id: { $ne: null },
  }).select('revoked_extension_id').lean();
  const revokedExtIdSet = new Set(revokeMarks.map(m => String(m.revoked_extension_id)));

  // 转换延长记录
  const extRecords = extList.map(r => {
    const user = r.user_id;
    const pkg = r.package_id;
    const up = r.user_package_id;
    const operator = r.operated_by || {};
    const holiday = r.holiday_id || {};
    const typeMap = { extend: 'manual', revoke: 'system' };
    let displayType = typeMap[r.operation_type] || 'manual';
    if (holiday && holiday.name) displayType = 'holiday';
    const snapshot = r.member_snapshot || {};
    const pkgSnapshot = r.package_snapshot || {};
    const upMemberSnapshot = (up && up.member_snapshot) ? up.member_snapshot : {};
    const upPkgSnapshot = (up && up.package_snapshot) ? up.package_snapshot : {};
    let userRealName = (user && (user.real_name || user.nick_name))
      ? (user.real_name || user.nick_name)
      : (upMemberSnapshot.real_name || upMemberSnapshot.nick_name || snapshot.real_name || snapshot.nick_name || '');
    if (!userRealName && up && up.remark) {
      const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
        userRealName = nameMatch[1].trim();
      }
    }
    if (!userRealName) userRealName = '未知会员';
    let packageName = (pkg && pkg.name) ? pkg.name : (upPkgSnapshot.name || pkgSnapshot.name || '');
    if (!packageName && up) {
      packageName = up.package_type === 'count_card' ? `${up.total_credits}次卡` : `${up.duration_value || ''}${up.duration_unit === 'month' ? '个月' : '天'}时间卡`;
    }
    // 套餐类型
    const pkgType = (up && up.package_type) || pkgSnapshot.package_type || '';
    return {
      _id: String(r._id),
      record_type: 'extend',  // 延长记录
      user_id: r.user_id ? String(r.user_id._id || r.user_id) : '',
      user_name: userRealName,
      user_real_name: (user && user.real_name) ? user.real_name : (upMemberSnapshot.real_name || snapshot.real_name || ''),
      user_nick_name: (user && user.nick_name) ? user.nick_name : (upMemberSnapshot.nick_name || snapshot.nick_name || ''),
      user_phone: (user && user.phone) ? user.phone : (upMemberSnapshot.phone || snapshot.phone || ''),
      user_deleted: !user,
      package_name: packageName,
      package_type: pkgType,
      type: displayType,
      operation_type: r.operation_type,
      extend_days: r.extend_days || 0,
      extend_value: r.extend_value || r.extend_days || 0,
      extend_unit: r.extend_unit || 'day',
      original_expire: r.original_expire_at,
      new_expire: r.new_expire_at,
      holiday_name: holiday.name || '',
      created_at: r.created_at,
      operator_name: operator.nick_name || operator.username || '',
      remark: r.remark || r.reason || '',
      // 撤回状态（前端只读展示"已撤回"标签；撤销延长记录本身也标记，避免误读）
      undone: (revokedExtIdSet && revokedExtIdSet.has(String(r._id))) || !!r.undone_at,
    };
  });

  // 收集变更明细中出现的门店/舞种 ID，批量查询名称，用于展示"附加门店""舞种限制"
  const changeStoreIdSet = new Set();
  const changeStyleIdSet = new Set();
  pcList.forEach(pc => {
    (pc.changes || []).forEach(ch => {
      const field = ch.field;
      if (field !== 'extra_store_ids' && field !== 'dance_style_limit') return;
      [ch.old_value, ch.new_value].forEach(v => {
        if (!v) return;
        String(v).split(',').forEach(id => {
          const sid = id.trim();
          if (!sid || sid === '无' || sid === 'null' || !mongoose.isValidObjectId(sid)) return;
          if (field === 'extra_store_ids') changeStoreIdSet.add(sid);
          else changeStyleIdSet.add(sid);
        });
      });
    });
  });
  const [changeStores, changeStyles] = await Promise.all([
    changeStoreIdSet.size
      ? Store.find({ _id: { $in: Array.from(changeStoreIdSet) } }).select('name').lean()
      : [],
    changeStyleIdSet.size
      ? DanceStyle.find({ _id: { $in: Array.from(changeStyleIdSet) } }).select('name').lean()
      : []
  ]);
  const changeStoreNameMap = {};
  changeStores.forEach(s => { changeStoreNameMap[String(s._id)] = s.name || ''; });
  const changeStyleNameMap = {};
  changeStyles.forEach(s => { changeStyleNameMap[String(s._id)] = s.name || ''; });

  // 转换字段变更记录
  const pcRecords = pcList.map(pc => {
    const user = pc.user_id;
    const up = pc.user_package_id;
    const operator = pc.operator_id || {};
    const snapshot = pc.member_snapshot || {};
    const pkgSnapshot = pc.package_snapshot || {};

    let userRealName = (user && (user.real_name || user.nick_name))
      ? (user.real_name || user.nick_name)
      : (snapshot.real_name || snapshot.nick_name || '');
    if (!userRealName) userRealName = '未知会员';

    // 套餐类型：优先用 UserPackage 当前类型，回退到 snapshot
    const pkgType = (up && up.package_type) || pkgSnapshot.package_type || '';

    // 套餐名称：从 snapshot 拼接
    let packageName = '';
    if (pkgSnapshot.package_type === 'count_card') {
      packageName = `${pkgSnapshot.total_credits || 0}次卡`;
    } else if (pkgSnapshot.package_type === 'time_card') {
      packageName = `${pkgSnapshot.duration_value || ''}${pkgSnapshot.duration_unit === 'month' ? '个月' : '天'}时间卡`;
    }

    return {
      _id: String(pc._id),
      record_type: 'change',  // 字段变更记录
      user_id: pc.user_id ? String(pc.user_id._id || pc.user_id) : '',
      user_name: userRealName,
      user_real_name: (user && user.real_name) ? user.real_name : (snapshot.real_name || ''),
      user_nick_name: (user && user.nick_name) ? user.nick_name : (snapshot.nick_name || ''),
      user_phone: (user && user.phone) ? user.phone : (snapshot.phone || ''),
      user_deleted: !user,
      package_name: packageName,
      package_type: pkgType,
      created_at: pc.created_at,
      operator_name: operator.real_name || operator.nick_name || operator.username || pc.operator_name || '',
      remark: pc.remark || '',
      // 撤回状态：撤回记录（is_undo）与被撤回的原记录都展示"已撤回"标记
      undone: !!pc.undone_at,
      is_undo: !!pc.is_undo,
      changes: (pc.changes || []).map(ch => ({
        field: ch.field,
        field_label: ch.field_label,
        old_value: formatChangeValue(
          ch.field,
          ch.old_value,
          ch.field === 'extra_store_ids' ? changeStoreNameMap : changeStyleNameMap
        ),
        new_value: formatChangeValue(
          ch.field,
          ch.new_value,
          ch.field === 'extra_store_ids' ? changeStoreNameMap : changeStyleNameMap
        ),
      })),
    };
  });

  // 合并并按 created_at 倒序排列
  const merged = [...extRecords, ...pcRecords].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return tb - ta;
  });

  // 按 user_id 分组（分页已在 user 维度完成，这里无需再切片）
  const groupList = groupRecordsByUser(merged);

  return { list: groupList, total, monthCounts, yearMemberCounts, page: Number(page), pageSize: Number(pageSize) };
};

exports.extendPackage = async (packageId, extendDays, operatorId, operatorName, options = {}) => {
  const userPackage = await UserPackage.findById(packageId);
  if (!userPackage) throw new Error('套餐不存在');
  if (!userPackage.is_activated) throw new Error('未激活的套餐不能延长');
  if (userPackage.status === 'expired' || userPackage.status === 'exhausted') throw new Error('已过期或已用完的套餐不能延长');

  // 延长单位与数值：month 按自然月相加（如 3/15 → 4/15），day 按自然日相加。
  // 不能把「1个月」折算成 30 天，否则跨月会少算天数（3/15 + 30天 = 4/14，正确应为 4/15）。
  const extendUnit = options.extend_unit === 'month' ? 'month' : 'day';
  const extendValue = Number(options.extend_value) || Number(extendDays) || 0;
  const originalEnd = userPackage.end_date || new Date();
  const newEnd = dayjs(originalEnd).tz(BEIJING_TZ).add(extendValue, extendUnit).toDate();
  // 实际顺延的自然天数：写入记录，撤销延长时按其精确回退
  const actualDays = Math.round((newEnd.getTime() - originalEnd.getTime()) / 86400000);

  userPackage.end_date = newEnd;
  if (userPackage.original_end_date) {
    userPackage.original_end_date = new Date(newEnd);
  }
  await userPackage.save();

  // 构建延长记录快照
  const extendSnapshot = await exports._buildActivationSnapshot(userPackage);

  await PackageExtension.create({
    user_package_id: packageId,
    user_id: userPackage.user_id,
    package_id: userPackage.package_id || userPackage._id,
    store_id: userPackage.store_id || options.store_id,
    operation_type: 'extend',
    extend_days: actualDays,
    extend_value: extendValue,
    extend_unit: extendUnit,
    original_expire_at: originalEnd,
    new_expire_at: newEnd,
    holiday_id: options.holiday_id || null,
    revoked_extension_id: options.revoked_extension_id || null,
    operated_by: operatorId,
    reason: options.reason || '',
    remark: options.remark || '',
    member_snapshot: extendSnapshot.member_snapshot,
    package_snapshot: {
      name: extendSnapshot.package_snapshot.name,
      package_type: extendSnapshot.package_snapshot.package_type,
      total_credits: extendSnapshot.package_snapshot.total_credits,
    },
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'extend',
    module: 'package',
    target_id: packageId,
    detail: `延长用户(${userPackage.user_id})套餐${extendValue}${extendUnit === 'month' ? '个月' : '天'}, ${originalEnd.toISOString().split('T')[0]} → ${newEnd.toISOString().split('T')[0]}`,
  });

  // 推送套餐变更事件给会员端，即时刷新套餐数据
  try {
    sendToUser(userPackage.user_id, 'package_update', { action: 'extend', package_id: String(userPackage._id) });
  } catch (e) {
    console.error('[Package] 推送套餐更新事件失败:', e.message);
  }

  return userPackage;
};

// 撤回操作时间窗口：操作后 2 小时内可一键撤回
exports.UNDO_WINDOW_MS = 2 * 60 * 60 * 1000;

exports.revokePackageExtension = async (extensionId, operatorId, operatorName, reason, options = {}) => {
  const ext = await PackageExtension.findById(extensionId);
  if (!ext) throw new Error('延长记录不存在');
  if (ext.operation_type !== 'extend') throw new Error('只能撤销延长操作');

  // 2小时撤回窗口：超时后请通过"修改套餐"手动调整有效期
  if (Date.now() - new Date(ext.created_at).getTime() > exports.UNDO_WINDOW_MS) {
    throw new Error('已超过2小时撤回时限，请通过修改套餐有效期手动调整');
  }

  // 重复撤回防护：已存在指向本记录的撤销记录，或原记录已打撤回标记
  const alreadyRevoked = await PackageExtension.exists({ revoked_extension_id: ext._id });
  if (alreadyRevoked || ext.undone_at) {
    throw new Error('该延长已被撤销过，请勿重复操作');
  }

  const userPackage = await UserPackage.findById(ext.user_package_id);
  if (!userPackage) throw new Error('关联套餐不存在');

  const currentEnd = userPackage.end_date;
  // 到期日当前值必须仍等于延长后的值：若期间又被其他管理员改过到期日，自动撤回会破坏那次修改
  if (!currentEnd || new Date(currentEnd).getTime() !== new Date(ext.new_expire_at).getTime()) {
    throw new Error('该套餐在此次延长后又被修改过到期日，无法自动撤回，请手动调整');
  }

  // 回退后的到期日（extend_days 为延长时记录的实际自然天数，精确回退）
  const newEnd = new Date(currentEnd.getTime() - ext.extend_days * 24 * 60 * 60 * 1000);

  // 使用冲突检测：会员在"将被撤回的有效期"内已有预约/上课 → 阻止撤回
  // （撤回会使这些预约落到有效期之外，必须先通过取消预约流程处理）
  const rollbackEndDay = dayjs(newEnd).tz(BEIJING_TZ).format('YYYY-MM-DD');
  const conflictCount = await Booking.countDocuments({
    user_package_id: userPackage._id,
    booking_date: { $gt: rollbackEndDay },
    status: { $in: ['booked', 'completed'] },
  });
  if (conflictCount > 0) {
    throw new Error(`会员在撤回的有效期内已有 ${conflictCount} 条预约/上课记录，请先取消这些预约再撤回`);
  }

  // 原子更新（乐观锁）：到期日仍为延长后的值才允许回退，防止与并发修改/预约扣课竞争
  const updateSet = { end_date: newEnd };
  if (userPackage.original_end_date) {
    updateSet.original_end_date = newEnd;
  }
  const updated = await UserPackage.findOneAndUpdate(
    { _id: userPackage._id, end_date: currentEnd },
    { $set: updateSet },
    { new: true }
  );
  if (!updated) {
    throw new Error('套餐状态刚刚发生了变化，请刷新后重试');
  }

  // 标记原延长记录已撤回（防重复 + 前端展示）
  await PackageExtension.updateOne(
    { _id: ext._id },
    { $set: { undone_at: new Date(), undone_by: operatorId } }
  );

  await PackageExtension.create({
    user_package_id: ext.user_package_id,
    user_id: ext.user_id,
    package_id: ext.package_id,
    store_id: ext.store_id,
    operation_type: 'revoke',
    extend_days: ext.extend_days,
    extend_value: ext.extend_value,
    extend_unit: ext.extend_unit,
    original_expire_at: currentEnd,
    new_expire_at: newEnd,
    holiday_id: options.holiday_id || null,
    revoked_extension_id: ext._id,
    operated_by: operatorId,
    reason: reason || '撤销延长',
    remark: reason || '',
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'revoke_extension',
    module: 'package',
    target_id: ext.user_package_id,
    detail: `撤回用户(${ext.user_id})套餐延长${ext.extend_days}天`,
  });

  // 推送套餐变更事件给会员端，即时刷新套餐数据
  try {
    sendToUser(ext.user_id, 'package_update', { action: 'revoke_extend', package_id: String(ext.user_package_id) });
  } catch (e) {
    console.error('[Package] 推送套餐更新事件失败:', e.message);
  }

  return updated;
};

// ===== 撤回套餐字段变更 =====
// 字段分类：
//   - 增量型数值：total_credits / remaining_credits（remaining 会被会员消费自然改变，
//     撤回用"反向增量"应用到当前状态，而非还原快照 —— 会员已用掉的部分自动保持）
//   - 设置型：其余字段（仅管理员会改；当前值必须仍等于记录的 new_value 才允许还原 old_value）
//   - 不支持自动撤回：package_type（次卡↔时间卡影响面大）
const CHANGE_END_DATE_FIELDS = { start_date: false, end_date: true }; // value=是否为到期日（还原时取当日 23:59:59.999）
const CHANGE_ARRAY_FIELDS = ['dance_style_limit', 'extra_store_ids', 'weekday_limit'];
const CHANGE_NUMERIC_SET_FIELDS = ['daily_limit', 'weekly_limit', 'monthly_limit', 'duration_value'];

// 解析记录中的日期字符串 → 北京日期 YYYY-MM-DD（兼容 "2027-04-15" 与 Date.toString() 两种存储格式）
const parseBjDay = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const m = String(raw).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = dayjs.tz(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`, BEIJING_TZ);
    return d.isValid() ? d.format('YYYY-MM-DD') : null;
  }
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  return dayjs(parsed).tz(BEIJING_TZ).format('YYYY-MM-DD');
};

// 数组当前值 → 记录中的字符串口径（与 updatePackage 写入格式一致：排序后逗号连接，空为 '无'）
const arrayToLogValue = (arr) => {
  const list = Array.isArray(arr) ? arr.map(v => String(v)).sort() : [];
  return list.length > 0 ? list.join(',') : '无';
};

const normLogValue = (v) => (v === undefined || v === null || v === 'null' || v === 'undefined') ? '' : String(v);

// 校验一条变更记录能否撤回；通过时返回待执行的字段赋值计划
// 返回 { ok, reason, assignments: [{key, value}], preview: [{label, from, to}] }
const checkChangeUndo = async (userPackage, changeDoc) => {
  const changes = changeDoc.changes || [];
  if (changes.length === 0) return { ok: false, reason: '该记录没有可撤回的字段变更' };
  const blocked = [];
  const assignments = [];
  const preview = [];
  const hasTotal = changes.some(c => c.field === 'total_credits');
  let newTotal = null;

  for (const c of changes) {
    const label = c.field_label || c.field;
    const oldRaw = normLogValue(c.old_value);
    const newRaw = normLogValue(c.new_value);

    if (c.field === 'package_type') { blocked.push(`${label}不支持自动撤回`); continue; }

    // ---- 增量型数值：总次数（剩余次数在循环后统一处理，避免双重扣减）----
    if (c.field === 'total_credits') {
      const oldN = Number(oldRaw), newN = Number(newRaw);
      if (isNaN(oldN) || isNaN(newN)) { blocked.push(`${label}的值无法解析`); continue; }
      newTotal = Number(userPackage.total_credits || 0) + (oldN - newN);
      if (newTotal < 0) { blocked.push(`${label}撤回后不能小于0`); continue; }
      continue;
    }
    // ---- 增量型数值：单独修改剩余次数（会员消费会自然改变当前值，反向增量）----
    if (c.field === 'remaining_credits') {
      if (hasTotal) continue;
      const oldN = Number(oldRaw), newN = Number(newRaw);
      if (isNaN(oldN) || isNaN(newN)) { blocked.push(`${label}的值无法解析`); continue; }
      const newRemaining = Number(userPackage.remaining_credits || 0) + (oldN - newN);
      if (newRemaining < 0) { blocked.push(`会员已使用超出撤回后的剩余次数（撤回后为 ${newRemaining} 次），请先手动调整`); continue; }
      assignments.push({ key: 'remaining_credits', value: newRemaining });
      preview.push({ label, from: String(userPackage.remaining_credits), to: String(newRemaining) });
      continue;
    }

    // ---- 数组型（当前值一致才整体还原）----
    if (CHANGE_ARRAY_FIELDS.includes(c.field)) {
      const curLog = arrayToLogValue(userPackage[c.field]);
      if (curLog !== newRaw) { blocked.push(`${label}在此之后又被修改过，无法自动撤回`); continue; }
      const restored = (oldRaw === '无' || oldRaw === '') ? [] : oldRaw.split(',').map(s => s.trim()).filter(Boolean);
      assignments.push({ key: c.field, value: restored });
      preview.push({ label, from: curLog, to: oldRaw });
      continue;
    }

    // ---- 日期型（按北京日期部分比较，避免 Date.toString() 格式差异误判）----
    if (c.field in CHANGE_END_DATE_FIELDS) {
      const curDay = parseBjDay(userPackage[c.field]);
      const newDay = parseBjDay(newRaw);
      if (!newDay || curDay !== newDay) { blocked.push(`${label}在此之后又被修改过，无法自动撤回`); continue; }
      const oldDay = parseBjDay(oldRaw);
      if (!oldDay) { blocked.push(`${label}的原值无法解析`); continue; }
      const base = dayjs.tz(oldDay, BEIJING_TZ);
      const restored = (CHANGE_END_DATE_FIELDS[c.field] ? base.endOf('day') : base.startOf('day')).toDate();
      assignments.push({ key: c.field, value: restored });
      preview.push({ label, from: curDay, to: oldDay });
      continue;
    }

    // ---- 数值设置型 ----
    if (CHANGE_NUMERIC_SET_FIELDS.includes(c.field)) {
      if (Number(userPackage[c.field]) !== Number(newRaw)) { blocked.push(`${label}在此之后又被修改过，无法自动撤回`); continue; }
      const oldN = Number(oldRaw);
      if (isNaN(oldN)) { blocked.push(`${label}的原值无法解析`); continue; }
      assignments.push({ key: c.field, value: oldN });
      preview.push({ label, from: String(userPackage[c.field]), to: String(oldN) });
      continue;
    }

    // ---- 普通字符串设置型（status、remark、usable_before/after、duration_unit 等）----
    if (normLogValue(userPackage[c.field]) !== newRaw) {
      blocked.push(`${label}在此之后又被修改过，无法自动撤回`);
      continue;
    }
    assignments.push({ key: c.field, value: oldRaw });
    preview.push({ label, from: newRaw, to: oldRaw });
  }

  // 有总次数变更：次卡按"新total - 实际消耗"重算剩余（与修改套餐同一公式，会员已用次数自动保留）；
  // 其余类型（时间卡哨兵值）按增量还原
  if (newTotal !== null && blocked.length === 0) {
    if (userPackage.package_type === 'count_card') {
      const bookings = await Booking.find({ user_package_id: userPackage._id }).select('credits_deducted credits_refunded');
      const consumed = bookings.reduce((sum, b) => sum + Math.max(0, (Number(b.credits_deducted) || 0) - (Number(b.credits_refunded) || 0)), 0);
      if (consumed > newTotal) {
        blocked.push(`会员已消耗 ${consumed} 次，超过撤回后的总次数 ${newTotal} 次，请先手动调整`);
      } else {
        assignments.push({ key: 'total_credits', value: newTotal });
        assignments.push({ key: 'remaining_credits', value: newTotal - consumed });
        preview.push({ label: '总次数', from: String(userPackage.total_credits), to: String(newTotal) });
        preview.push({ label: '剩余次数', from: String(userPackage.remaining_credits), to: String(newTotal - consumed) });
      }
    } else {
      assignments.push({ key: 'total_credits', value: newTotal });
      preview.push({ label: '总次数', from: String(userPackage.total_credits), to: String(newTotal) });
      const remChange = changes.find(c => c.field === 'remaining_credits');
      if (remChange) {
        const oldN = Number(normLogValue(remChange.old_value)), newN = Number(normLogValue(remChange.new_value));
        if (!isNaN(oldN) && !isNaN(newN)) {
          const newRemaining = Number(userPackage.remaining_credits || 0) + (oldN - newN);
          if (newRemaining < 0) {
            blocked.push('会员已使用超出撤回后的剩余次数，请先手动调整');
          } else {
            assignments.push({ key: 'remaining_credits', value: newRemaining });
            preview.push({ label: '剩余次数', from: String(userPackage.remaining_credits), to: String(newRemaining) });
          }
        }
      }
    }
  }

  if (blocked.length > 0) return { ok: false, reason: blocked.join('；') };
  return { ok: true, assignments, preview };
};

// 撤回预览（供会员详情列表接口附加 undoable 信息；执行时 revokePackageChange 内部会重新校验）
exports.previewChangeUndo = async (userPackage, changeDoc) => {
  const createdAt = changeDoc.created_at ? new Date(changeDoc.created_at) : null;
  if (changeDoc.is_undo) return { undoable: false, blocked_reason: '撤回记录不可再撤回' };
  if (changeDoc.undone_at) return { undoable: false, blocked_reason: '该变更已撤回' };
  if (!createdAt || Date.now() - createdAt.getTime() > exports.UNDO_WINDOW_MS) {
    return { undoable: false, blocked_reason: '已超过2小时撤回时限' };
  }
  const result = await checkChangeUndo(userPackage, changeDoc);
  return { undoable: result.ok, blocked_reason: result.ok ? '' : result.reason, preview: result.preview || [] };
};

// 执行撤回套餐字段变更
exports.revokePackageChange = async (changeId, operatorId, operatorName, reason) => {
  const changeDoc = await PackageChange.findById(changeId);
  if (!changeDoc) throw new Error('变更记录不存在');
  if (changeDoc.is_undo) throw new Error('撤回记录不可再撤回');
  if (changeDoc.undone_at) throw new Error('该变更已被撤回过，请勿重复操作');
  if (Date.now() - new Date(changeDoc.created_at).getTime() > exports.UNDO_WINDOW_MS) {
    throw new Error('已超过2小时撤回时限，请通过修改套餐手动调整');
  }

  const userPackage = await UserPackage.findById(changeDoc.user_package_id);
  if (!userPackage) throw new Error('关联套餐不存在');

  const result = await checkChangeUndo(userPackage, changeDoc);
  if (!result.ok) throw new Error(result.reason);

  // 应用字段赋值计划
  for (const a of result.assignments) {
    userPackage[a.key] = a.value;
    if (Array.isArray(a.value) || (a.value !== null && typeof a.value === 'object' && !(a.value instanceof Date))) {
      userPackage.markModified(a.key);
    }
  }
  // 到期日被还原时同步 original_end_date（与 updatePackage 口径一致）
  if (result.assignments.some(a => a.key === 'end_date')) {
    userPackage.original_end_date = userPackage.end_date;
  }
  await userPackage.save();

  // 原记录打撤回标记（防重复 + 前端展示）
  await PackageChange.updateOne(
    { _id: changeDoc._id },
    { $set: { undone_at: new Date(), undone_by: operatorId } }
  );

  // 写一条撤回记录（审计链完整，不物理删除任何记录；撤回记录本身不可再撤回）
  await PackageChange.create({
    user_package_id: changeDoc.user_package_id,
    user_id: changeDoc.user_id,
    store_id: changeDoc.store_id,
    operator_id: operatorId,
    operator_name: operatorName || '管理员',
    changes: changeDoc.changes || [],
    remark: reason || '撤回变更',
    is_undo: true,
    undo_of: changeDoc._id,
    member_snapshot: changeDoc.member_snapshot,
    package_snapshot: changeDoc.package_snapshot,
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'revoke_package_change',
    module: 'package',
    target_id: changeDoc.user_package_id,
    detail: `撤回用户(${changeDoc.user_id})的套餐字段变更`,
  });

  // 推送套餐变更事件给会员端，即时刷新套餐数据
  try {
    sendToUser(changeDoc.user_id, 'package_update', { action: 'revoke_change', package_id: String(changeDoc.user_package_id) });
  } catch (e) {
    console.error('[Package] 推送套餐更新事件失败:', e.message);
  }

  return userPackage;
};

exports.getMemberPackageStatus = async (userId) => {
  const packages = await UserPackage.find({ user_id: userId }).sort({ created_at: 1 });
  const activePackages = packages.filter(p => p.status === 'active' && !p.is_suspended);
  const pendingPackages = packages.filter(p => p.status === 'pending');
  const suspendedPackages = packages.filter(p => p.is_suspended);
  const expiredPackages = packages.filter(p => p.status === 'expired' || p.status === 'exhausted');

  return {
    total: packages.length,
    active: activePackages.length,
    pending: pendingPackages.length,
    suspended: suspendedPackages.length,
    expired: expiredPackages.length,
    packages: packages.map(p => ({
      _id: p._id,
      package_type: p.package_type,
      status: p.status,
      is_activated: p.is_activated,
      is_suspended: p.is_suspended,
      start_date: p.start_date,
      end_date: p.end_date,
      remaining_credits: p.remaining_credits,
      total_credits: p.total_credits,
    })),
  };
};

exports.refreshPackageStatus = async (userId) => {
  const now = new Date();
  const packages = await UserPackage.find({ user_id: userId, is_activated: true });

  let updated = 0;
  for (const pkg of packages) {
    if (pkg.status === 'active') {
      if (pkg.end_date && now > pkg.end_date) {
        pkg.status = 'expired';
        await pkg.save();
        updated++;
      } else if (pkg.package_type === 'count_card' && pkg.remaining_credits <= 0) {
        pkg.status = 'exhausted';
        await pkg.save();
        updated++;
      }
    }
  }

  return { updated, message: `更新了${updated}个套餐状态` };
};

exports.backfillActivationRecords = async () => {
  const existingActivations = await PackageActivation.find({}, 'user_package_id');
  const existingSet = new Set(existingActivations.map(a => a.user_package_id.toString()));

  const activatedPackages = await UserPackage.find({
    is_activated: true,
    status: { $in: ['active', 'expired', 'exhausted'] },
  });

  let created = 0;
  let skipped = 0;

  for (const pkg of activatedPackages) {
    if (existingSet.has(pkg._id.toString())) {
      skipped++;
      continue;
    }

    const activationType = pkg.activated_at ? 'first_booking' : 'manual_force';
    // 构建激活记录快照
    const backfillSnapshot = await exports._buildActivationSnapshot(pkg);

    await PackageActivation.create({
      user_package_id: pkg._id,
      user_id: pkg.user_id,
      package_id: pkg.package_id || null,
      store_id: pkg.store_id || null,
      activation_type: activationType,
      activated_by: null,
      activated_at: pkg.activated_at || pkg.start_date || pkg.created_at,
      remark: '系统补录',
      member_snapshot: backfillSnapshot.member_snapshot,
      package_snapshot: backfillSnapshot.package_snapshot,
    });
    created++;
  }

  return { created, skipped, total: activatedPackages.length };
};

// 清理历史遗留的虚假 UserPackage 记录（由旧版 repairDeletedUserPackages 创建）
// 这些记录 status='expired'、remaining_credits=0、remark='已删除会员套餐记录恢复'，
// 数据不真实，且套餐录入已改为从 PackageActivation 日志表查询，不再需要这些记录
exports.cleanupFakeRepairRecords = async () => {
  try {
    const result = await UserPackage.deleteMany({
      remark: '已删除会员套餐记录恢复'
    });
    if (result.deletedCount > 0) {
      console.log(`[cleanupFakeRepairRecords] 清理了 ${result.deletedCount} 条虚假恢复记录`);
    }
    return { deleted: result.deletedCount };
  } catch (err) {
    console.error('[cleanupFakeRepairRecords] 清理失败:', err);
    return { deleted: 0 };
  }
};

// 修复历史 PackageActivation 记录中缺失的快照数据
// 从关联的 UserPackage 记录中回填 member_snapshot 和 package_snapshot
// UserPackage 在创建时就保存了会员和套餐快照，是真实数据源
// 注意：MongoDB 查询 { 'member_snapshot.real_name': '' } 不匹配 member_snapshot 字段不存在的旧文档，
// 必须同时用 $exists: false 捕获这些记录
exports.repairActivationSnapshots = async () => {
  const BATCH_SIZE = 100;
  let repairedMember = 0;
  let repairedPackage = 0;
  let hasMore = true;
  let skip = 0;

  while (hasMore) {
    const records = await PackageActivation.find({
      $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' },
        { 'package_snapshot': { $exists: false } },
        { 'package_snapshot.name': '', 'package_snapshot.package_type': '' },
      ]
    })
    .limit(BATCH_SIZE)
    .skip(skip)
    .lean();

    if (records.length === 0) {
      hasMore = false;
      break;
    }

    const upIds = records.map(r => r.user_package_id).filter(Boolean);
    const userIds = records.map(r => r.user_id).filter(Boolean);
    const [userPackages, users] = await Promise.all([
      UserPackage.find({ _id: { $in: upIds } })
        .select('member_snapshot package_snapshot package_type total_credits duration_value duration_unit remark')
        .lean(),
      User.find({ _id: { $in: userIds } })
        .select('real_name nick_name phone wechat_phone member_code')
        .lean()
    ]);
    const upMap = {};
    userPackages.forEach(up => { upMap[String(up._id)] = up; });
    const userMap = {};
    users.forEach(u => { userMap[String(u._id)] = u; });

    const bulkOps = [];
    for (const record of records) {
      const upId = record.user_package_id ? String(record.user_package_id) : '';
      const up = upMap[upId];
      const updateFields = {};

      const hasMemberSnapshot = record.member_snapshot && (record.member_snapshot.real_name || record.member_snapshot.nick_name);
      const hasPackageSnapshot = record.package_snapshot && (record.package_snapshot.name || record.package_snapshot.package_type);

      // 回填 member_snapshot
      if (!hasMemberSnapshot) {
        let memberData = null;

        // 优先级1: UserPackage.member_snapshot（创建套餐时保存的快照）
        if (up && up.member_snapshot && (up.member_snapshot.real_name || up.member_snapshot.nick_name)) {
          memberData = up.member_snapshot;
        }
        // 优先级2: User 表直查（会员可能未被物理删除，或软删除仍保留数据）
        if (!memberData) {
          const uid = record.user_id ? String(record.user_id) : '';
          const userDoc = userMap[uid];
          if (userDoc && (userDoc.real_name || userDoc.nick_name)) {
            memberData = {
              real_name: userDoc.real_name || '',
              nick_name: userDoc.nick_name || '',
              phone: userDoc.phone || '',
              wechat_phone: userDoc.wechat_phone || '',
              member_code: userDoc.member_code || '',
            };
          }
        }
        // 优先级3: 从 UserPackage.remark 提取会员名（删除会员时 remark 格式："张三 的套餐（会员已删除）"）
        if (!memberData && up && up.remark) {
          const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
          if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
            memberData = {
              real_name: nameMatch[1].trim(),
              nick_name: '',
              phone: '',
              wechat_phone: '',
              member_code: '',
            };
          }
        }

        if (memberData) {
          updateFields['member_snapshot'] = memberData;
          repairedMember++;
        }
      }

      // 回填 package_snapshot
      if (!hasPackageSnapshot && up) {
        const upPs = up.package_snapshot || {};
        updateFields['package_snapshot'] = {
          name: upPs.name || '',
          package_type: up.package_type || upPs.package_type || '',
          total_credits: up.total_credits || upPs.total_credits || 0,
          duration_value: up.duration_value || upPs.duration_value || 0,
          duration_unit: up.duration_unit || upPs.duration_unit || '',
        };
        repairedPackage++;
      }

      if (Object.keys(updateFields).length > 0) {
        bulkOps.push({
          updateOne: {
            filter: { _id: record._id },
            update: { $set: updateFields }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      await PackageActivation.bulkWrite(bulkOps);
    }

    skip += BATCH_SIZE;
  }

  console.log(`[repairActivationSnapshots] 回填完成: member_snapshot=${repairedMember}, package_snapshot=${repairedPackage}`);
  return { repaired_member_snapshot: repairedMember, repaired_package_snapshot: repairedPackage };
};

// 修复历史 PackageExtension 记录中缺失的快照数据
// 从关联的 UserPackage 记录中回填 member_snapshot 和 package_snapshot
// 注意：MongoDB 查询 { 'member_snapshot.real_name': '' } 不匹配 member_snapshot 字段不存在的旧文档
exports.repairExtensionSnapshots = async () => {
  const BATCH_SIZE = 100;
  let repairedMember = 0;
  let repairedPackage = 0;
  let hasMore = true;
  let skip = 0;

  while (hasMore) {
    const records = await PackageExtension.find({
      $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' },
        { 'package_snapshot': { $exists: false } },
        { 'package_snapshot.name': '', 'package_snapshot.package_type': '' },
      ]
    })
    .limit(BATCH_SIZE)
    .skip(skip)
    .lean();

    if (records.length === 0) {
      hasMore = false;
      break;
    }

    const upIds = records.map(r => r.user_package_id).filter(Boolean);
    const userIds = records.map(r => r.user_id).filter(Boolean);
    const [userPackages, users] = await Promise.all([
      UserPackage.find({ _id: { $in: upIds } })
        .select('member_snapshot package_snapshot package_type total_credits remark')
        .lean(),
      User.find({ _id: { $in: userIds } })
        .select('real_name nick_name phone wechat_phone member_code')
        .lean()
    ]);
    const upMap = {};
    userPackages.forEach(up => { upMap[String(up._id)] = up; });
    const userMap = {};
    users.forEach(u => { userMap[String(u._id)] = u; });

    const bulkOps = [];
    for (const record of records) {
      const upId = record.user_package_id ? String(record.user_package_id) : '';
      const up = upMap[upId];
      const updateFields = {};

      const hasMemberSnapshot = record.member_snapshot && (record.member_snapshot.real_name || record.member_snapshot.nick_name);
      const hasPackageSnapshot = record.package_snapshot && (record.package_snapshot.name || record.package_snapshot.package_type);

      // 回填 member_snapshot
      if (!hasMemberSnapshot) {
        let memberData = null;

        // 优先级1: UserPackage.member_snapshot
        if (up && up.member_snapshot && (up.member_snapshot.real_name || up.member_snapshot.nick_name)) {
          memberData = up.member_snapshot;
        }
        // 优先级2: User 表直查
        if (!memberData) {
          const uid = record.user_id ? String(record.user_id) : '';
          const userDoc = userMap[uid];
          if (userDoc && (userDoc.real_name || userDoc.nick_name)) {
            memberData = {
              real_name: userDoc.real_name || '',
              nick_name: userDoc.nick_name || '',
              phone: userDoc.phone || '',
              wechat_phone: userDoc.wechat_phone || '',
              member_code: userDoc.member_code || '',
            };
          }
        }
        // 优先级3: 从 UserPackage.remark 提取
        if (!memberData && up && up.remark) {
          const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
          if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
            memberData = {
              real_name: nameMatch[1].trim(),
              nick_name: '',
              phone: '',
              wechat_phone: '',
              member_code: '',
            };
          }
        }

        if (memberData) {
          updateFields['member_snapshot'] = memberData;
          repairedMember++;
        }
      }

      // 回填 package_snapshot
      if (!hasPackageSnapshot && up) {
        const upPs = up.package_snapshot || {};
        updateFields['package_snapshot'] = {
          name: upPs.name || '',
          package_type: up.package_type || upPs.package_type || '',
          total_credits: up.total_credits || upPs.total_credits || 0,
        };
        repairedPackage++;
      }

      if (Object.keys(updateFields).length > 0) {
        bulkOps.push({
          updateOne: {
            filter: { _id: record._id },
            update: { $set: updateFields }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      await PackageExtension.bulkWrite(bulkOps);
    }

    skip += BATCH_SIZE;
  }

  console.log(`[repairExtensionSnapshots] 回填完成: member_snapshot=${repairedMember}, package_snapshot=${repairedPackage}`);
  return { repaired_member_snapshot: repairedMember, repaired_package_snapshot: repairedPackage };
};

// 修复历史 UserPackage 记录中缺失的 member_snapshot
// 从 User 表（存在则取真实数据）或 remark 字段（已删除会员）回填会员快照
// 确保即使会员被删除，套餐录入记录也能显示真实会员姓名
exports.repairUserPackageMemberSnapshots = async () => {
  const BATCH_SIZE = 100;
  let repaired = 0;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const userPackages = await UserPackage.find({
      $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' }
      ]
    })
    .select('user_id member_snapshot remark')
    .skip(skip)
    .limit(BATCH_SIZE)
    .lean();

    if (userPackages.length === 0) {
      hasMore = false;
      break;
    }

    const userIds = userPackages.map(up => up.user_id).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } })
      .select('real_name nick_name phone wechat_phone member_code')
      .lean();
    const userMap = {};
    users.forEach(u => { userMap[String(u._id)] = u; });

    const bulkOps = [];
    for (const up of userPackages) {
      const uid = up.user_id ? String(up.user_id) : '';
      const user = userMap[uid];
      let memberData = null;

      if (user && (user.real_name || user.nick_name)) {
        // 用户存在：使用真实数据
        memberData = {
          real_name: user.real_name || '',
          nick_name: user.nick_name || '',
          phone: user.phone || '',
          wechat_phone: user.wechat_phone || '',
          member_code: user.member_code || '',
        };
      } else if (up.remark) {
        // 用户已删除：从 remark 提取会员名（格式："张三 的套餐（会员已删除）"）
        const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
        if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
          memberData = {
            real_name: nameMatch[1].trim(),
            nick_name: '',
            phone: '',
            wechat_phone: '',
            member_code: '',
          };
        }
      }

      if (memberData) {
        bulkOps.push({
          updateOne: {
            filter: { _id: up._id },
            update: { $set: { member_snapshot: memberData } }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      const result = await UserPackage.bulkWrite(bulkOps);
      repaired += result.modifiedCount;
    }

    skip += BATCH_SIZE;
  }

  console.log(`[repairUserPackageMemberSnapshots] 修复了 ${repaired} 条UserPackage记录的member_snapshot`);
  return { repaired };
};

// 获取套餐录入记录（同时合并套餐变更记录）
// 直接从 UserPackage 表查询：UserPackage 每条记录就是一次套餐录入
// 同时查询 PackageChange 表：每条记录是一次套餐字段变更
// 两种记录合并按 created_at 倒序统一分页
// 支持 keyword 参数搜索会员（姓名/手机号）
exports.getEntryRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id, keyword, month } = query;

  // 清理历史遗留的虚假记录（幂等，无虚假记录时快速返回）
  try {
    await exports.cleanupFakeRepairRecords();
  } catch (e) {
    // 忽略清理失败，不影响查询
  }

  // 回填缺失的 member_snapshot（幂等，已修复则快速跳过）
  try {
    await exports.repairUserPackageMemberSnapshots();
  } catch (e) {
    console.error('[getEntryRecords] repairUserPackageMemberSnapshots 失败:', e.message);
  }

  // 构造筛选条件
  // 为支持 keyword 会员搜索：先按 keyword 在 User 表中查到匹配的 user_id 列表，再带入筛选
  let matchedUserIds = null;
  if (keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      $or: [
        { real_name: { $regex: escaped, $options: 'i' } },
        { nick_name: { $regex: escaped, $options: 'i' } },
        { reserve_phone: { $regex: escaped, $options: 'i' } },
        { wechat_phone: { $regex: escaped, $options: 'i' } }
      ]
    }).select('_id').lean();
    matchedUserIds = users.map(u => u._id);
  }

  // 录入记录筛选条件（仅 UserPackage，不再合并 PackageChange）
  // 变更记录已迁移到 getExtensionRecords（"套餐变更"TAB）
  const upFilter = { remark: { $ne: '已删除会员套餐记录恢复' } };
  if (store_id) {
    upFilter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
  }
  if (keyword) {
    // 优先匹配会员 user_id；同时兜底匹配 member_snapshot（已删除会员的情况）
    upFilter.$or = [
      { user_id: { $in: matchedUserIds } },
      { 'member_snapshot.real_name': { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { 'member_snapshot.phone': { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
    ];
  }

  // 年/月分组统计：全量口径（不带月份过滤，供前端渲染全部月份行及数字）
  const entryMonthStats = await aggregateMonthStats(UserPackage, upFilter, 'created_at');
  const { monthCounts, yearMemberCounts } = serializeMonthStats(entryMonthStats);
  // month 参数（YYYY-MM，北京时间）：按月筛选该月发生的记录
  const monthRange = getMonthRange(month);
  if (monthRange) upFilter.created_at = { $gte: monthRange.start, $lt: monthRange.end };

  const limit = Number(pageSize);
  const skip = (Number(page) - 1) * limit;

  // 按会员分组：聚合去重 user_id，按最新录入时间倒序，分页
  const userGroups = await UserPackage.aggregate([
    { $match: upFilter },
    { $group: { _id: '$user_id', latest_at: { $max: '$created_at' }, count: { $sum: 1 } } },
    { $sort: { latest_at: -1 } },
    { $skip: skip },
    { $limit: limit }
  ]);
  const userIds = userGroups.map(g => g._id).filter(Boolean);
  const totalAgg = await UserPackage.aggregate([
    { $match: upFilter },
    { $group: { _id: '$user_id' } },
    { $count: 'total' }
  ]);
  const total = (totalAgg[0] && totalAgg[0].total) || 0;

  // 拉取这些 user_id 的全部录入记录
  // fetchFilter 展开 upFilter，month 筛选时自动带上 created_at 范围（仅返回该月发生的记录）
  const fetchFilter = { ...upFilter, user_id: { $in: userIds } };
  // 清除 upFilter 中的 $or（keyword 搜索已在聚合时完成），保留 store_id 和 remark 过滤
  delete fetchFilter.$or;

  const upList = await UserPackage.find(fetchFilter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('package_id', 'name')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name username')
    .sort({ created_at: -1 })
    .lean();

  // 转换为统一的记录格式
  const records = upList.map(up => {
    const user = up.user_id;
    const pkg = up.package_id;
    const operator = up.created_by || {};
    const snapshot = up.member_snapshot || {};
    const pkgSnapshot = up.package_snapshot || {};

    let userRealName = (user && (user.real_name || user.nick_name))
      ? (user.real_name || user.nick_name)
      : (snapshot.real_name || snapshot.nick_name || '');
    if (!userRealName && up.remark) {
      const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
        userRealName = nameMatch[1].trim();
      }
    }
    if (!userRealName) userRealName = '未知会员';

    let packageName = (pkg && pkg.name) ? pkg.name : (pkgSnapshot.name || '');
    if (!packageName) {
      // 录入记录显示原始录入值（original_total_credits），而非修改后的值
      const displayTotal = up.original_total_credits !== undefined && up.original_total_credits !== null
        ? up.original_total_credits
        : up.total_credits || 0;
      if (up.package_type === 'count_card') {
        packageName = `${displayTotal}次卡`;
      } else if (up.package_type === 'time_card') {
        packageName = `${up.duration_value || ''}${up.duration_unit === 'month' ? '个月' : '天'}时间卡`;
      }
    }

    // 录入记录显示原始录入值（original_total_credits），无则回退到当前 total_credits
    const entryDisplayTotal = up.original_total_credits !== undefined && up.original_total_credits !== null
      ? up.original_total_credits
      : up.total_credits || 0;

    return {
      _id: String(up._id),
      record_type: 'entry',  // 录入记录
      user_id: up.user_id ? String(up.user_id._id || up.user_id) : '',
      user_name: userRealName,
      user_real_name: (user && user.real_name) ? user.real_name : (snapshot.real_name || ''),
      user_nick_name: (user && user.nick_name) ? user.nick_name : (snapshot.nick_name || ''),
      user_phone: (user && user.phone) ? user.phone : (snapshot.phone || ''),
      user_deleted: !user,
      package_name: packageName,
      package_type: up.package_type || '',
      total_credits: entryDisplayTotal,  // 显示原始录入值
      duration_value: up.duration_value || 0,
      duration_unit: up.duration_unit || '',
      created_at: up.created_at,
      operator_name: operator.nick_name || operator.username || '',
      remark: up.remark || '',
      status: up.status || 'active'
    };
  });

  // 对于旧数据（无 original_total_credits 字段），从 PackageChange 表回查最早的 total_credits old_value
  // 这样修改过的旧套餐在录入记录中也能显示原始录入值
  const upIdsNeedingOriginal = upList
    .filter(up => up.original_total_credits === undefined || up.original_total_credits === null)
    .map(up => up._id);
  if (upIdsNeedingOriginal.length > 0) {
    const earliestChanges = await PackageChange.aggregate([
      { $match: { user_package_id: { $in: upIdsNeedingOriginal } } },
      { $unwind: '$changes' },
      { $match: { 'changes.field': 'total_credits' } },
      { $sort: { created_at: 1 } },
      { $group: { _id: '$user_package_id', old_value: { $first: '$changes.old_value' } } }
    ]);
    const originalMap = new Map();
    earliestChanges.forEach(ec => {
      originalMap.set(String(ec._id), ec.old_value);
    });
    records.forEach((record, idx) => {
      const up = upList[idx];
      if ((up.original_total_credits === undefined || up.original_total_credits === null)) {
        const originalValueStr = originalMap.get(String(up._id));
        if (originalValueStr !== undefined) {
          const originalValue = Number(originalValueStr);
          if (!isNaN(originalValue)) {
            record.total_credits = originalValue;
            // 同步更新 package_name 中的次数
            if (up.package_type === 'count_card') {
              record.package_name = `${originalValue}次卡`;
            }
          }
        }
      }
    });
  }

  // 按 user_id 分组
  const groupList = groupRecordsByUser(records);

  return { list: groupList, total, monthCounts, yearMemberCounts, page: Number(page), pageSize: Number(pageSize) };
};
