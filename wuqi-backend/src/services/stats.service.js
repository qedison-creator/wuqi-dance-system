const Booking = require('../models/Booking');
const User = require('../models/User');
const Schedule = require('../models/Schedule');
const UserPackage = require('../models/UserPackage');
const Attendance = require('../models/Attendance');
const Config = require('../models/Config');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BEIJING_TZ = 'Asia/Shanghai';

// ===== 会员套餐状态提醒阈值配置 =====
// 结构：time_card_expire（时间卡到期）/ count_card_expire（次卡到期）{ mode, days, percent }
//       count_card_low（次卡次数）{ mode, count, percent }
//       inactive_days（久未跳舞）{ days: 超过X天未上课 }
// 前三类提醒方式二选一（mode）：
//   time_card_expire / count_card_expire: 'days'（到期前X天）或 'percent'（剩余时长低于X%）
//   count_card_low: 'count'（剩余次数低于X次）或 'percent'（剩余次数占比低于X%）
const MODE_ENUM = {
  time_card_expire: ['days', 'percent'],
  count_card_expire: ['days', 'percent'],
  count_card_low: ['count', 'percent'],
};
const DEFAULT_PACKAGE_STATUS_CONFIG = {
  time_card_expire: { mode: 'days', days: 15, percent: 15 },
  count_card_expire: { mode: 'days', days: 10, percent: 15 },
  count_card_low: { mode: 'count', count: 5, percent: 20 },
  inactive_days: { days: 30 },
};

// 读取套餐状态提醒阈值配置（带默认兜底与字段校验）
exports.getPackageStatusRemindConfig = async () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_PACKAGE_STATUS_CONFIG));
  try {
    const doc = await Config.findOne({ key: 'package_status_remind_config' });
    const val = doc && doc.value;
    if (val && typeof val === 'object') {
      ['time_card_expire', 'count_card_expire', 'count_card_low', 'inactive_days'].forEach((k) => {
        if (val[k] && typeof val[k] === 'object') {
          ['days', 'percent', 'count'].forEach((f) => {
            const n = parseInt(val[k][f], 10);
            if (!isNaN(n) && n >= 0 && n <= 100) cfg[k][f] = n;
          });
          // 提醒方式二选一校验（历史数据无 mode 时使用默认值）
          if (MODE_ENUM[k] && MODE_ENUM[k].indexOf(val[k].mode) >= 0) {
            cfg[k].mode = val[k].mode;
          }
        }
      });
    }
  } catch (err) {
    console.error('[stats] 读取套餐状态提醒配置失败，使用默认值:', err.message);
  }
  return cfg;
};

// 数据概览
exports.getOverview = async (storeId) => {
  const today = dayjs().tz(BEIJING_TZ).format('YYYY-MM-DD');
  const weekStart = dayjs().tz(BEIJING_TZ).startOf('week').add(1, 'day').format('YYYY-MM-DD');
  const monthStart = dayjs().tz(BEIJING_TZ).startOf('month').format('YYYY-MM-DD');
  const monthEnd = dayjs().tz(BEIJING_TZ).endOf('month').format('YYYY-MM-DD');

  // 今日预约数
  const todayBookingFilter = { booking_date: today, status: 'booked' };
  if (storeId) todayBookingFilter.store_id = storeId;
  const todayBookings = await Booking.countDocuments(todayBookingFilter);

  // 本周新增会员数
  const weekMemberFilter = {
    user_type: 'member',
    member_status: 'official',
    created_at: { $gte: new Date(weekStart) },
  };
  if (storeId) weekMemberFilter.store_id = storeId;
  const weekNewMembers = await User.countDocuments(weekMemberFilter);

  // 本月课时消耗(已完成预约的课时)
  const monthBookingFilter = {
    status: 'completed',
    booking_date: { $gte: monthStart, $lte: monthEnd },
  };
  if (storeId) monthBookingFilter.store_id = storeId;
  const monthCreditsUsed = await Booking.aggregate([
    { $match: monthBookingFilter },
    { $group: { _id: null, total: { $sum: '$credits_deducted' } } },
  ]);
  const monthCredits = monthCreditsUsed.length > 0 ? monthCreditsUsed[0].total : 0;

  // 活跃会员数(有active套餐的正式会员)
  const activePackageUserIds = await UserPackage.distinct('user_id', { status: 'active' });
  const activeMemberFilter = {
    _id: { $in: activePackageUserIds },
    user_type: 'member',
    member_status: 'official',
    status: 'active',
  };
  if (storeId) activeMemberFilter.store_id = storeId;
  const activeMembers = await User.countDocuments(activeMemberFilter);

  // 热门课程排行(复用 courseRanking)
  let popularCourses = [];
  try {
    popularCourses = await this.getCourseRanking(storeId, 'week', 5);
  } catch (e) {}

  return {
    today_bookings: todayBookings,
    week_new_members: weekNewMembers,
    month_credits_used: monthCredits,
    active_members: activeMembers,
    popularCourses,
  };
};

// 预约趋势
exports.getBookingTrend = async (storeId, period, startDate, endDate) => {
  // 确定时间范围
  let start, end, format;
  if (startDate && endDate) {
    start = dayjs(startDate);
    end = dayjs(endDate);
  } else {
    switch (period) {
      case 'week':
        start = dayjs().tz(BEIJING_TZ).subtract(7, 'day');
        end = dayjs().tz(BEIJING_TZ);
        format = 'YYYY-MM-DD';
        break;
      case 'month':
        start = dayjs().tz(BEIJING_TZ).subtract(30, 'day');
        end = dayjs().tz(BEIJING_TZ);
        format = 'YYYY-MM-DD';
        break;
      case 'year':
        start = dayjs().tz(BEIJING_TZ).subtract(12, 'month').startOf('month');
        end = dayjs().tz(BEIJING_TZ).endOf('month');
        format = 'YYYY-MM';
        break;
      default:
        start = dayjs().tz(BEIJING_TZ).subtract(7, 'day');
        end = dayjs().tz(BEIJING_TZ);
        format = 'YYYY-MM-DD';
    }
  }

  format = format || 'YYYY-MM-DD';

  const matchFilter = {
    booking_date: { $gte: start.format('YYYY-MM-DD'), $lte: end.format('YYYY-MM-DD') },
  };
  if (storeId) matchFilter.store_id = storeId;

  // 按日期聚合预约数
  const trend = await Booking.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$booking_date',
        count: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return trend.map(item => ({
    date: item._id,
    total: item.count,
    completed: item.completed,
    cancelled: item.cancelled,
  }));
};

// 课程排行(按预约数排序)
exports.getCourseRanking = async (storeId, period, limit) => {
  let startDate;
  const now = dayjs().tz(BEIJING_TZ);

  switch (period) {
    case 'week':
      startDate = now.subtract(7, 'day').format('YYYY-MM-DD');
      break;
    case 'month':
      startDate = now.subtract(30, 'day').format('YYYY-MM-DD');
      break;
    case 'year':
      startDate = now.subtract(12, 'month').format('YYYY-MM-DD');
      break;
    default:
      startDate = now.subtract(7, 'day').format('YYYY-MM-DD');
  }

  const finalLimit = Math.min(Number(limit) || 10, 50);

  const matchFilter = {
    booking_date: { $gte: startDate },
    status: { $in: ['booked', 'completed'] },
  };
  if (storeId) matchFilter.store_id = storeId;

  const ranking = await Booking.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$schedule_id',
        booking_count: { $sum: 1 },
        completed_count: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
      },
    },
    { $sort: { booking_count: -1 } },
    { $limit: finalLimit },
    {
      $lookup: {
        from: 'schedules',
        localField: '_id',
        foreignField: '_id',
        as: 'schedule',
      },
    },
    { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'dancestyles',
        localField: 'schedule.dance_style_id',
        foreignField: '_id',
        as: 'dance_style',
      },
    },
    {
      $lookup: {
        from: 'coaches',
        localField: 'schedule.coach_id',
        foreignField: '_id',
        as: 'coach',
      },
    },
    {
      $project: {
        schedule_id: '$_id',
        course_name: { $ifNull: ['$schedule.course_name', ''] },
        dance_style_name: { $arrayElemAt: ['$dance_style.name', 0] },
        coach_name: { $arrayElemAt: ['$coach.name', 0] },
        booking_count: 1,
        completed_count: 1,
      },
    },
  ]);

  return ranking;
};

// 获取预约统计(管理端)
exports.getBookingStats = async (query) => {
  const { store_id, start_date, end_date } = query;
  const matchFilter = {};

  if (store_id) matchFilter.store_id = store_id;
  if (start_date && end_date) {
    matchFilter.booking_date = { $gte: start_date, $lte: end_date };
  }

  const stats = await Booking.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        booked: { $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        total_credits: { $sum: '$credits_deducted' },
      },
    },
  ]);

  return stats.length > 0 ? stats[0] : { total: 0, booked: 0, completed: 0, cancelled: 0, total_credits: 0 };
};

// 获取会员统计
exports.getMemberStats = async (storeId) => {
  const filter = { user_type: 'member' };
  if (storeId) filter.store_id = storeId;

  const total = await User.countDocuments(filter);
  const official = await User.countDocuments({ ...filter, member_status: 'official' });
  const registered = await User.countDocuments({ ...filter, member_status: 'registered' });
  const active = await User.countDocuments({ ...filter, status: 'active' });

  return { total, official, registered, active };
};

// 获取营收统计
exports.getRevenueStats = async (query) => {
  // 营收统计基于套餐购买记录，此处返回基础数据
  const { store_id, start_date, end_date } = query;
  const filter = {};

  // 修复 BUG：store_id 解构后未加入 filter，导致营收统计跨门店聚合
  if (store_id) filter.store_id = store_id;

  if (start_date && end_date) {
    filter.created_at = { $gte: new Date(start_date), $lte: new Date(end_date + ' 23:59:59') };
  }

  const stats = await UserPackage.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total_packages: { $sum: 1 },
        total_credits: { $sum: '$total_credits' },
      },
    },
  ]);

  return stats.length > 0 ? stats[0] : { total_packages: 0, total_credits: 0 };
};

// 获取数据看板数据
exports.getDashboardData = async (storeId) => {
  const today = dayjs().tz(BEIJING_TZ).format('YYYY-MM-DD');
  const weekStart = dayjs().tz(BEIJING_TZ).subtract(6, 'day').format('YYYY-MM-DD');
  const weekEnd = dayjs().tz(BEIJING_TZ).format('YYYY-MM-DD');

  // 1. 今日课程预约概况
  const todayBookingFilter = { booking_date: today };
  if (storeId) todayBookingFilter.store_id = storeId;
  
  const todayBookingsByCourse = await Booking.aggregate([
    { $match: todayBookingFilter },
    {
      $group: {
        _id: '$schedule_id',
        booking_count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'schedules',
        localField: '_id',
        foreignField: '_id',
        as: 'schedule',
      },
    },
    { $unwind: { path: '$schedule', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        course_name: { $ifNull: ['$schedule.course_name', '未知课程'] },
        booking_count: 1,
      },
    },
    { $sort: { booking_count: -1 } },
  ]);

  // 2. 时间卡快到期提醒
  const timeCardFilter = {
    package_type: 'time_card',
    is_activated: true,
    status: 'active',
    end_date: { $exists: true, $ne: null },
  };
  if (storeId) timeCardFilter.store_id = storeId;
  
  const expiringTimeCards = await UserPackage.find(timeCardFilter)
    .populate('user_id', 'real_name nick_name')
    .lean();
  
  const now = dayjs().tz(BEIJING_TZ);
  // 提醒阈值从配置读取（会员套餐状态管理页设置，首页待办同步服从）
  const remindCfg = await this.getPackageStatusRemindConfig();
  const timeCardCfg = remindCfg.time_card_expire;
  const expiringTimeCardMembers = expiringTimeCards
    .map(pkg => {
      const endDate = dayjs(pkg.end_date);
      const startDate = dayjs(pkg.start_date);
      const totalDays = endDate.diff(startDate, 'day');
      // 剩余天数统一用 Math.ceil（与会员详情页 member-detail 的剩余天数算法一致），避免 floor/ceil 差1天
      const remainingDays = Math.ceil((endDate.valueOf() - now.valueOf()) / (1000 * 60 * 60 * 24));
      const remainingPercent = totalDays > 0 ? (remainingDays / totalDays) * 100 : 0;

      // 阈值规则（二选一，由 mode 决定）：'days'=到期前X天；'percent'=剩余时长占比低于X%
      const isTimeCardHit = timeCardCfg.mode === 'percent'
        ? remainingPercent < timeCardCfg.percent
        : remainingDays <= timeCardCfg.days;
      const isExpiring = remainingDays >= 0 && isTimeCardHit;

      return {
        user_id: pkg.user_id?._id,
        user_name: pkg.user_id?.real_name || pkg.user_id?.nick_name || '未知会员',
        remaining_days: remainingDays,
        end_date: pkg.end_date,
        total_days: totalDays,
        threshold: timeCardCfg.percent,
        is_expiring: isExpiring,
      };
    })
    .filter(m => m.is_expiring)
    .sort((a, b) => a.remaining_days - b.remaining_days);

  // 3. 次卡会员跟进提醒
  const countCardFilter = {
    package_type: 'count_card',
    is_activated: true,
    status: 'active',
  };
  if (storeId) countCardFilter.store_id = storeId;
  
  const countCards = await UserPackage.find(countCardFilter)
    .populate('user_id', 'real_name nick_name')
    .lean();
  
  const countCardMembers = countCards
    .map(pkg => {
      const endDate = pkg.end_date ? dayjs(pkg.end_date) : null;
      const startDate = pkg.start_date ? dayjs(pkg.start_date) : null;
      const totalDays = endDate && startDate ? endDate.diff(startDate, 'day') : 0;
      // 剩余天数统一用 Math.ceil（与会员详情页 member-detail 的剩余天数算法一致），避免 floor/ceil 差1天
      const remainingDays = endDate ? Math.ceil((endDate.valueOf() - now.valueOf()) / (1000 * 60 * 60 * 24)) : 999;
      const remainingPercent = totalDays > 0 ? (remainingDays / totalDays) * 100 : 100;

      // 次卡阈值规则（二选一，由 mode 决定）：
      // 到期：'days'=到期前X天；'percent'=剩余时长占比低于X%
      // 次数：'count'=剩余次数低于X次；'percent'=剩余次数占比低于X%
      const expireCfg = remindCfg.count_card_expire;
      const lowCfg = remindCfg.count_card_low;
      const creditsPercent = (pkg.total_credits || 0) > 0
        ? ((pkg.remaining_credits || 0) / pkg.total_credits) * 100 : 0;

      const isLowCredits = lowCfg.mode === 'percent'
        ? creditsPercent < lowCfg.percent
        : (pkg.remaining_credits || 0) <= lowCfg.count;
      const isExpireHit = expireCfg.mode === 'percent'
        ? remainingPercent < expireCfg.percent
        : remainingDays <= expireCfg.days;
      const isExpiring = remainingDays >= 0 && isExpireHit;

      return {
        user_id: pkg.user_id?._id,
        user_name: pkg.user_id?.real_name || pkg.user_id?.nick_name || '未知会员',
        remaining_credits: pkg.remaining_credits || 0,
        total_credits: pkg.total_credits || 0,
        remaining_days: remainingDays,
        end_date: pkg.end_date,
        is_low_credits: isLowCredits,
        is_expiring: isExpiring,
        alert_reason: isLowCredits && isExpiring ? '次数少且快到期' : (isLowCredits ? '次数少' : '快到期'),
      };
    })
    .filter(m => m.is_low_credits || m.is_expiring)
    .sort((a, b) => {
      // 先按剩余天数排序，天数相同按剩余次数排序
      if (a.remaining_days !== b.remaining_days) {
        return a.remaining_days - b.remaining_days;
      }
      return a.remaining_credits - b.remaining_credits;
    });

  // 4. 近期课程安排（未来7天，不含今天）— 用于首页待办角标统计，不限制数量
  // 注意：今天的课程由"今日课程"待办项单独统计，这里排除今天避免重复
  const upcomingFilter = {
    date: { $gt: today, $lte: dayjs().tz(BEIJING_TZ).add(7, 'day').format('YYYY-MM-DD') },
    status: { $in: ['available', 'full'] },
  };
  if (storeId) upcomingFilter.store_id = storeId;
  
  const upcomingSchedules = await Schedule.find(upcomingFilter)
    .populate('coach_id', 'name')
    .populate('dance_style_id', 'name')
    .populate('store_id', 'name')
    .sort({ date: 1, start_time: 1 })
    .lean();
  
  const upcomingCourses = await Promise.all(
    upcomingSchedules.map(async s => {
      const bookingCount = await Booking.countDocuments({
        schedule_id: s._id,
        status: { $in: ['booked', 'completed'] },
      });
      return {
        date: s.date,
        course_name: s.course_name || s.dance_style_id?.name || '未知课程',
        store_name: s.store_id?.name || '未知门店',
        coach_name: s.coach_id?.name || '未知教练',
        time: `${s.start_time || ''}-${s.end_time || ''}`,
        booking_count: bookingCount,
        capacity: s.max_bookings || 0,
      };
    })
  );

  // 5. 排课覆盖最远日期（用于首页"排课即将到期"提醒）
  // 统计该门店未来所有有效排课中最远的一节课日期，计算距今剩余天数
  // 排除已取消/下线/删除/已完成等无效状态
  const scheduleCoverageFilter = {
    date: { $gt: today },
    status: { $in: ['available', 'full', 'not_open', 'in_progress'] },
  };
  if (storeId) scheduleCoverageFilter.store_id = storeId;

  const latestSchedule = await Schedule.findOne(scheduleCoverageFilter)
    .sort({ date: -1 })
    .lean();

  let scheduleCoverage = null;
  if (latestSchedule) {
    const latestDate = dayjs(latestSchedule.date);
    const remainingDays = latestDate.diff(today, 'day');
    scheduleCoverage = {
      latest_date: latestSchedule.date,
      remaining_days: remainingDays,
    };
  }

  // 6. 会员套餐状态分布
  const packageStatusFilter = {};
  if (storeId) packageStatusFilter.store_id = storeId;
  
  const packageStatusDist = await UserPackage.aggregate([
    { $match: packageStatusFilter },
    {
      $group: {
        _id: {
          $cond: {
            if: { $and: [{ $eq: ['$status', 'active'] }, { $eq: ['$is_suspended', true] }] },
            then: 'suspended',
            else: '$status'
          }
        },
        count: { $sum: 1 },
      },
    },
  ]);
  
  const packageDistribution = {
    active: 0,
    pending: 0,
    expired: 0,
    exhausted: 0,
    suspended: 0,
  };
  packageStatusDist.forEach(item => {
    if (packageDistribution.hasOwnProperty(item._id)) {
      packageDistribution[item._id] = item.count;
    }
  });

  // 6. 本周预约趋势（最近7天）
  const weeklyTrendFilter = {
    booking_date: { $gte: weekStart, $lte: weekEnd },
  };
  if (storeId) weeklyTrendFilter.store_id = storeId;
  
  const weeklyTrendRaw = await Booking.aggregate([
    { $match: weeklyTrendFilter },
    {
      $group: {
        _id: '$booking_date',
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  
  const weeklyBookingTrend = [];
  for (let i = 0; i < 7; i++) {
    const date = dayjs().tz(BEIJING_TZ).subtract(6 - i, 'day').format('YYYY-MM-DD');
    const dayData = weeklyTrendRaw.find(d => d._id === date);
    weeklyBookingTrend.push({
      date,
      count: dayData ? dayData.count : 0,
    });
  }

  return {
    today_bookings_by_course: todayBookingsByCourse,
    expiring_time_cards: expiringTimeCardMembers,
    count_card_alerts: countCardMembers,
    upcoming_schedules: upcomingCourses,
    schedule_coverage: scheduleCoverage,
    package_status_distribution: packageDistribution,
    weekly_booking_trend: weeklyBookingTrend,
  };
};

// 会员套餐状态管理页：四类会员名单（时间卡到期/次卡到期/次卡次数不足/久未到店）
// 阈值与首页待办同源（package_status_remind_config），保证两处提醒口径一致
exports.getPackageStatusList = async function (storeId) {
  const cfg = await this.getPackageStatusRemindConfig();
  const now = dayjs().tz(BEIJING_TZ);

  const pkgFilter = {
    is_activated: true,
    status: 'active',
    user_id: { $ne: null },
  };
  if (storeId) pkgFilter.store_id = storeId;

  // 拉取全部激活套餐（populate 用户 + 门店名）
  const packages = await UserPackage.find(pkgFilter)
    .populate('user_id', 'real_name nick_name avatar_url phone wechat_phone reserve_phone')
    .populate('store_id', 'name')
    .lean();

  const timeCardExpiring = [];
  const countCardExpiring = [];
  const countCardLow = [];

  packages.forEach(pkg => {
    if (!pkg.user_id) return;
    const endDate = pkg.end_date ? dayjs(pkg.end_date) : null;
    const startDate = pkg.start_date ? dayjs(pkg.start_date) : null;
    const totalDays = endDate && startDate ? endDate.diff(startDate, 'day') : 0;
    const remainingDays = endDate ? Math.ceil((endDate.valueOf() - now.valueOf()) / (1000 * 60 * 60 * 24)) : 999;
    const remainingPercent = totalDays > 0 ? (remainingDays / totalDays) * 100 : 100;
    const base = {
      user_id: pkg.user_id._id,
      user_name: pkg.user_id.real_name || pkg.user_id.nick_name || '未知会员',
      avatar_url: pkg.user_id.avatar_url || '',
      phone: pkg.user_id.wechat_phone || pkg.user_id.reserve_phone || pkg.user_id.phone || '',
      package_name: pkg.name || '',
      package_type: pkg.package_type,
      remaining_credits: pkg.remaining_credits || 0,
      total_credits: pkg.total_credits || 0,
      remaining_days: remainingDays,
      end_date: pkg.end_date,
      store_name: (pkg.store_id && pkg.store_id.name) || '',
    };

    if (pkg.package_type === 'time_card' && endDate) {
      // 二选一（mode）：'days'=到期前X天；'percent'=剩余时长占比低于X%
      const isHit = cfg.time_card_expire.mode === 'percent'
        ? remainingPercent < cfg.time_card_expire.percent
        : remainingDays <= cfg.time_card_expire.days;
      if (remainingDays >= 0 && isHit) timeCardExpiring.push(base);
    } else if (pkg.package_type === 'count_card') {
      const creditsPercent = (pkg.total_credits || 0) > 0
        ? ((pkg.remaining_credits || 0) / pkg.total_credits) * 100 : 0;
      // 到期二选一：'days'=到期前X天；'percent'=剩余时长占比低于X%
      const isExpireHit = endDate && remainingDays >= 0 && (
        cfg.count_card_expire.mode === 'percent'
          ? remainingPercent < cfg.count_card_expire.percent
          : remainingDays <= cfg.count_card_expire.days
      );
      // 次数二选一：'count'=剩余次数低于X次；'percent'=剩余次数占比低于X%
      const isLowHit = cfg.count_card_low.mode === 'percent'
        ? creditsPercent < cfg.count_card_low.percent
        : (pkg.remaining_credits || 0) <= cfg.count_card_low.count;
      if (isExpireHit) countCardExpiring.push(base);
      if (isLowHit) countCardLow.push({ ...base, credits_percent: Math.round(creditsPercent) });
    }
  });

  const byRemainingDays = (a, b) => a.remaining_days - b.remaining_days;
  timeCardExpiring.sort(byRemainingDays);
  countCardExpiring.sort(byRemainingDays);
  countCardLow.sort((a, b) => a.remaining_credits - b.remaining_credits);

  // 久未跳舞：只统计套餐正常使用中的会员（active、未停卡、次数未用完），
  // 最后上课（签到）时间距今超过 inactive_days 天（从未上过课的不算）
  const inactiveDays = cfg.inactive_days.days;
  const inactiveMembers = [];
  if (inactiveDays > 0) {
    // 正常使用中的套餐：status=active 且未停卡；次卡还需剩余次数>0（过期/用完/停卡的不提醒）
    const isUsable = (pkg) => pkg.status === 'active' && !pkg.is_suspended &&
      (pkg.package_type === 'time_card' || (pkg.remaining_credits || 0) > 0);

    const lastAttendedAgg = await Attendance.aggregate([
      { $group: { _id: '$user_id', last_attended: { $max: '$check_in_time' } } },
    ]);
    const lastAttendedMap = new Map();
    lastAttendedAgg.forEach(item => {
      if (item._id) lastAttendedMap.set(String(item._id), item.last_attended);
    });

    // 会员去重（一个会员可能有多张激活套餐）
    const seen = new Set();
    packages.forEach(pkg => {
      if (!pkg.user_id || !isUsable(pkg)) return;
      const uid = String(pkg.user_id._id);
      if (seen.has(uid)) return;
      seen.add(uid);
      const last = lastAttendedMap.get(uid);
      if (!last) return; // 从未上过课的不算"久未跳舞"
      const daysSince = now.diff(dayjs(last), 'day');
      if (daysSince >= inactiveDays) {
        inactiveMembers.push({
          user_id: pkg.user_id._id,
          user_name: pkg.user_id.real_name || pkg.user_id.nick_name || '未知会员',
          avatar_url: pkg.user_id.avatar_url || '',
          phone: pkg.user_id.wechat_phone || pkg.user_id.reserve_phone || pkg.user_id.phone || '',
          package_name: pkg.name || '',
          package_type: pkg.package_type,
          last_attended: last,
          days_since: daysSince,
          store_name: (pkg.store_id && pkg.store_id.name) || '',
        });
      }
    });
    inactiveMembers.sort((a, b) => b.days_since - a.days_since);
  }

  return {
    config: cfg,
    time_card_expiring: timeCardExpiring,
    count_card_expiring: countCardExpiring,
    count_card_low: countCardLow,
    inactive_members: inactiveMembers,
  };
};
