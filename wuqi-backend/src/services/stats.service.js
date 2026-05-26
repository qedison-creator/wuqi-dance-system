const Booking = require('../models/Booking');
const User = require('../models/User');
const Schedule = require('../models/Schedule');
const UserPackage = require('../models/UserPackage');
const dayjs = require('dayjs');

// 数据概览
exports.getOverview = async (storeId) => {
  const today = dayjs().format('YYYY-MM-DD');
  const weekStart = dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD');

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
        start = dayjs().subtract(7, 'day');
        end = dayjs();
        format = 'YYYY-MM-DD';
        break;
      case 'month':
        start = dayjs().subtract(30, 'day');
        end = dayjs();
        format = 'YYYY-MM-DD';
        break;
      case 'year':
        start = dayjs().subtract(12, 'month').startOf('month');
        end = dayjs().endOf('month');
        format = 'YYYY-MM';
        break;
      default:
        start = dayjs().subtract(7, 'day');
        end = dayjs();
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
  const now = dayjs();

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

// 获取教练统计
exports.getCoachStats = async (storeId) => {
  const Coach = require('../models/Coach');
  const filter = {};
  if (storeId) filter.store_id = storeId;

  const coaches = await Coach.find(filter).select('name avatar_url');

  const result = [];
  for (const coach of coaches) {
    const scheduleCount = await Schedule.countDocuments({
      coach_id: coach._id,
      status: { $in: ['available', 'full'] },
    });

    const bookingStats = await Booking.aggregate([
      {
        $match: {
          coach_id: coach._id,
          status: 'completed',
        },
      },
      {
        $group: {
          _id: null,
          total_bookings: { $sum: 1 },
          total_credits: { $sum: '$credits_deducted' },
        },
      },
    ]);

    result.push({
      coach_id: coach._id,
      name: coach.name,
      avatar_url: coach.avatar_url,
      schedule_count: scheduleCount,
      total_bookings: bookingStats.length > 0 ? bookingStats[0].total_bookings : 0,
      total_credits: bookingStats.length > 0 ? bookingStats[0].total_credits : 0,
    });
  }

  return result;
};

// 获取数据看板数据
exports.getDashboardData = async (storeId) => {
  const today = dayjs().format('YYYY-MM-DD');
  const weekStart = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
  const weekEnd = dayjs().format('YYYY-MM-DD');

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
  
  const now = dayjs();
  const expiringTimeCardMembers = expiringTimeCards
    .map(pkg => {
      const endDate = dayjs(pkg.end_date);
      const startDate = dayjs(pkg.start_date);
      const totalDays = endDate.diff(startDate, 'day');
      const remainingDays = endDate.diff(now, 'day');
      const remainingPercent = totalDays > 0 ? (remainingDays / totalDays) * 100 : 0;
      
      // 阈值规则
      let threshold = 10;
      if (totalDays >= 180) threshold = 10;
      else if (totalDays >= 90) threshold = 20;
      else threshold = 30;
      
      return {
        user_id: pkg.user_id?._id,
        user_name: pkg.user_id?.real_name || pkg.user_id?.nick_name || '未知会员',
        remaining_days: remainingDays,
        end_date: pkg.end_date,
        total_days: totalDays,
        threshold,
        is_expiring: remainingPercent < threshold && remainingDays >= 0,
      };
    })
    .filter(m => m.is_expiring)
    .sort((a, b) => a.remaining_days - b.remaining_days)
    .slice(0, 10);

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
      const remainingDays = endDate ? endDate.diff(now, 'day') : 999;
      const remainingPercent = totalDays > 0 ? (remainingDays / totalDays) * 100 : 100;
      
      // 次卡阈值规则
      let timeThreshold = 8;
      if (totalDays <= 30) timeThreshold = 30;
      else if (totalDays < 90) timeThreshold = 15;
      else if (totalDays < 150) timeThreshold = 10;
      else timeThreshold = 8;
      
      const isLowCredits = (pkg.remaining_credits || 0) <= 3;
      const isExpiring = remainingPercent < timeThreshold && remainingDays >= 0;
      
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
    })
    .slice(0, 10);

  // 4. 近期课程安排（未来7天）
  const upcomingFilter = {
    date: { $gte: today, $lte: dayjs().add(6, 'day').format('YYYY-MM-DD') },
    status: { $in: ['available', 'full'] },
  };
  if (storeId) upcomingFilter.store_id = storeId;
  
  const upcomingSchedules = await Schedule.find(upcomingFilter)
    .populate('coach_id', 'name')
    .populate('dance_style_id', 'name')
    .populate('store_id', 'name')
    .sort({ date: 1, start_time: 1 })
    .limit(10)
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

  // 5. 会员套餐状态分布
  const packageStatusFilter = {};
  if (storeId) packageStatusFilter.store_id = storeId;
  
  const packageStatusDist = await UserPackage.aggregate([
    { $match: packageStatusFilter },
    {
      $group: {
        _id: '$status',
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
    const date = dayjs().subtract(6 - i, 'day').format('YYYY-MM-DD');
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
    package_status_distribution: packageDistribution,
    weekly_booking_trend: weeklyBookingTrend,
  };
};
