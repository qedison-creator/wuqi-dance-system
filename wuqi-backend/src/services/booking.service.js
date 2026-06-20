const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const UserPackage = require('../models/UserPackage');
const User = require('../models/User');
const Waitlist = require('../models/Waitlist');
const PendingTask = require('../models/PendingTask');
const logService = require('./log.service');
const memberService = require('./member.service');
const packageService = require('./package.service');
const wechatMessageService = require('./wechat-message.service');
const { CANCEL_TYPE, TIME_RULES, SCHEDULE_STATUS } = require('../constants/scheduleStatus.constants');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const BEIJING_TZ = 'Asia/Shanghai';

function bjNow() {
  return dayjs().tz(BEIJING_TZ);
}

function bjDate(dateStr) {
  return dayjs.tz(dateStr, BEIJING_TZ);
}

// 计算预约的取消相关字段（供前端展示取消按钮状态/倒计时）
// 返回：can_cancel, cancel_phase, booking_deadline, exempt_deadline, exemption_count
function computeCancelFields(booking, user) {
  const schedule = booking.schedule_id;
  if (!schedule || booking.status !== 'booked') {
    return { can_cancel: false, cancel_phase: 'locked', booking_deadline: null, exempt_deadline: null, exemption_count: 0 };
  }
  const now = bjNow();
  const classStart = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ);
  const bookingDeadlineMinutes = schedule.booking_deadline || TIME_RULES.BOOKING_DEADLINE_MINUTES;
  const bookingDeadline = classStart.subtract(bookingDeadlineMinutes, 'minute');
  const exemptDeadline = classStart.subtract(TIME_RULES.EXEMPT_WINDOW_MINUTES, 'minute');
  const exemptionCount = user ? (user.exemption_count || 0) : 0;

  let canCancel = false;
  let phase = 'locked';
  if (now.isBefore(bookingDeadline) || now.isSame(bookingDeadline)) {
    canCancel = true;
    phase = 'normal';
  } else if (now.isBefore(exemptDeadline)) {
    // 窗口期：需有豁免次数
    canCancel = exemptionCount > 0;
    phase = 'exempt';
  } else {
    canCancel = false;
    phase = 'locked';
  }
  return {
    can_cancel: canCancel,
    cancel_phase: phase,
    booking_deadline: bookingDeadline.toISOString(),
    exempt_deadline: exemptDeadline.toISOString(),
    exemption_count: exemptionCount,
  };
}

// 构建 Booking 课程快照字段（课程删除后仍可独立溯源）
function buildBookingSnapshot(schedule) {
  const coach = schedule.coach_id || {};
  const store = schedule.store_id || {};
  const dance = schedule.dance_style_id || {};
  return {
    course_name: schedule.course_name || '',
    schedule_date: schedule.date || '',
    schedule_start_time: schedule.start_time || '',
    schedule_end_time: schedule.end_time || '',
    schedule_duration: schedule.duration || 0,
    coach_name: coach.name || '',
    store_name: store.name || '',
    dance_style_name: dance.name || '',
    classroom: schedule.classroom || '',
    credits_cost: schedule.credits_cost || 0,
    max_bookings: schedule.max_bookings || 0,
  };
}

// 构建 Attendance 课程快照字段
function buildAttendanceSnapshot(schedule) {
  const coach = schedule.coach_id || {};
  const store = schedule.store_id || {};
  return {
    start_time: schedule.start_time || '',
    end_time: schedule.end_time || '',
    duration: schedule.duration || 0,
    coach_name: coach.name || '',
    store_name: store.name || '',
  };
}

async function checkTimeCardLimit(userPackage, scheduleDate, creditsCost) {
  if (userPackage.package_type !== 'time_card') return { allowed: true };

  const dailyLimit = userPackage.daily_limit;
  const weeklyLimit = userPackage.weekly_limit;

  if (!dailyLimit && !weeklyLimit) return { allowed: true };

  const bookingDate = bjDate(scheduleDate);

  if (weeklyLimit) {
    const isoWeekNum = bookingDate.isoWeek();
    const weekYear = bookingDate.isoWeekYear();
    const weekStartDate = bookingDate.startOf('isoWeek');
    const weekEndDate = bookingDate.endOf('isoWeek');

    const usedThisWeek = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: { $gte: weekStartDate.format('YYYY-MM-DD'), $lte: weekEndDate.format('YYYY-MM-DD') },
      status: { $in: ['booked', 'completed'] },
    });

    if (usedThisWeek + creditsCost > weeklyLimit) {
      const remaining = Math.max(0, weeklyLimit - usedThisWeek);
      return {
        allowed: false,
        reason: `本周上课次数已达上限（${weeklyLimit}次/周），本周剩余${remaining}次`,
        limitType: 'weekly',
        limit: weeklyLimit,
        used: usedThisWeek,
        remaining: remaining
      };
    }
  }

  if (dailyLimit) {
    const dateStr = bookingDate.format('YYYY-MM-DD');

    const usedToday = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: dateStr,
      status: { $in: ['booked', 'completed'] },
    });

    if (usedToday + creditsCost > dailyLimit) {
      const remaining = Math.max(0, dailyLimit - usedToday);
      return {
        allowed: false,
        reason: `今日上课次数已达上限（${dailyLimit}次/天），今日剩余${remaining}次`,
        limitType: 'daily',
        limit: dailyLimit,
        used: usedToday,
        remaining: remaining
      };
    }
  }

  return { allowed: true };
}

// 创建预约 - 多重校验
exports.createBooking = async (userId, scheduleId) => {
  try {
    console.log('[Booking] 开始创建预约, userId:', userId, 'scheduleId:', scheduleId);
    // 1. 查找排课
    const schedule = await Schedule.findById(scheduleId).populate('store_id').populate('coach_id');
    if (!schedule) throw new Error('课程不存在');
    if (schedule.status === 'offline' || schedule.status === 'cancelled') {
      throw new Error('该课程当前不可预约');
    }

    // 提取store_id（兼容populate后的对象和原始ObjectId）
    const scheduleStoreId = schedule.store_id ? (schedule.store_id._id || schedule.store_id) : null;
    const scheduleCoachId = schedule.coach_id ? (schedule.coach_id._id || schedule.coach_id) : null;
    const scheduleDanceStyleId = schedule.dance_style_id ? (schedule.dance_style_id._id || schedule.dance_style_id) : null;

    // 校验: 会员门店权限（通过套餐判断）
    const member = await User.findById(userId);
    if (member.member_status !== 'official') {
      throw new Error('仅正式会员可以预约课程，请联系管理员');
    }
    if (member.status === 'disabled') {
      throw new Error('您的账号已被限制使用，请联系管理员');
    }

    const infoCheck = await memberService.checkMemberInfoComplete(userId);
    if (!infoCheck.isComplete) {
      const missingFields = infoCheck.missingFields.join('、');
      throw new Error(`请先完善个人信息：${missingFields}`);
    }

    const classStart = dayjs(schedule.date + ' ' + schedule.start_time);
    const bookingDeadline = classStart.subtract(schedule.booking_deadline || 120, 'minute');
    if (dayjs().isAfter(bookingDeadline)) {
      throw new Error('已过预约截止时间');
    }

    if (schedule.current_bookings >= schedule.max_bookings) {
      throw new Error('预约名额已满，您可以加入候补名单');
    }

    let activationNotice = null;

    let storeActivePackages = await UserPackage.find({
      user_id: userId,
      store_id: scheduleStoreId,
      status: 'active',
      is_suspended: false,
    });

    let storePendingPackages = await UserPackage.find({
      user_id: userId,
      store_id: scheduleStoreId,
      status: 'pending',
    }).sort({ created_at: 1 });

    if (storeActivePackages.length === 0 && storePendingPackages.length === 0) {
      const anyPackage = await UserPackage.findOne({ user_id: userId, status: { $in: ['active', 'pending'] } });
      if (anyPackage) {
        const storeName = schedule.store_id && schedule.store_id.name ? schedule.store_id.name : '该门店';
        throw new Error(`您没有${storeName}的可用套餐，请在首页切换到正确的门店`);
      } else {
        throw new Error('暂无有效套餐，请联系管理员');
      }
    }

    if (storeActivePackages.length === 0 && storePendingPackages.length > 0) {
      const pendingPkg = storePendingPackages[0];
      activationNotice = '您的套餐已自动激活';
      await packageService.activatePackageById(pendingPkg._id, userId, {
        activationType: 'first_booking',
        storeId: scheduleStoreId
      });
      storeActivePackages = await UserPackage.find({
        user_id: userId,
        store_id: scheduleStoreId,
        status: 'active',
        is_suspended: false,
      });
    }

    let currentPackage = null;
    const timeCard = storeActivePackages.find(p => p.package_type === 'time_card' && (!p.end_date || new Date() <= p.end_date));
    const countCard = storeActivePackages.find(p => p.package_type === 'count_card' && p.remaining_credits > 0 && (!p.end_date || new Date() <= p.end_date));

    if (timeCard) {
      currentPackage = timeCard;
    } else if (countCard) {
      currentPackage = countCard;
    }

    if (!currentPackage) {
      const expiredPkgs = storeActivePackages.filter(p => p.end_date && new Date() > p.end_date);
      for (const pkg of expiredPkgs) {
        pkg.status = 'expired';
        await pkg.save();
      }
      const exhaustedPkgs = storeActivePackages.filter(p => p.package_type === 'count_card' && p.remaining_credits <= 0);
      for (const pkg of exhaustedPkgs) {
        pkg.status = 'exhausted';
        await pkg.save();
      }

      storePendingPackages = await UserPackage.find({
        user_id: userId,
        store_id: scheduleStoreId,
        status: 'pending',
      }).sort({ created_at: 1 });

      if (storePendingPackages.length > 0) {
        activationNotice = '您的套餐已自动激活';
        currentPackage = await packageService.activatePackageById(storePendingPackages[0]._id, userId, {
          activationType: 'first_booking',
          storeId: scheduleStoreId
        });
      } else {
        throw new Error('该门店的所有套餐已用完或已过期，请联系管理员');
      }
    }

    if (!currentPackage.is_activated) {
      activationNotice = '您的套餐已激活';
      currentPackage = await packageService.activatePackageById(currentPackage._id, userId, {
        activationType: 'first_booking',
        storeId: scheduleStoreId
      });
    }

    if (currentPackage.end_date && new Date() > currentPackage.end_date) {
      currentPackage.status = 'expired';
      await currentPackage.save();
      throw new Error('套餐已过期，请联系管理员');
    }
    if (currentPackage.package_type === 'count_card' && currentPackage.remaining_credits < (schedule.credits_cost || 1)) {
      // 如果是从时间卡限额满切换过来的，给出更友好的错误信息
      if (currentPackage._fallbackFromTimeCard === true && currentPackage._limitCheck) {
        const lc = currentPackage._limitCheck;
        const limitLabel = lc.limitType === 'weekly' ? '本周' : '今日';
        throw new Error(`时间卡${limitLabel}次数已用完，且次卡剩余次数不足，请联系管理员`);
      }
      throw new Error('剩余次数不足');
    }

    if (currentPackage.package_type === 'time_card') {
      const creditsCost = schedule.credits_cost || 1;
      const limitCheck = await checkTimeCardLimit(currentPackage, schedule.date, creditsCost);
      if (!limitCheck.allowed) {
        // 时间卡限额已满，查找同门店可用次卡（pending 或 active）
        const availableCountCards = await UserPackage.find({
          user_id: userId,
          store_id: scheduleStoreId,
          package_type: 'count_card',
          status: 'active',
          is_suspended: false,
          remaining_credits: { $gt: 0 },
        }).sort({ created_at: 1 });

        const pendingCountCards = await UserPackage.find({
          user_id: userId,
          store_id: scheduleStoreId,
          package_type: 'count_card',
          status: 'pending',
          is_suspended: false,
        }).sort({ created_at: 1 });

        if (availableCountCards.length > 0) {
          // 有已激活的次卡，直接使用次卡
          currentPackage = availableCountCards[0];
          currentPackage._fallbackFromTimeCard = true;
          currentPackage._limitCheck = limitCheck;
        } else if (pendingCountCards.length > 0) {
          // 有未激活的次卡，抛出特殊错误让前端弹窗确认
          const err = new Error('本周时间卡次数已用完，是否激活次卡继续预约？');
          err.code = 'TIME_CARD_LIMIT_REACHED';
          err.data = {
            limitType: limitCheck.limitType,
            limit: limitCheck.limit,
            used: limitCheck.used,
            remaining: limitCheck.remaining,
            availablePackages: pendingCountCards.map(p => ({
              _id: p._id,
              package_name: p.package_name || `${p.total_credits}次卡`,
              total_credits: p.total_credits,
              remaining_credits: p.remaining_credits,
              duration_value: p.duration_value,
              duration_unit: p.duration_unit,
            }))
          };
          throw err;
        } else {
          // 没有可用次卡，抛出原错误
          throw new Error(limitCheck.reason);
        }
      }
    }

    // 校验4: 不冲突同时间段其他课程
    const conflictSchedules = await Schedule.find({
      date: schedule.date,
      status: { $in: ['available', 'full'] },
      _id: { $ne: scheduleId },
      start_time: { $lt: schedule.end_time },
      end_time: { $gt: schedule.start_time },
    }).distinct('_id');

    if (conflictSchedules.length > 0) {
      const conflictBooking = await Booking.findOne({
        user_id: userId,
        schedule_id: { $in: conflictSchedules },
        status: 'booked',
      });
      if (conflictBooking) {
        throw new Error('该时间段已有其他预约，请选择其他课程');
      }
    }

    // 检查是否重复预约
    const existing = await Booking.findOne({
      schedule_id: scheduleId,
      user_id: userId,
      status: 'booked',
    });
    if (existing) throw new Error('您已预约该课程');

    // 创建预约记录
    const creditsCost = schedule.credits_cost || 1;
    const booking = await Booking.create({
      schedule_id: scheduleId,
      user_id: userId,
      coach_id: scheduleCoachId,
      dance_style_id: scheduleDanceStyleId,
      store_id: scheduleStoreId,
      booking_date: schedule.date,
      booking_time: schedule.start_time,
      status: 'booked',
      credits_deducted: creditsCost,
      user_package_id: currentPackage._id,
      ...buildBookingSnapshot(schedule),  // 课程快照
    });

    // 扣除课时（仅次卡扣减，时间卡不扣减）
    if (currentPackage.package_type === 'count_card') {
      const updatedPkg = await UserPackage.findOneAndUpdate(
        { _id: currentPackage._id, remaining_credits: { $gte: creditsCost } },
        { $inc: { remaining_credits: -creditsCost } },
        { new: true }
      );
      if (!updatedPkg) {
        throw new Error('套餐次数不足，无法预约');
      }
      if (updatedPkg.remaining_credits <= 0) {
        await UserPackage.findByIdAndUpdate(updatedPkg._id, {
          remaining_credits: 0,
          status: 'exhausted'
        });
      }
    }

    // 更新排课当前预约人数（原子操作避免并发问题）
    const updatedSchedule = await Schedule.findByIdAndUpdate(
      schedule._id,
      { $inc: { current_bookings: 1 } },
      { new: true }
    );
    if (updatedSchedule.current_bookings >= updatedSchedule.max_bookings) {
      updatedSchedule.status = 'full';
      await updatedSchedule.save();
    }

    try {
      const bookingUser = await User.findById(userId);
      if (bookingUser && bookingUser.openid) {
        await wechatMessageService.sendBookingSuccess(bookingUser, schedule);
      }
    } catch (notifyErr) {
      console.error('[Booking] 发送预约成功通知失败:', notifyErr.message, notifyErr.stack);
    }

    // 写 PendingTask：上课提醒（1 小时 + 30 分钟），仅当提醒时间在将来时创建
    try {
      const baseTime = dayjs(schedule.date + ' ' + schedule.start_time);
      const now = dayjs();
      const tasks = [];
      const oneHourBefore = baseTime.subtract(60, 'minute');
      const thirtyMinBefore = baseTime.subtract(30, 'minute');
      if (oneHourBefore.isAfter(now)) {
        tasks.push({ schedule_id: schedule._id, user_id: userId, trigger_at: oneHourBefore.toDate(), type: 'class_reminder_1h' });
      }
      if (thirtyMinBefore.isAfter(now)) {
        tasks.push({ schedule_id: schedule._id, user_id: userId, trigger_at: thirtyMinBefore.toDate(), type: 'class_reminder_30m' });
      }
      if (tasks.length > 0) {
        await PendingTask.insertMany(tasks);
      }
    } catch (pendingErr) {
      console.error('[Booking] 写 PendingTask 失败:', pendingErr.message);
    }

    const result = {
      booking,
      activationNotice,
      usedPackage: {
        _id: currentPackage._id,
        package_type: currentPackage.package_type,
        remaining_credits: currentPackage.remaining_credits,
        store_id: currentPackage.store_id,
      }
    };
    console.log('[Booking] 预约创建成功');
    return result;
  } catch (err) {
    console.error('[Booking] 创建预约失败:', err);
    console.error('[Booking] 错误堆栈:', err.stack);
    throw err;
  }
};

// 取消预约 - 统一规则：
// 1. 预约截止时间前（booking_deadline）：正常取消，退课时
// 2. 窗口期内（截止时间后到开课前10分钟）：需豁免次数才能取消，退课时
// 3. 无豁免次数或开课前10分钟内：拒绝取消
exports.cancelBooking = async (userId, bookingId) => {
  const booking = await Booking.findById(bookingId).populate({
    path: 'schedule_id',
    populate: [
      { path: 'coach_id', select: 'name' },
      { path: 'store_id', select: 'name' }
    ]
  });
  if (!booking) throw new Error('预约记录不存在');
  if (booking.user_id.toString() !== userId.toString()) throw new Error('无权操作');

  const schedule = booking.schedule_id;
  if (!schedule) throw new Error('课程信息不存在');

  if (booking.status !== 'booked') {
    throw new Error('该预约不可取消');
  }
  if (booking.cancel_type) throw new Error('该预约已取消过');

  const now = bjNow();
  const classStart = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ);

  // 预约截止时间 = 开课前 booking_deadline 分钟（默认120分钟）
  const bookingDeadlineMinutes = schedule.booking_deadline || TIME_RULES.BOOKING_DEADLINE_MINUTES;
  const bookingDeadline = classStart.subtract(bookingDeadlineMinutes, 'minute');

  // 豁免取消窗口截止 = 开课前 10 分钟
  const exemptDeadline = classStart.subtract(TIME_RULES.EXEMPT_WINDOW_MINUTES, 'minute');

  if (now.isBefore(bookingDeadline) || now.isSame(bookingDeadline)) {
    // 正常取消 - 全额退还课时
    booking.status = 'cancelled';
    booking.cancel_type = CANCEL_TYPE.NORMAL;
    booking.cancel_time = new Date();
    booking.credits_refunded = booking.credits_deducted;
    await booking.save();

    // 恢复课时
    const pkg = booking.user_package_id ? await UserPackage.findById(booking.user_package_id) : await UserPackage.findOne({ user_id: userId, status: 'active' });
    if (pkg) {
      pkg.remaining_credits += booking.credits_deducted;
      if (pkg.status === 'exhausted') pkg.status = 'active';
      await pkg.save();
    }
  } else if (now.isBefore(exemptDeadline)) {
    // 窗口期 - 检查豁免次数
    const user = await User.findById(userId);
    if (user.exemption_count > 0) {
      // 有豁免次数 - 豁免取消，退课时
      booking.status = 'cancelled';
      booking.cancel_type = CANCEL_TYPE.EXEMPT;
      booking.cancel_time = now.toDate();
      booking.exemption_used = true;
      booking.is_exempt = true;
      booking.credits_refunded = booking.credits_deducted;
      await booking.save();

      // 恢复课时
      const pkg = booking.user_package_id ? await UserPackage.findById(booking.user_package_id) : await UserPackage.findOne({ user_id: userId, status: 'active' });
      if (pkg) {
        pkg.remaining_credits += booking.credits_deducted;
        if (pkg.status === 'exhausted') pkg.status = 'active';
        await pkg.save();
      }

      // 扣除豁免次数
      user.exemption_count -= 1;
      await user.save();
    } else {
      // 无豁免次数 - 拒绝取消
      throw new Error('已超过预约截止时间，不能取消');
    }
  } else {
    // 开课前10分钟内 - 拒绝取消
    throw new Error('已超过预约截止时间，不能取消');
  }

  // 更新排课预约人数（原子操作）
  const updatedSchedule = await Schedule.findByIdAndUpdate(
    schedule._id,
    { $inc: { current_bookings: -1 } },
    { new: true }
  );
  if (updatedSchedule.current_bookings < 0) {
    updatedSchedule.current_bookings = 0;
    await updatedSchedule.save();
  }
  if (updatedSchedule.status === 'full') {
    updatedSchedule.status = 'available';
    await updatedSchedule.save();
  }

  // 通知候补用户
  if (updatedSchedule.status === 'available' && updatedSchedule.current_bookings < updatedSchedule.max_bookings) {
    exports.notifyWaitlistUsers(schedule._id).catch(err => {
      console.error('通知候补用户失败:', err.message);
    });
  }

  try {
    const cancelUser = await User.findById(userId);
    if (cancelUser && cancelUser.openid) {
      const cancelReason = booking.cancel_type === CANCEL_TYPE.EXEMPT
        ? '您已使用豁免取消预约，课时已退还'
        : '您已取消预约，课时已退还';
      await wechatMessageService.sendBookingCancel(cancelUser, schedule, cancelReason, 'member', 'bookingCancelByUser');
    }
  } catch (notifyErr) {
    console.error('[Booking] 发送取消预约通知失败:', notifyErr.message, notifyErr.stack);
  }

  // 清理该用户对该课程的提醒 PendingTask
  await PendingTask.deleteMany({
    schedule_id: schedule._id,
    user_id: userId,
    type: { $in: ['class_reminder_1h', 'class_reminder_30m'] },
    processed: 'pending'
  });

  return booking;
};

// 获取我的预约记录
exports.getMyBookings = async (userId, type, page, pageSize, storeId) => {
  const filter = { user_id: userId };

  if (type === 'booking' || type === 'booked') {
    filter.status = 'booked';
  } else if (type === 'completed') {
    filter.status = 'completed';
  } else if (type === 'cancelled') {
    filter.status = 'cancelled';
  } else if (type === 'all') {
    // 预约记录页合并显示：已预约 + 已取消（不含已完成的上课记录，上课记录在 attendance 页）
    filter.status = { $in: ['booked', 'cancelled'] };
  }

  if (storeId) {
    const scheduleIds = await Schedule.find({ store_id: storeId }).distinct('_id');
    filter.schedule_id = { $in: scheduleIds };
  }

  const list = await Booking.find(filter)
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date store_id dance_style_id coach_id status booking_deadline min_bookings current_bookings',
      populate: [
        { path: 'store_id', select: 'name' },
        { path: 'dance_style_id', select: 'name' },
        { path: 'coach_id', select: 'name' },
      ],
    })
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  // 统一状态体系：信任 DB 状态，不再自动纠正
  // 状态一致性由 PendingTask 事件驱动 + schedule.service.js 兜底补偿保证

  // 为 booked 状态记录附加取消相关字段（can_cancel/exempt_deadline/booking_deadline/exemption_count）
  let userDoc = null;
  const hasBooked = list.some(b => b.status === 'booked');
  if (hasBooked) {
    userDoc = await User.findById(userId).select('exemption_count');
  }
  const resultList = list.map(b => {
    const obj = b.toObject();
    if (b.status === 'booked') {
      obj.can_cancel = false;
      obj.cancel_phase = 'locked';
      obj.booking_deadline = null;
      obj.exempt_deadline = null;
      obj.exemption_count = 0;
      try {
        const fields = computeCancelFields(b, userDoc);
        Object.assign(obj, fields);
      } catch (e) {
        // schedule 已删除等异常情况，保持默认不可取消
      }
    }
    return obj;
  });

  const total = await Booking.countDocuments(filter);
  return { list: resultList, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取我的出勤记录
exports.getMyAttendance = async (userId, page, pageSize) => {
  const filter = {
    user_id: userId,
    status: 'completed',
  };

  const list = await Booking.find(filter)
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date store_id dance_style_id coach_id',
      populate: [
        { path: 'store_id', select: 'name' },
        { path: 'dance_style_id', select: 'name' },
        { path: 'coach_id', select: 'name' },
      ],
    })
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Booking.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 管理端获取预约记录
exports.getBookingList = async (query) => {
  const {
    store_id, schedule_id, user_id, status, cancel_type,
    start_date, end_date, page = 1, pageSize = 20,
  } = query;
  const filter = {};

  if (store_id) filter.store_id = store_id;
  if (schedule_id) filter.schedule_id = schedule_id;
  if (user_id) filter.user_id = user_id;
  if (status) filter.status = status;
  if (cancel_type) filter.cancel_type = cancel_type;
  if (start_date && end_date) {
    filter.booking_date = { $gte: start_date, $lte: end_date };
  } else if (start_date) {
    filter.booking_date = start_date;
  }

  const list = await Booking.find(filter)
    .populate('user_id', 'real_name nick_name avatar_url phone')
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date store_id',
      populate: [
        { path: 'store_id', select: 'name' },
      ],
    })
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Booking.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取预约详情
exports.getBookingById = async (id) => {
  const booking = await Booking.findById(id)
    .populate('user_id', 'real_name nick_name avatar_url phone exemption_count')
    .populate({
      path: 'schedule_id',
      populate: [
        { path: 'store_id', select: 'name' },
        { path: 'dance_style_id', select: 'name' },
        { path: 'coach_id', select: 'name' },
      ],
    });
  if (!booking) throw new Error('预约记录不存在');

  // 附加取消相关字段
  const obj = booking.toObject();
  if (booking.status === 'booked') {
    try {
      const fields = computeCancelFields(booking, booking.user_id);
      Object.assign(obj, fields);
    } catch (e) {
      obj.can_cancel = false;
      obj.cancel_phase = 'locked';
      obj.booking_deadline = null;
      obj.exempt_deadline = null;
      obj.exemption_count = booking.user_id ? (booking.user_id.exemption_count || 0) : 0;
    }
  }
  return obj;
};

// 管理员手动取消
exports.adminCancelBooking = async (bookingId, reason, operatorId) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('预约记录不存在');
  if (booking.status !== 'booked') {
    throw new Error('该预约不可取消');
  }

  booking.status = 'cancelled';
  booking.cancel_type = 'admin_cancel';
  booking.cancel_time = new Date();
  booking.cancel_reason = reason;
  booking.credits_refunded = booking.credits_deducted;
  await booking.save();

  // 恢复课时
  const pkg = booking.user_package_id ? await UserPackage.findById(booking.user_package_id) : await UserPackage.findOne({ user_id: booking.user_id, status: 'active' });
  if (pkg) {
    pkg.remaining_credits += booking.credits_deducted;
    if (pkg.status === 'exhausted') pkg.status = 'active';
    await pkg.save();
  }

  // 更新排课预约人数
  const schedule = await Schedule.findById(booking.schedule_id).populate('coach_id', 'name');
  if (schedule) {
    schedule.current_bookings = Math.max(0, schedule.current_bookings - 1);
    if (schedule.status === 'full') schedule.status = 'available';
    await schedule.save();

    // 通知候补用户
    if (schedule.current_bookings < schedule.max_bookings) {
      exports.notifyWaitlistUsers(schedule._id).catch(err => {
        console.error('通知候补用户失败:', err.message);
      });
    }

    // 发送取消通知给会员
    try {
      const cancelUser = await User.findById(booking.user_id);
      if (cancelUser && cancelUser.openid) {
        await wechatMessageService.sendBookingCancel(cancelUser, schedule, reason || '管理员已取消您的预约');
      }
    } catch (notifyErr) {
      console.error('[Booking] 发送管理员取消通知失败:', notifyErr.message);
    }
  }

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'admin_cancel',
    module: 'booking',
    target_id: bookingId,
    detail: `管理员取消预约: 预约ID=${bookingId}, 原因: ${reason || '管理员取消'}, 退还次数: ${booking.credits_deducted}`,
  });

  return booking;
};

// ========== 候补机制 ==========

// 加入候补
exports.joinWaitlist = async (userId, scheduleId) => {
  const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
  if (!schedule) throw new Error('课程不存在');
  if (schedule.status === 'offline' || schedule.status === 'cancelled') {
    throw new Error('该课程当前不可候补');
  }

  // 检查是否已在候补中
  const Waitlist = require('../models/Waitlist');
  const existing = await Waitlist.findOne({
    user_id: userId,
    schedule_id: scheduleId,
    status: { $in: ['waiting', 'notified'] },
  });
  if (existing) throw new Error('您已在候补名单中');

  // 检查是否已预约
  const booked = await Booking.findOne({
    user_id: userId,
    schedule_id: scheduleId,
    status: 'booked',
  });
  if (booked) throw new Error('您已预约该课程，无需候补');

  // 计算排队位置
  const count = await Waitlist.countDocuments({
    schedule_id: scheduleId,
    status: 'waiting',
  });

  const waitlist = await Waitlist.create({
    user_id: userId,
    schedule_id: scheduleId,
    store_id: schedule.store_id,
    status: 'waiting',
    position: count + 1,
    course_name: schedule.course_name || '',
    schedule_date: schedule.date || '',
    start_time: schedule.start_time || '',
    end_time: schedule.end_time || '',
    coach_name: schedule.coach_id?.name || '',
    store_name: schedule.store_id?.name || '',
  });

  return waitlist;
};

// 取消候补
exports.cancelWaitlist = async (userId, waitlistId) => {
  const Waitlist = require('../models/Waitlist');
  const waitlist = await Waitlist.findById(waitlistId);
  if (!waitlist) throw new Error('候补记录不存在');
  if (waitlist.user_id.toString() !== userId.toString()) throw new Error('无权操作');
  if (waitlist.status !== 'waiting') throw new Error('该候补记录不可取消');

  const cancelledPosition = waitlist.position;
  const scheduleId = waitlist.schedule_id;

  waitlist.status = 'cancelled';
  await waitlist.save();

  // 重排该排课下排在被取消候补之后的候补记录的position
  if (cancelledPosition) {
    const laterWaitlists = await Waitlist.find({
      schedule_id: scheduleId,
      status: 'waiting',
      position: { $gt: cancelledPosition },
    }).sort({ position: 1 });

    for (const w of laterWaitlists) {
      w.position -= 1;
      await w.save();
    }
  }

  return waitlist;
};

// 获取我的候补列表
exports.getMyWaitlist = async (userId) => {
  const Waitlist = require('../models/Waitlist');
  const list = await Waitlist.find({
    user_id: userId,
    status: { $in: ['waiting', 'notified'] },
  })
    .populate({
      path: 'schedule_id',
      select: 'course_name start_time end_time date store_id dance_style_id coach_id',
      populate: [
        { path: 'store_id', select: 'name' },
        { path: 'dance_style_id', select: 'name' },
        { path: 'coach_id', select: 'name' },
      ],
    })
    .sort({ created_at: -1 });

  return list;
};

// 获取指定排课的候补名单（管理端）
exports.getScheduleWaitlist = async (scheduleId) => {
  const Waitlist = require('../models/Waitlist');
  const list = await Waitlist.find({
    schedule_id: scheduleId,
    status: { $in: ['waiting', 'notified'] },
  })
    .populate('user_id', 'nick_name real_name avatar_url phone')
    .sort({ position: 1, created_at: 1 });

  return list;
};

// 获取候补汇总列表（管理端）
exports.getWaitlistSummary = async (storeId) => {
  const Waitlist = require('../models/Waitlist');
  const Schedule = require('../models/Schedule');
  
  const filter = {
    status: { $in: ['waiting', 'notified'] },
  };
  
  if (storeId) {
    filter.store_id = storeId;
  }

  // 聚合统计
  const waitlistGroups = await Waitlist.aggregate([
    { $match: filter },
    { 
      $group: {
        _id: '$schedule_id',
        waitlist_count: { $sum: 1 },
        items: { $push: '$$ROOT' }
      }
    }
  ]);

  // 获取排课信息
  const scheduleIds = waitlistGroups.map(g => g._id);
  const schedules = await Schedule.find({ _id: { $in: scheduleIds } })
    .populate('coach_id', 'name')
    .populate('dance_style_id', 'name')
    .populate('store_id', 'name');

  const scheduleMap = {};
  schedules.forEach(s => {
    scheduleMap[s._id.toString()] = s;
  });

  const result = waitlistGroups.map(group => {
    const schedule = scheduleMap[group._id.toString()];
    if (!schedule) return null;
    
    return {
      _id: group._id,
      schedule_id: group._id,
      course_name: schedule.course_name,
      date: schedule.date,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      coach: schedule.coach_id,
      dance_style: schedule.dance_style_id,
      store: schedule.store_id,
      waitlist_count: group.waitlist_count
    };
  }).filter(Boolean);

  return result.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return a.start_time.localeCompare(b.start_time);
  });
};

// 候补转正（管理端）
// 复用 createBooking 的套餐选择逻辑，保持与会员端一致的行为
exports.promoteWaitlist = async (waitlistId, operatorId) => {
  const Waitlist = require('../models/Waitlist');
  const waitlist = await Waitlist.findById(waitlistId);

  if (!waitlist) throw new Error('候补记录不存在');
  if (waitlist.status !== 'waiting' && waitlist.status !== 'notified') {
    throw new Error('该候补记录不可转正');
  }

  const schedule = await Schedule.findById(waitlist.schedule_id).populate('store_id', 'name').populate('coach_id', 'name').populate('dance_style_id', 'name');
  if (!schedule) throw new Error('课程不存在');

  if (schedule.current_bookings >= schedule.max_bookings) {
    throw new Error('名额已满，无法转正');
  }

  const userId = waitlist.user_id;
  const scheduleStoreId = schedule.store_id ? (schedule.store_id._id || schedule.store_id) : null;

  // 按门店查找套餐（与 createBooking 逻辑一致）
  const storeActivePackages = await UserPackage.find({
    user_id: userId,
    store_id: scheduleStoreId,
    status: 'active',
    is_suspended: false,
  });

  const storePendingPackages = await UserPackage.find({
    user_id: userId,
    store_id: scheduleStoreId,
    status: 'pending',
    is_suspended: false,
  }).sort({ created_at: 1 });

  // 自动激活同门店 pending 套餐
  if (storeActivePackages.length === 0 && storePendingPackages.length > 0) {
    await packageService.activatePackageById(storePendingPackages[0]._id, userId, {
      activationType: 'admin_promote',
      storeId: scheduleStoreId
    });
    storeActivePackages.push(await UserPackage.findById(storePendingPackages[0]._id));
  }

  // 套餐选择：时间卡优先，限额满时 fallback 到次卡
  let currentPackage = null;
  const timeCard = storeActivePackages.find(p => p.package_type === 'time_card' && (!p.end_date || new Date() <= p.end_date));
  const countCard = storeActivePackages.find(p => p.package_type === 'count_card' && p.remaining_credits > 0 && (!p.end_date || new Date() <= p.end_date));

  if (timeCard) {
    const creditsCost = schedule.credits_cost || 1;
    const limitCheck = await checkTimeCardLimit(timeCard, schedule.date, creditsCost);
    if (limitCheck.allowed) {
      currentPackage = timeCard;
    } else if (countCard) {
      // 时间卡限额满，fallback 到次卡
      currentPackage = countCard;
    }
  }

  if (!currentPackage) {
    // 检查是否有跨门店套餐
    const anyPackage = await UserPackage.findOne({
      user_id: userId,
      status: { $in: ['active', 'pending'] }
    });
    if (anyPackage) {
      const storeName = schedule.store_id && schedule.store_id.name ? schedule.store_id.name : '该门店';
      throw new Error(`该会员没有${storeName}的可用套餐，请在正确门店的排课中操作`);
    }
    throw new Error('该会员无可用套餐，请联系管理员录入套餐');
  }

  // 确保套餐已激活（补录数据兼容）
  if (!currentPackage.is_activated) {
    await packageService.activatePackageById(currentPackage._id, userId, {
      activationType: 'admin_promote',
      storeId: scheduleStoreId
    });
    currentPackage = await UserPackage.findById(currentPackage._id);
  }

  // 检查次卡次数
  const creditsCost = schedule.credits_cost || 1;
  if (currentPackage.package_type === 'count_card' && currentPackage.remaining_credits < creditsCost) {
    throw new Error('该会员套餐剩余次数不足');
  }

  // 检查时间卡过期
  if (currentPackage.end_date && new Date() > currentPackage.end_date) {
    currentPackage.status = 'expired';
    await currentPackage.save();
    throw new Error('该会员套餐已过期，请联系管理员');
  }

  // 检查时间冲突：该会员是否已预约同时间段其他课程
  const conflictSchedules = await Schedule.find({
    date: schedule.date,
    status: { $in: ['available', 'full'] },
    _id: { $ne: schedule._id },
    start_time: { $lt: schedule.end_time },
    end_time: { $gt: schedule.start_time },
  }).distinct('_id');

  if (conflictSchedules.length > 0) {
    const conflictBooking = await Booking.findOne({
      user_id: userId,
      schedule_id: { $in: conflictSchedules },
      status: 'booked',
    });
    if (conflictBooking) {
      throw new Error('该会员在此时间段已有其他预约，转正失败');
    }
  }

  // 创建预约记录
  const booking = await Booking.create({
    schedule_id: waitlist.schedule_id,
    user_id: userId,
    coach_id: schedule.coach_id,
    dance_style_id: schedule.dance_style_id,
    store_id: schedule.store_id,
    booking_date: schedule.date,
    booking_time: schedule.start_time,
    status: 'booked',
    credits_deducted: creditsCost,
    user_package_id: currentPackage._id,
    ...buildBookingSnapshot(schedule),  // 课程快照
  });

  // 扣减次卡课时
  if (currentPackage.package_type === 'count_card') {
    currentPackage.remaining_credits -= creditsCost;
    if (currentPackage.remaining_credits <= 0) {
      currentPackage.remaining_credits = 0;
      currentPackage.status = 'exhausted';
    }
    await currentPackage.save();
  }

  // 更新排课
  schedule.current_bookings += 1;
  if (schedule.current_bookings >= schedule.max_bookings) {
    schedule.status = 'full';
  }
  await schedule.save();

  // 更新候补状态
  waitlist.status = 'booked';
  await waitlist.save();

  // 记录日志
  if (operatorId) {
    await logService.createLog({
      operator_id: operatorId,
      action: 'promote_waitlist',
      module: 'booking',
      target_id: booking._id,
      detail: `管理员将候补转正: 候补ID=${waitlistId}, 使用套餐=${currentPackage.package_name || currentPackage._id}`
    });
  }

  return { booking, waitlist };
};

// 管理员删除候补
exports.adminRemoveWaitlist = async (waitlistId, operatorId) => {
  const Waitlist = require('../models/Waitlist');
  const waitlist = await Waitlist.findById(waitlistId);
  
  if (!waitlist) throw new Error('候补记录不存在');

  const cancelledPosition = waitlist.position;
  const scheduleId = waitlist.schedule_id;
  
  waitlist.status = 'cancelled';
  await waitlist.save();

  // 重排该排课下排在被移除候补之后的候补记录的position
  if (cancelledPosition) {
    const laterWaitlists = await Waitlist.find({
      schedule_id: scheduleId,
      status: 'waiting',
      position: { $gt: cancelledPosition },
    }).sort({ position: 1 });

    for (const w of laterWaitlists) {
      w.position -= 1;
      await w.save();
    }
  }

  // 记录日志
  if (operatorId) {
    await logService.createLog({
      operator_id: operatorId,
      action: 'remove_waitlist',
      module: 'booking',
      target_id: waitlistId,
      detail: `管理员移除候补: 候补ID=${waitlistId}`
    });
  }

  return waitlist;
};

// 自动将候补用户转正（当有人取消预约有名额空出时调用）
// 复用套餐选择逻辑，与 createBooking 保持一致
exports.notifyWaitlistUsers = async (scheduleId) => {
  const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
  if (!schedule) return;

  const availableSlots = schedule.max_bookings - schedule.current_bookings;
  if (availableSlots <= 0) return;

  const waitlist = await Waitlist.find({
    schedule_id: scheduleId,
    status: 'waiting',
  }).sort({ position: 1, created_at: 1 });

  const toPromote = waitlist.slice(0, availableSlots);
  let promotedCount = 0;

  for (const item of toPromote) {
    try {
      const userId = item.user_id;
      const scheduleStoreId = schedule.store_id;

      // 查找同门店套餐
      const storeActivePackages = await UserPackage.find({
        user_id: userId,
        store_id: scheduleStoreId,
        status: 'active',
        is_suspended: false,
      });

      const storePendingPackages = await UserPackage.find({
        user_id: userId,
        store_id: scheduleStoreId,
        status: 'pending',
        is_suspended: false,
      }).sort({ created_at: 1 });

      // 自动激活 pending 套餐
      if (storeActivePackages.length === 0 && storePendingPackages.length > 0) {
        await packageService.activatePackageById(storePendingPackages[0]._id, userId, {
          activationType: 'auto_waitlist',
          storeId: scheduleStoreId
        });
        storeActivePackages.push(await UserPackage.findById(storePendingPackages[0]._id));
      }

      // 套餐选择：时间卡优先，限额满时 fallback 次卡
      let currentPackage = null;
      const timeCard = storeActivePackages.find(p => p.package_type === 'time_card' && (!p.end_date || new Date() <= p.end_date));
      const countCard = storeActivePackages.find(p => p.package_type === 'count_card' && p.remaining_credits > 0);

      if (timeCard) {
        const creditsCost = schedule.credits_cost || 1;
        const limitCheck = await checkTimeCardLimit(timeCard, schedule.date, creditsCost);
        if (limitCheck.allowed) {
          currentPackage = timeCard;
        } else if (countCard) {
          currentPackage = countCard;
        }
      }

      if (!currentPackage) {
        console.warn('自动转正候补失败: 会员无可用套餐, 候补ID:', item._id);
        continue;
      }

      // 确保套餐已激活
      if (!currentPackage.is_activated) {
        await packageService.activatePackageById(currentPackage._id, userId, {
          activationType: 'auto_waitlist',
          storeId: scheduleStoreId
        });
        currentPackage = await UserPackage.findById(currentPackage._id);
      }

      // 检查过期
      if (currentPackage.end_date && new Date() > currentPackage.end_date) {
        currentPackage.status = 'expired';
        await currentPackage.save();
        console.warn('自动转正候补失败: 套餐已过期, 候补ID:', item._id);
        continue;
      }

      // 检查次卡次数
      const creditsCost = schedule.credits_cost || 1;
      if (currentPackage.package_type === 'count_card' && currentPackage.remaining_credits < creditsCost) {
        console.warn('自动转正候补失败: 套餐次数不足, 候补ID:', item._id);
        continue;
      }

      const user = await User.findById(userId);

      // 检查时间冲突：该会员是否已预约同时间段其他课程
      const conflictSchedules = await Schedule.find({
        date: schedule.date,
        status: { $in: ['available', 'full'] },
        _id: { $ne: schedule._id },
        start_time: { $lt: schedule.end_time },
        end_time: { $gt: schedule.start_time },
      }).distinct('_id');

      if (conflictSchedules.length > 0) {
        const conflictBooking = await Booking.findOne({
          user_id: userId,
          schedule_id: { $in: conflictSchedules },
          status: 'booked',
        });
        if (conflictBooking) {
          console.warn('自动转正候补跳过: 会员已有同时间段预约, 候补ID:', item._id);
          continue;
        }
      }

      const booking = await Booking.create({
        schedule_id: item.schedule_id,
        user_id: userId,
        coach_id: schedule.coach_id,
        dance_style_id: schedule.dance_style_id,
        store_id: schedule.store_id,
        booking_date: schedule.date,
        booking_time: schedule.start_time,
        status: 'booked',
        credits_deducted: creditsCost,
        user_package_id: currentPackage._id,
        ...buildBookingSnapshot(schedule),  // 课程快照
      });

      // 扣减次卡课时
      if (currentPackage.package_type === 'count_card') {
        currentPackage.remaining_credits -= creditsCost;
        if (currentPackage.remaining_credits <= 0) {
          currentPackage.remaining_credits = 0;
          currentPackage.status = 'exhausted';
        }
        await currentPackage.save();
      }

      schedule.current_bookings += 1;
      if (schedule.current_bookings >= schedule.max_bookings) {
        schedule.status = 'full';
      }

      item.status = 'booked';
      await item.save();
      promotedCount++;

      if (user && user.openid) {
        try {
          await wechatMessageService.sendWaitlistAvailable(user, schedule);
        } catch (notifyErr) {
          console.error('发送候补转正通知失败:', notifyErr.message);
        }
      }
    } catch (err) {
      console.error('自动转正候补失败:', err.message, '候补ID:', item._id);
    }
  }

  if (schedule.current_bookings > 0) {
    await schedule.save();
  }

  return { promoted_count: promotedCount };
};

// 候补用户确认预约（会员端手动确认候补）
// 套餐选择逻辑与 createBooking 保持一致
exports.confirmWaitlistBooking = async (userId, waitlistId) => {
  const waitlist = await Waitlist.findById(waitlistId);
  if (!waitlist) throw new Error('候补记录不存在');
  if (waitlist.user_id.toString() !== userId.toString()) throw new Error('无权操作');

  if (waitlist.status !== 'waiting') throw new Error('当前状态不可确认');

  const schedule = await Schedule.findById(waitlist.schedule_id).populate('store_id', 'name').populate('coach_id', 'name').populate('dance_style_id', 'name');
  if (!schedule) throw new Error('课程不存在');
  if (schedule.current_bookings >= schedule.max_bookings) {
    throw new Error('名额已满，候补失败');
  }

  const scheduleStoreId = schedule.store_id ? (schedule.store_id._id || schedule.store_id) : null;

  // 查找同门店套餐
  const storeActivePackages = await UserPackage.find({
    user_id: userId,
    store_id: scheduleStoreId,
    status: 'active',
    is_suspended: false,
  });

  const storePendingPackages = await UserPackage.find({
    user_id: userId,
    store_id: scheduleStoreId,
    status: 'pending',
    is_suspended: false,
  }).sort({ created_at: 1 });

  // 自动激活 pending 套餐
  if (storeActivePackages.length === 0 && storePendingPackages.length > 0) {
    await packageService.activatePackageById(storePendingPackages[0]._id, userId, {
      activationType: 'waitlist_confirm',
      storeId: scheduleStoreId
    });
    storeActivePackages.push(await UserPackage.findById(storePendingPackages[0]._id));
  }

  // 套餐选择：时间卡优先，限额满时 fallback 次卡
  let currentPackage = null;
  const timeCard = storeActivePackages.find(p => p.package_type === 'time_card' && (!p.end_date || new Date() <= p.end_date));
  const countCard = storeActivePackages.find(p => p.package_type === 'count_card' && p.remaining_credits > 0 && (!p.end_date || new Date() <= p.end_date));

  if (timeCard) {
    const creditsCost = schedule.credits_cost || 1;
    const limitCheck = await checkTimeCardLimit(timeCard, schedule.date, creditsCost);
    if (limitCheck.allowed) {
      currentPackage = timeCard;
    } else if (countCard) {
      // 时间卡限额满，fallback 到次卡
      currentPackage = countCard;
    }
    // 时间卡限额满且没有次卡，currentPackage 为 null
  }
  if (!currentPackage) {
    currentPackage = countCard;
  }

  if (!currentPackage) {
    const anyPackage = await UserPackage.findOne({ user_id: userId, status: { $in: ['active', 'pending'] } });
    if (anyPackage) {
      const storeName = schedule.store_id && schedule.store_id.name ? schedule.store_id.name : '该门店';
      throw new Error(`您没有${storeName}的可用套餐，请在首页切换到正确的门店`);
    }
    throw new Error('暂无有效套餐，请联系管理员');
  }

  // 确保套餐已激活
  if (!currentPackage.is_activated) {
    await packageService.activatePackageById(currentPackage._id, userId, {
      activationType: 'waitlist_confirm',
      storeId: scheduleStoreId
    });
    currentPackage = await UserPackage.findById(currentPackage._id);
  }

  // 检查过期
  if (currentPackage.end_date && new Date() > currentPackage.end_date) {
    currentPackage.status = 'expired';
    await currentPackage.save();
    throw new Error('套餐已过期，请联系管理员');
  }

  // 检查次卡次数
  const creditsCost = schedule.credits_cost || 1;
  if (currentPackage.package_type === 'count_card' && currentPackage.remaining_credits < creditsCost) {
    throw new Error('剩余次数不足');
  }

  // 检查时间冲突
  const conflictSchedules = await Schedule.find({
    date: schedule.date,
    status: { $in: ['available', 'full'] },
    _id: { $ne: schedule._id },
    start_time: { $lt: schedule.end_time },
    end_time: { $gt: schedule.start_time },
  }).distinct('_id');

  if (conflictSchedules.length > 0) {
    const conflictBooking = await Booking.findOne({
      user_id: userId,
      schedule_id: { $in: conflictSchedules },
      status: 'booked',
    });
    if (conflictBooking) {
      throw new Error('该时间段已有其他预约，请选择其他课程');
    }
  }

  // 创建预约
  const booking = await Booking.create({
    schedule_id: waitlist.schedule_id,
    user_id: userId,
    coach_id: schedule.coach_id,
    dance_style_id: schedule.dance_style_id,
    store_id: schedule.store_id,
    booking_date: schedule.date,
    booking_time: schedule.start_time,
    status: 'booked',
    credits_deducted: creditsCost,
    user_package_id: currentPackage._id,
    ...buildBookingSnapshot(schedule),  // 课程快照
  });

  // 扣减次卡课时
  if (currentPackage.package_type === 'count_card') {
    currentPackage.remaining_credits -= creditsCost;
    if (currentPackage.remaining_credits <= 0) {
      currentPackage.remaining_credits = 0;
      currentPackage.status = 'exhausted';
    }
    await currentPackage.save();
  }

  schedule.current_bookings += 1;
  if (schedule.current_bookings >= schedule.max_bookings) {
    schedule.status = 'full';
  }
  await schedule.save();

  waitlist.status = 'booked';
  await waitlist.save();

  return booking;
};

// ========== 自动取消低人数课程 ==========

// 检查并取消低人数课程
exports.checkAndCancelLowAttendance = async (scheduleId, operatorId = null) => {
  const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
  if (!schedule) throw new Error('课程不存在');

  if (schedule.status === 'cancelled' || schedule.status === 'offline') {
    throw new Error('课程已取消或离线');
  }
  
  const minAttendance = schedule.min_attendance || 3;
  
  if (schedule.current_bookings >= minAttendance) {
    return { cancelled: false, reason: '人数已达最低要求' };
  }
  
  // 取消课程
  schedule.status = 'cancelled';
  await schedule.save();
  
  // 获取所有预约的用户
  const bookings = await Booking.find({
    schedule_id: scheduleId,
    status: 'booked'
  });
  
  // 批量取消预约并退款
  const cancelledBookings = [];
  for (const booking of bookings) {
    booking.status = 'cancelled';
    booking.cancel_type = 'min_bookings_not_met';
    booking.cancel_time = new Date();
    booking.cancel_reason = '课程因人数不足取消';
    booking.credits_refunded = booking.credits_deducted;
    await booking.save();
    
    // 退款
    if (booking.user_package_id) {
      const pkg = await UserPackage.findById(booking.user_package_id);
      if (pkg) {
        pkg.remaining_credits += booking.credits_deducted;
        if (pkg.status === 'exhausted' && pkg.remaining_credits > 0) {
          pkg.status = 'active';
        }
        await pkg.save();
      }
    }
    
    // 发送取消通知
    try {
      const user = await User.findById(booking.user_id);
      if (user && user.openid) {
        await wechatMessageService.sendBookingCancel(user, schedule, '课程因人数不足取消');
      }
    } catch (err) {
      console.error('发送课程取消通知失败:', err);
    }
    
    cancelledBookings.push(booking);
  }
  
  // 记录操作日志
  if (operatorId) {
    await logService.createLog({
      operator_id: operatorId,
      action: 'cancel_class',
      module: 'schedule',
      target_id: scheduleId,
      detail: `课程因人数不足取消，共取消 ${cancelledBookings.length} 个预约`
    });
  }
  
  return {
    cancelled: true,
    schedule,
    cancelledBookings,
    count: cancelledBookings.length
  };
};

// 批量检查即将开始的课程，自动取消低人数课程
exports.batchCheckLowAttendance = async (hoursBefore = 2) => {
  const now = dayjs();
  const checkTime = now.add(hoursBefore, 'hour');
  const checkDate = checkTime.format('YYYY-MM-DD');
  
  // 查找即将开始的课程
  const schedules = await Schedule.find({
    date: checkDate,
    status: { $in: ['available', 'full'] },
    start_time: { $lte: checkTime.format('HH:mm') }
  });
  
  const results = [];
  for (const schedule of schedules) {
    try {
      const result = await exports.checkAndCancelLowAttendance(schedule._id);
      results.push({ scheduleId: schedule._id, ...result });
    } catch (err) {
      results.push({ scheduleId: schedule._id, error: err.message });
    }
  }
  
  return results;
};

// ========== 签到功能 ==========

// 扫码签到
exports.checkIn = async (scheduleId, userId, operatorId = null, isOnsite = false, checkInMethod = 'scan') => {
  const schedule = await Schedule.findById(scheduleId)
    .populate('coach_id', 'name')
    .populate('dance_style_id', 'name')
    .populate('store_id', 'name');
  if (!schedule) throw new Error('课程不存在');

  let booking = await Booking.findOne({
    schedule_id: scheduleId,
    user_id: userId,
    status: 'booked',
  });

  if (!booking) {
    if (!isOnsite) {
      throw new Error('该会员未预约本节课');
    }

    booking = await Booking.create({
      user_id: userId,
      schedule_id: scheduleId,
      coach_id: schedule.coach_id,
      dance_style_id: schedule.dance_style_id,
      store_id: schedule.store_id,
      booking_date: schedule.date,
      booking_time: schedule.start_time,
      status: 'completed',
      credits_deducted: schedule.credits_cost || 1,
      source: 'onsite',
      check_in_time: new Date(),
      check_in_by: operatorId,
      ...buildBookingSnapshot(schedule),  // 课程快照
    });

    if (booking.credits_deducted > 0) {
      try {
        const userPackage = await UserPackage.findOne({
          user_id: userId,
          status: 'active',
        }).sort({ created_at: -1 });

        if (userPackage && userPackage.remaining_credits >= booking.credits_deducted) {
          userPackage.remaining_credits -= booking.credits_deducted;
          if (userPackage.used_credits !== undefined) {
            userPackage.used_credits = (userPackage.used_credits || 0) + booking.credits_deducted;
          }
          await userPackage.save();
        }
      } catch (err) {
        console.error('onsite check-in 扣减课时失败:', err);
      }
    }
  } else {
    if (booking.status === 'completed') {
      throw new Error('已签到过');
    }

    booking.status = 'completed';
    booking.check_in_time = new Date();
    booking.check_in_by = operatorId;
    booking.checked_in = true;
    await booking.save();
  }

  const attendanceService = require('./attendance.service');
  await attendanceService.createAttendance({
    schedule_id: scheduleId,
    user_id: userId,
    booking_id: booking._id,
    store_id: schedule.store_id,
    coach_id: schedule.coach_id,
    dance_style_id: schedule.dance_style_id,
    check_in_time: new Date(),
    check_in_by: operatorId,
    source: isOnsite ? 'onsite' : 'booking',
    check_in_method: checkInMethod,
    credits_cost: booking.credits_deducted || schedule.credits_cost || 0,
    date: schedule.date,
    course_name: schedule.course_name || '',
    ...buildAttendanceSnapshot(schedule),  // 课程快照
  });

  const now = new Date();
  const scheduleEndTime = new Date(schedule.date + 'T' + schedule.end_time);
  if (now >= scheduleEndTime) {
    schedule.status = 'completed';
    await schedule.save();
  }

  return booking;
};

// ========== 自动签到 ==========

exports.autoCheckIn = async (scheduleId) => {
  const schedule = await Schedule.findById(scheduleId)
    .populate('coach_id', 'name')
    .populate('dance_style_id', 'name')
    .populate('store_id', 'name');
  if (!schedule) return { processed: 0, errors: ['课程不存在'] };

  const bookings = await Booking.find({
    schedule_id: scheduleId,
    checked_in: false,
    status: 'booked',
  });

  const results = { processed: 0, checked_in: 0, errors: [] };

  for (const booking of bookings) {
    try {
      booking.status = 'completed';
      booking.check_in_time = new Date();
      booking.checked_in = true;
      await booking.save();

      const attendanceService = require('./attendance.service');
      await attendanceService.createAttendance({
        schedule_id: scheduleId,
        user_id: booking.user_id,
        booking_id: booking._id,
        store_id: schedule.store_id,
        coach_id: schedule.coach_id,
        dance_style_id: schedule.dance_style_id,
        check_in_time: new Date(),
        source: 'booking',
        check_in_method: 'auto',
        credits_cost: booking.credits_deducted || schedule.credits_cost || 0,
        date: schedule.date,
        course_name: schedule.course_name || '',
        ...buildAttendanceSnapshot(schedule),  // 课程快照
      });

      results.checked_in++;
      results.processed++;
    } catch (err) {
      results.errors.push(`用户${booking.user_id}: ${err.message}`);
      results.processed++;
    }
  }

  // 课程结束后标记为已完成（保护机制：确保即使class_complete任务失败，课程状态也能正确更新）
  const now = dayjs().tz(BEIJING_TZ);
  const scheduleEndTime = dayjs.tz(schedule.date + ' ' + schedule.end_time, BEIJING_TZ);
  if (now.isAfter(scheduleEndTime)) {
    if (schedule.status !== 'completed') {
      schedule.status = 'completed';
      await schedule.save();
    }
  }

  return results;
};

// 获取课程的签到记录
exports.getCheckInRecords = async (scheduleId) => {
  const bookings = await Booking.find({
    schedule_id: scheduleId
  })
    .populate('user_id', 'nick_name real_name phone avatar_url')
    .sort({ created_at: 1 });
  
  const checkedIn = bookings.filter(b => b.status === 'completed');
  const booked = bookings.filter(b => b.status === 'booked');
  const cancelled = bookings.filter(b => b.status === 'cancelled');
  
  return {
    total: bookings.length,
    checkedIn: checkedIn.length,
    booked: booked.length,
    cancelled: cancelled.length,
    records: {
      checkedIn,
      booked,
      cancelled
    }
  };
};

// 批量签到
exports.batchCheckIn = async (scheduleId, userIds, operatorId) => {
  const results = [];
  for (const userId of userIds) {
    try {
      const result = await exports.checkIn(scheduleId, userId, operatorId);
      results.push({ userId, success: true, result });
    } catch (err) {
      results.push({ userId, success: false, error: err.message });
    }
  }
  return results;
};

// 线下补签到 - 未预约的会员线下经工作人员同意后补签到
// 签到时即时扣课时（次卡扣1 credit，时间卡占1次日/周名额）
// 拦截条件：次卡次数不够/时间卡超限/套餐过期/无可用套餐/停卡会员（签到后恢复）
exports.onsiteCheckIn = async (scheduleId, userId, operatorId = null, userPackageId = null) => {
  const schedule = await Schedule.findById(scheduleId)
    .populate('coach_id', 'name')
    .populate('store_id', 'name')
    .populate('dance_style_id', 'name');
  if (!schedule) throw new Error('课程不存在');

  // 课程必须是进行中或已完成状态才能补签到
  if (![SCHEDULE_STATUS.IN_PROGRESS, SCHEDULE_STATUS.COMPLETED].includes(schedule.status)) {
    throw new Error('课程未开课，无法补签到');
  }

  // 检查是否已有预约记录
  let booking = await Booking.findOne({
    schedule_id: scheduleId,
    user_id: userId,
  });

  if (booking) {
    if (booking.status === 'completed' && booking.checked_in) {
      throw new Error('该会员已签到，无需重复签到');
    }
    if (booking.status === 'cancelled') {
      throw new Error('该会员已取消预约，请先重新预约再签到');
    }
    // 已有 booked 预约，直接签到
    booking.status = 'completed';
    booking.checked_in = true;
    booking.check_in_time = new Date();
    booking.check_in_method = 'onsite';
    booking.checked_in_by = operatorId;
    await booking.save();
  } else {
    // 无预约记录，创建新的补签预约
    const user = await User.findById(userId);
    if (!user) throw new Error('用户不存在');

    // 检查会员状态
    if (user.member_status !== 'official') {
      throw new Error('非正式会员，无法补签到');
    }

    // 选择套餐并检查可用性（优先使用指定套餐）
    const UserPackage = require('../models/UserPackage');
    let pkg;
    if (userPackageId) {
      pkg = await UserPackage.findOne({
        _id: userPackageId,
        user_id: userId,
        store_id: schedule.store_id,
        is_activated: true,
      });
      if (!pkg) throw new Error('指定的套餐不存在或不属于该会员');
    } else {
      pkg = await UserPackage.findOne({
        user_id: userId,
        store_id: schedule.store_id,
        status: 'active',
        is_activated: true,
        is_suspended: { $ne: true },
      }).sort({ package_type: 1, created_at: -1 });
    }

    if (!pkg) {
      throw new Error('无可用套餐，无法补签到');
    }

    // 检查套餐是否过期
    if (pkg.end_date && new Date() > new Date(pkg.end_date)) {
      throw new Error('套餐过期，无法补签到');
    }

    // 次卡检查次数
    if (pkg.package_type === 'count_card') {
      if (pkg.remaining_credits < (schedule.credits_cost || 1)) {
        throw new Error('次卡套餐次数不够');
      }
    }

    // 时间卡检查日/周限制
    if (pkg.package_type === 'time_card') {
      const limitCheck = await checkTimeCardLimit(pkg, schedule.date, schedule.credits_cost || 1);
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.reason);
      }
    }

    // 停卡会员：签到后终止停卡期限，恢复正常服务
    if (pkg.is_suspended) {
      pkg.is_suspended = false;
      pkg.suspended_at = null;
      pkg.suspend_end_date = null;
      // 恢复冻结的课时
      if (pkg.frozen_remaining_credits > 0) {
        pkg.remaining_credits = pkg.frozen_remaining_credits;
        pkg.frozen_remaining_credits = 0;
      }
      if (pkg.frozen_end_date) {
        pkg.end_date = pkg.frozen_end_date;
        pkg.frozen_end_date = null;
      }
    }

    // 即时扣课时（次卡）
    let creditsDeducted = 0;
    if (pkg.package_type === 'count_card') {
      creditsDeducted = schedule.credits_cost || 1;
      pkg.remaining_credits -= creditsDeducted;
      if (pkg.remaining_credits <= 0) {
        pkg.remaining_credits = 0;
        pkg.status = 'exhausted';
      }
    }
    await pkg.save();

    // 创建 booking 记录
    const snapshot = buildBookingSnapshot(schedule);
    booking = await Booking.create({
      user_id: userId,
      schedule_id: scheduleId,
      coach_id: schedule.coach_id,
      dance_style_id: schedule.dance_style_id,
      store_id: schedule.store_id,
      booking_date: schedule.date,
      booking_time: schedule.start_time,
      status: 'completed',
      checked_in: true,
      check_in_time: new Date(),
      check_in_method: 'onsite',
      checked_in_by: operatorId,
      credits_deducted: creditsDeducted,
      user_package_id: pkg._id,
      source: 'onsite',
      ...snapshot,
    });

    // 更新排课人数
    await Schedule.findByIdAndUpdate(scheduleId, { $inc: { current_bookings: 1 } });
  }

  // 创建 attendance 记录
  try {
    const attendanceService = require('./attendance.service');
    await attendanceService.createAttendance({
      schedule_id: scheduleId,
      user_id: userId,
      booking_id: booking._id,
      store_id: schedule.store_id,
      coach_id: schedule.coach_id,
      dance_style_id: schedule.dance_style_id,
      check_in_time: booking.check_in_time,
      check_in_by: operatorId,
      source: 'onsite',
      check_in_method: 'onsite',
      credits_cost: booking.credits_deducted || schedule.credits_cost || 0,
      date: schedule.date,
      course_name: schedule.course_name || '',
      start_time: schedule.start_time || '',
      end_time: schedule.end_time || '',
      duration: schedule.duration || 0,
      coach_name: schedule.coach_id?.name || '',
      store_name: schedule.store_id?.name || '',
    });
  } catch (attErr) {
    console.error('[onsiteCheckIn] 创建attendance失败:', attErr.message);
  }

  return booking;
};

// 导出预约记录为CSV
exports.exportBookings = async (store_id, start_date, end_date) => {
  let query = {};
  
  if (store_id) {
    query.store_id = store_id;
  }
  
  if (start_date && end_date) {
    query.booking_date = {
      $gte: start_date,
      $lte: end_date
    };
  }
  
  const bookings = await Booking.find(query)
    .populate('user_id', 'nick_name real_name phone member_code')
    .populate('schedule_id')
    .sort({ created_at: -1 });
  
  let csv = '\uFEFF会员编码,会员姓名,手机号,课程名称,上课日期,上课时间,预约时间,状态\n';
  
  bookings.forEach(booking => {
    const schedule = booking.schedule_id;
    // 快照降级：优先读 schedule 实时数据，其次读 booking 快照字段
    const courseName = (schedule && schedule.course_name) || booking.course_name || '';
    const schDate = (schedule && schedule.date) || booking.schedule_date || '';
    const schStartTime = (schedule && schedule.start_time) || booking.schedule_start_time || '';
    const row = [
      booking.user_id && booking.user_id.member_code ? booking.user_id.member_code : '',
      `"${booking.user_id && (booking.user_id.real_name || booking.user_id.nick_name) || ''}"`,
      booking.user_id && booking.user_id.phone ? booking.user_id.phone : '',
      courseName,
      schDate ? schDate.split('T')[0] : '',
      schStartTime,
      booking.created_at ? booking.created_at.toLocaleString('zh-CN') : '',
      booking.status === 'completed' ? '已完成' : booking.status === 'cancelled' ? '已取消' : booking.status === 'booked' ? '已预约' : booking.status
    ].join(',');
    csv += row + '\n';
  });
  
  return csv;
};

// 导出上课记录为CSV
exports.exportAttendance = async (store_id, start_date, end_date) => {
  let query = {
    status: 'completed',
    check_in_time: { $exists: true }
  };
  
  if (store_id) {
    query.store_id = store_id;
  }
  
  if (start_date && end_date) {
    query.check_in_time = {
      $gte: new Date(start_date),
      $lte: new Date(end_date + 'T23:59:59')
    };
  }
  
  const bookings = await Booking.find(query)
    .populate('user_id', 'nick_name real_name phone member_code')
    .populate('schedule_id')
    .sort({ check_in_time: -1 });
  
  let csv = '\uFEFF会员编码,会员姓名,手机号,课程名称,上课日期,上课时间,签到时间,消耗次数\n';
  
  bookings.forEach(booking => {
    const schedule = booking.schedule_id;
    const row = [
      booking.user_id && booking.user_id.member_code ? booking.user_id.member_code : '',
      `"${booking.user_id && (booking.user_id.real_name || booking.user_id.nick_name) || ''}"`,
      booking.user_id && booking.user_id.phone ? booking.user_id.phone : '',
      schedule && schedule.course_name ? schedule.course_name : '',
      schedule && schedule.date ? schedule.date.split('T')[0] : '',
      schedule && schedule.start_time ? schedule.start_time : '',
      booking.check_in_time ? booking.check_in_time.toLocaleString('zh-CN') : '',
      booking.credits_consumed || booking.class_count_consumed || 1
    ].join(',');
    csv += row + '\n';
  });
  
  return csv;
};
