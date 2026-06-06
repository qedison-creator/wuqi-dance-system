const Attendance = require('../models/Attendance');
const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const UserPackage = require('../models/UserPackage');
const PackageActivation = require('../models/PackageActivation');
const User = require('../models/User');
const logService = require('./log.service');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const BEIJING_TZ = 'Asia/Shanghai';

async function calcTimeCardUsage(userPackage) {
  const now = dayjs().tz(BEIJING_TZ);
  const result = {
    weekly_used: null, weekly_limit: null, weekly_remaining: null,
    daily_used: null, daily_limit: null, daily_remaining: null,
    next_week_used: null, next_week_remaining: null,
    next_week_start: null, next_week_end: null,
  };

  if (userPackage.weekly_limit) {
    const weekStart = now.startOf('isoWeek');
    const weekEnd = now.endOf('isoWeek');
    const usedThisWeek = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: { $gte: weekStart.format('YYYY-MM-DD'), $lte: weekEnd.format('YYYY-MM-DD') },
      $or: [{ status: { $in: ['booked', 'completed', 'absent'] } }, { booking_status: { $in: ['booked', 'completed'] } }],
    });
    result.weekly_used = usedThisWeek;
    result.weekly_limit = userPackage.weekly_limit;
    result.weekly_remaining = Math.max(0, userPackage.weekly_limit - usedThisWeek);

    const nextWeekStart = now.add(1, 'week').startOf('isoWeek');
    const nextWeekEnd = now.add(1, 'week').endOf('isoWeek');
    const usedNextWeek = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: { $gte: nextWeekStart.format('YYYY-MM-DD'), $lte: nextWeekEnd.format('YYYY-MM-DD') },
      $or: [{ status: { $in: ['booked', 'completed', 'absent'] } }, { booking_status: { $in: ['booked', 'completed'] } }],
    });
    result.next_week_used = usedNextWeek;
    result.next_week_remaining = Math.max(0, userPackage.weekly_limit - usedNextWeek);
    result.next_week_start = nextWeekStart.format('YYYY-MM-DD');
    result.next_week_end = nextWeekEnd.format('YYYY-MM-DD');
  }

  if (userPackage.daily_limit) {
    const todayStr = now.format('YYYY-MM-DD');
    const usedToday = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: todayStr,
      $or: [{ status: { $in: ['booked', 'completed', 'absent'] } }, { booking_status: { $in: ['booked', 'completed'] } }],
    });
    result.daily_used = usedToday;
    result.daily_limit = userPackage.daily_limit;
    result.daily_remaining = Math.max(0, userPackage.daily_limit - usedToday);
  }

  return result;
}

exports.createAttendance = async (data) => {
  const existing = await Attendance.findOne({
    schedule_id: data.schedule_id,
    user_id: data.user_id,
  });

  if (existing) {
    return existing;
  }

  const attendance = await Attendance.create(data);

  if (data.check_in_by) {
    await logService.createLog({
      operator_id: data.check_in_by,
      action: 'check_in',
      module: 'attendance',
      target_id: attendance._id,
      detail: `会员签到成功 (${data.source})`,
    });
  }

  return attendance;
};

exports.getAttendanceBySchedule = async (scheduleId) => {
  const attendances = await Attendance.find({ schedule_id: scheduleId })
    .populate('user_id', 'nick_name real_name phone member_code avatar_url')
    .populate('check_in_by', 'nick_name')
    .sort({ check_in_time: -1 });

  const bookings = await Booking.find({
    schedule_id: scheduleId,
    status: { $ne: 'cancelled' },
  })
    .populate('user_id', 'nick_name real_name phone member_code avatar_url')
    .sort({ created_at: -1 });

  const attendedUserIds = new Set(attendances.map(a => a.user_id._id.toString()));

  const records = bookings.map(b => {
    const userId = b.user_id._id.toString();
    const att = attendances.find(a => a.user_id._id.toString() === userId);
    return {
      booking_id: b._id,
      user_id: b.user_id,
      status: b.status,
      source: b.source || 'member',
      attendance: att ? {
        id: att._id,
        source: att.source,
        check_in_time: att.check_in_time,
        check_in_by: att.check_in_by,
        credits_cost: att.credits_cost,
      } : null,
      checked_in: !!att,
      credits_deducted: b.credits_deducted || 0,
    };
  });

  const checkedInCount = records.filter(r => r.checked_in).length;
  const bookedCount = records.filter(r => r.status === 'booked' && !r.checked_in).length;
  const cancelledCount = records.filter(r => r.status === 'cancelled').length;

  return {
    total: records.length,
    checkedIn: checkedInCount,
    booked: bookedCount,
    cancelled: cancelledCount,
    records,
  };
};

exports.getMyAttendance = async (userId, page, pageSize) => {
  const filter = { user_id: userId };

  const list = await Attendance.find(filter)
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date store_id dance_style_id coach_id',
      populate: [
        { path: 'store_id', select: 'name' },
        { path: 'dance_style_id', select: 'name' },
        { path: 'coach_id', select: 'name' },
      ],
    })
    .sort({ check_in_time: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Attendance.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

exports.getMemberCheckinProfile = async (userId) => {
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error('参数格式错误_id');
  }
  
  const user = await User.findById(userId)
    .select('nick_name real_name phone member_code avatar_url store_id')
    .populate('store_id', 'name');

  if (!user) throw new Error('会员不存在');

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const userPackages = await UserPackage.find({
    user_id: userId,
    status: 'active',
  }).populate('package_id', 'name type credits limit_type daily_limit weekly_limit duration validity_period');

  const todayBookings = await Booking.find({
    user_id: userId,
    booking_date: todayStr,
    status: { $ne: 'cancelled' },
  })
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date',
      populate: [
        { path: 'dance_style_id', select: 'name' },
        { path: 'coach_id', select: 'name' },
      ],
    })
    .sort({ booking_time: 1 });

  const todayAttendances = await Attendance.find({
    user_id: userId,
    date: todayStr,
  }).select('schedule_id source');

  const attendedScheduleIds = new Set(
    todayAttendances.map(a => a.schedule_id.toString())
  );

  const bookingsWithStatus = todayBookings.map(b => ({
    booking_id: b._id,
    schedule_id: b.schedule_id._id,
    course_name: b.schedule_id.course_name || '',
    start_time: b.schedule_id.start_time || '',
    end_time: b.schedule_id.end_time || '',
    date: b.schedule_id.date || '',
    coach_name: b.schedule_id.coach_id ? b.schedule_id.coach_id.name : '',
    dance_style_name: b.schedule_id.dance_style_id ? b.schedule_id.dance_style_id.name : '',
    status: b.status,
    source: b.source || 'member',
    checked_in: attendedScheduleIds.has(b.schedule_id._id.toString()),
    credits_deducted: b.credits_deducted || 0,
  }));

  const packages = [];
  for (const up of userPackages) {
    const pkg = up.package_id || {};
    const activation = await PackageActivation.findOne({
      user_package_id: up._id,
    }).sort({ activated_at: -1 });

    let remainingDays = null;
    if (up.package_type === 'time_card' && up.end_date && up.is_activated && !up.is_suspended) {
      const now = dayjs().tz(BEIJING_TZ);
      const end = dayjs(up.end_date).tz(BEIJING_TZ);
      remainingDays = end.diff(now, 'day') + 1;
    }

    let timeCardUsage = null;
    if (up.package_type === 'time_card') {
      timeCardUsage = await calcTimeCardUsage(up);
    }

    packages.push({
      id: up._id,
      name: pkg.name || '套餐',
      type: up.package_type,
      credits_total: up.package_type === 'count_card' ? up.total_credits : null,
      credits_remaining: up.package_type === 'count_card' ? up.remaining_credits : null,
      valid_until: up.end_date ? up.end_date.toISOString().split('T')[0] : null,
      remaining_days: remainingDays,
      limit_type: pkg.limit_type,
      daily_limit: pkg.daily_limit,
      weekly_limit: pkg.weekly_limit,
      time_card_usage: timeCardUsage,
      activated_at: activation ? activation.activated_at : null,
      status: up.status,
    });
  }

  return {
    member: {
      _id: user._id,
      nick_name: user.nick_name,
      real_name: user.real_name,
      phone: user.phone,
      member_code: user.member_code,
      avatar_url: user.avatar_url,
      store_name: user.store_id ? user.store_id.name : '',
    },
    packages,
    today_bookings: bookingsWithStatus,
  };
};

exports.getCheckInStatus = async (userId) => {
  const recentAttendance = await Attendance.findOne({ user_id: userId })
    .sort({ check_in_time: -1 })
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date',
    })
    .lean();

  if (!recentAttendance) {
    return { checked_in: false, courses: [] };
  }

  const timeDiff = Date.now() - new Date(recentAttendance.check_in_time).getTime();
  if (timeDiff > 120000) {
    return { checked_in: false, courses: [] };
  }

  const sameTimeAttendances = await Attendance.find({
    user_id: userId,
    check_in_time: {
      $gte: new Date(Date.now() - 120000),
    },
  })
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date',
    })
    .sort({ check_in_time: -1 })
    .lean();

  return {
    checked_in: true,
    courses: sameTimeAttendances.map(a => ({
      course_name: a.schedule_id ? a.schedule_id.course_name : '',
      start_time: a.schedule_id ? a.schedule_id.start_time : '',
      end_time: a.schedule_id ? a.schedule_id.end_time : '',
      source: a.source,
    })),
  };
};

exports.exportAttendance = async (filters) => {
  const query = {};
  if (filters.store_id) query.store_id = filters.store_id;
  if (filters.date_from || filters.date_to) {
    query.date = {};
    if (filters.date_from) query.date.$gte = filters.date_from;
    if (filters.date_to) query.date.$lte = filters.date_to;
  }
  if (filters.source) query.source = filters.source;

  const records = await Attendance.find(query)
    .populate('user_id', 'nick_name real_name phone member_code')
    .populate('schedule_id', 'course_name start_time end_time')
    .populate('store_id', 'name')
    .populate('coach_id', 'name')
    .sort({ check_in_time: -1 })
    .lean();

  return records;
};