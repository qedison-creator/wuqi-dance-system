const Schedule = require('../models/Schedule');
const Booking = require('../models/Booking');
const Attendance = require('../models/Attendance');
const Holiday = require('../models/Holiday');
const Coach = require('../models/Coach');
const Store = require('../models/Store');
const DanceStyle = require('../models/DanceStyle');
const Waitlist = require('../models/Waitlist');
const PendingTask = require('../models/PendingTask');
const logService = require('./log.service');
const attendanceService = require('./attendance.service');
const coachAttendanceService = require('./coachAttendance.service');
const { SCHEDULE_STATUS, CANCEL_REASON, CANCELLED_STATUSES, TERMINAL_STATUSES } = require('../constants/scheduleStatus.constants');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BEIJING_TZ = 'Asia/Shanghai';

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// 判断排课是否因人数不足而实质失效（预约截止已过 + 当前人数 < 最低要求）
// 用于冲突检测时排除此类"僵尸"排课，避免阻挡新排课
async function isEffectivelyCancelled(schedule) {
  if (!schedule) return false;
  // 已明确取消/下架的直接排除
  if (CANCELLED_STATUSES.includes(schedule.status) || schedule.status === SCHEDULE_STATUS.DELETED) return true;
  // 仅对 available/full 状态做动态检查
  if (schedule.status !== SCHEDULE_STATUS.AVAILABLE && schedule.status !== SCHEDULE_STATUS.FULL) return false;
  if (!schedule.date || !schedule.start_time) return false;
  const bookingDeadline = schedule.booking_deadline || 120;
  const startDateTime = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ);
  if (!startDateTime.isValid()) return false;
  const bookingDeadlineTime = startDateTime.subtract(bookingDeadline, 'minute');
  if (!dayjs().tz(BEIJING_TZ).isAfter(bookingDeadlineTime)) return false;
  const minBookings = schedule.min_bookings || 5;
  // 始终实时计数，不信任文档中的 current_bookings（可能因部分持久化失败而陈旧）
  const currentBookings = await Booking.countDocuments({ schedule_id: schedule._id, status: 'booked' });
  return currentBookings < minBookings;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ============ 统一状态变更事件函数（唯一真相源）============
// 三个关键时间点由 PendingTask 事件驱动，此处为实际执行逻辑

/**
 * 事件1：预约截止时间到达 - 检查人数是否达标
 * 人数不足 → 取消课程 + 退课时 + 推送通知
 * 人数达标 → 不操作，等待开课
 */
async function checkAndCancelIfInsufficient(scheduleId) {
  try {
    const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
    if (!schedule) return;
    // 已是终态直接返回
    if (TERMINAL_STATUSES.includes(schedule.status)) return;
    // 仅对 available/full 状态检查
    if (schedule.status !== SCHEDULE_STATUS.AVAILABLE && schedule.status !== SCHEDULE_STATUS.FULL) return;

    const minBookings = schedule.min_bookings || 5;
    const currentBookings = await Booking.countDocuments({
      schedule_id: scheduleId,
      status: 'booked',
    });

    if (currentBookings < minBookings) {
      // 人数不足，取消课程
      schedule.status = SCHEDULE_STATUS.CANCELLED;
      schedule.cancel_reason = CANCEL_REASON.MIN_BOOKINGS_NOT_MET;
      schedule.cancel_type = 'min_bookings_not_met';
      await schedule.save();

      // 取消所有已预约的 booking 并退还课时
      const UserPackage = require('../models/UserPackage');
      const bookedBookings = await Booking.find({ schedule_id: scheduleId, status: 'booked' });

      for (const booking of bookedBookings) {
        booking.status = 'cancelled';
        booking.cancel_type = 'min_bookings_not_met';
        booking.cancel_time = new Date();
        booking.cancel_reason = '因预约人数不足，课程已取消';
        booking.credits_refunded = booking.credits_deducted;
        await booking.save();

        // 退还课时（次卡）
        if (booking.user_package_id) {
          const pkg = await UserPackage.findById(booking.user_package_id);
          if (pkg && pkg.package_type === 'count_card') {
            pkg.remaining_credits += booking.credits_deducted;
            if (pkg.status === 'exhausted' && pkg.remaining_credits > 0) {
              pkg.status = 'active';
            }
            await pkg.save();
          }
        }

        // 推送微信通知
        try {
          const wechatMessageService = require('./wechat-message.service');
          const User = require('../models/User');
          const bookingUser = await User.findById(booking.user_id);
          if (bookingUser && bookingUser.openid) {
            await wechatMessageService.sendBookingCancel(bookingUser, schedule, '因预约人数不足，课程已取消，课时已退还');
          }
        } catch (notifyErr) {
          console.error(`[checkAndCancelIfInsufficient] 推送通知失败:`, notifyErr.message);
        }
      }

      // 清理 PendingTask（课程已取消，不需要再自动签到和完成）
      await PendingTask.deleteMany({
        schedule_id: scheduleId,
        type: { $in: ['auto_check_in', 'class_complete'] },
      });

      console.log(`[checkAndCancelIfInsufficient] 课程人数不足已取消: ${schedule.course_name} ${schedule.date}, 影响${bookedBookings.length}人`);
    }
  } catch (err) {
    console.error(`[checkAndCancelIfInsufficient] 执行失败 scheduleId=${scheduleId}:`, err.message);
  }
}

/**
 * 事件2：课程开始时间到达 - 自动签到所有已预约会员
 * 将 schedule 状态改为 in_progress，所有 booked 会员自动签到
 */
async function autoCheckInAtStart(scheduleId) {
  try {
    const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
    if (!schedule) return;
    // 已是终态直接返回
    if (TERMINAL_STATUSES.includes(schedule.status)) return;
    // 仅对 available/full 状态触发
    if (schedule.status !== SCHEDULE_STATUS.AVAILABLE && schedule.status !== SCHEDULE_STATUS.FULL) return;

    // 状态改为进行中
    schedule.status = SCHEDULE_STATUS.IN_PROGRESS;
    await schedule.save();

    // 对所有已预约会员自动签到
    const bookedBookings = await Booking.find({ schedule_id: scheduleId, status: 'booked' });

    for (const booking of bookedBookings) {
      booking.status = 'completed';
      booking.checked_in = true;
      booking.check_in_time = new Date();
      booking.check_in_method = 'auto';
      await booking.save();

      // 创建 attendance 记录
      const existingAtt = await Attendance.findOne({ schedule_id: scheduleId, user_id: booking.user_id });
      if (!existingAtt) {
        try {
          await attendanceService.createAttendance({
            schedule_id: scheduleId,
            user_id: booking.user_id,
            booking_id: booking._id,
            store_id: schedule.store_id,
            coach_id: schedule.coach_id,
            dance_style_id: schedule.dance_style_id,
            check_in_time: booking.check_in_time,
            source: 'booking',
            check_in_method: 'auto',
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
          console.error(`[autoCheckInAtStart] 创建attendance失败 userId=${booking.user_id}:`, attErr.message);
        }
      }
    }

    console.log(`[autoCheckInAtStart] 课程已开课自动签到: ${schedule.course_name} ${schedule.date}, 签到${bookedBookings.length}人`);
  } catch (err) {
    console.error(`[autoCheckInAtStart] 执行失败 scheduleId=${scheduleId}:`, err.message);
  }
}

/**
 * 事件3：课程结束时间到达 - 标记课程完成 + 写教练课时记录
 * 将 schedule 状态改为 completed，写 CoachAttendance
 */
async function finalizeSchedule(scheduleId) {
  try {
    const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
    if (!schedule) return;
    // 已是终态直接返回
    if (TERMINAL_STATUSES.includes(schedule.status)) return;

    // 状态改为已完成
    schedule.status = SCHEDULE_STATUS.COMPLETED;
    await schedule.save();

    // 确保所有 booked 的 booking 都已签到（兜底：防止 autoCheckInAtStart 漏执行）
    const pendingBookings = await Booking.find({ schedule_id: scheduleId, status: 'booked' });
    for (const booking of pendingBookings) {
      booking.status = 'completed';
      if (!booking.checked_in) {
        booking.checked_in = true;
        booking.check_in_time = booking.check_in_time || new Date();
        booking.check_in_method = booking.check_in_method || 'auto';
      }
      await booking.save();

      // 补建 attendance 记录
      const existingAtt = await Attendance.findOne({ schedule_id: scheduleId, user_id: booking.user_id });
      if (!existingAtt) {
        try {
          await attendanceService.createAttendance({
            schedule_id: scheduleId,
            user_id: booking.user_id,
            booking_id: booking._id,
            store_id: schedule.store_id,
            coach_id: schedule.coach_id,
            dance_style_id: schedule.dance_style_id,
            check_in_time: booking.check_in_time || new Date(),
            source: 'booking',
            check_in_method: booking.check_in_method || 'auto',
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
          console.error(`[finalizeSchedule] 补建attendance失败 userId=${booking.user_id}:`, attErr.message);
        }
      }
    }

    // 写教练课时记录（独立审计）
    await coachAttendanceService.recordCoachAttendance(scheduleId);

    console.log(`[finalizeSchedule] 课程已完成: ${schedule.course_name} ${schedule.date}`);
  } catch (err) {
    console.error(`[finalizeSchedule] 执行失败 scheduleId=${scheduleId}:`, err.message);
  }
}

// 兜底补偿：当 PendingTask 因服务器重启/延迟未执行时，查询时触发补偿
// 保留原函数名以兼容外部调用，内部委托给 finalizeSchedule
async function ensureFinalState(scheduleId) {
  return finalizeSchedule(scheduleId);
}

// 获取排课列表(会员端/管理端)
exports.getScheduleList = async (query, req = null) => {
  const { store_id, date, start_date, end_date, dance_style_id, coach_id, status, page = 1, pageSize = 20, limit } = query;
  const filter = {};

  if (store_id) filter.store_id = store_id;
  if (dance_style_id) filter.dance_style_id = dance_style_id;
  if (coach_id) filter.coach_id = coach_id;
  if (date) {
    filter.date = date;
  } else if (start_date || end_date) {
    filter.date = {};
    if (start_date) filter.date.$gte = start_date;
    if (end_date) filter.date.$lte = end_date;
  }

  if (status && status !== 'all') {
    filter.status = status;
  } else if (status === 'all') {
    // 管理端查询所有状态时排除软删除记录
    filter.status = { $ne: 'deleted' };
  } else {
    filter.status = { $in: ['available', 'full'] };
    if (!date && !start_date) {
      const today = dayjs().format('YYYY-MM-DD');
      filter.date = filter.date || {};
      filter.date.$gte = today;
    }
  }

  const effectiveLimit = limit ? Number(limit) : Number(pageSize);

  const docs = await Schedule.find(filter)
    .populate('store_id', 'name address')
    .populate('coach_id', 'name avatar_url')
    .populate('dance_style_id', 'name icon_url')
    .sort({ date: 1, start_time: 1 })
    .skip(limit ? 0 : (page - 1) * effectiveLimit)
    .limit(effectiveLimit);

  const total = await Schedule.countDocuments(filter);

  // 转为普通对象数组，避免 Mongoose Document 修改问题
  const list = docs.map(d => {
    const obj = d.toObject ? d.toObject() : d;
    // 确保 cover 字段始终存在（即使是空字符串）
    if (!obj.hasOwnProperty('cover')) {
      obj.cover = '';
    }
    return obj;
  });

  if (list.length > 0) {
    const scheduleIds = list.map(s => s._id);
    const bookings = await Booking.find({
      schedule_id: { $in: scheduleIds },
      status: 'booked'
    }).populate('user_id', 'avatar_url').lean();

    const bookingsBySchedule = {};
    const bookingCountBySchedule = {};
    for (const b of bookings) {
      const sid = String(b.schedule_id);
      if (!bookingsBySchedule[sid]) bookingsBySchedule[sid] = [];
      if (!bookingCountBySchedule[sid]) bookingCountBySchedule[sid] = 0;
      bookingCountBySchedule[sid]++;
      if (b.user_id && b.user_id.avatar_url) {
        bookingsBySchedule[sid].push({
          user_id: String(b.user_id._id || b.user_id),
          avatar_url: b.user_id.avatar_url
        });
      }
    }

    const host = req ? `${req.protocol}://${req.get('host')}` : '';
    const now = dayjs().tz(BEIJING_TZ);

    for (const schedule of list) {
      const sid = String(schedule._id);
      const currentBookings = bookingCountBySchedule[sid] || 0;
      schedule.booked_users = bookingsBySchedule[sid] || [];
      schedule.current_bookings = currentBookings;

      // 统一状态体系：查询时只读 DB 状态，不再动态覆盖
      // 兜底补偿：仅当 PendingTask 事件可能丢失时，触发对应事件函数
      if (!TERMINAL_STATUSES.includes(schedule.status) && schedule.date && schedule.start_time && schedule.end_time) {
        try {
          const startDateTime = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ);
          const endDateTime = dayjs.tz(schedule.date + ' ' + schedule.end_time, BEIJING_TZ);
          if (!startDateTime.isValid() || !endDateTime.isValid()) continue;

          const bookingDeadline = schedule.booking_deadline || 120;
          const bookingDeadlineTime = startDateTime.subtract(bookingDeadline, 'minute');

          if (now.isAfter(endDateTime)) {
            // 课程已结束 → 触发 finalizeSchedule（兜底）
            await finalizeSchedule(schedule._id);
            // 重新读取状态
            const updated = await Schedule.findById(schedule._id).lean();
            if (updated) schedule.status = updated.status;
          } else if (now.isAfter(startDateTime) && schedule.status !== SCHEDULE_STATUS.IN_PROGRESS) {
            // 课程已开始但状态未更新 → 触发 autoCheckInAtStart（兜底）
            await autoCheckInAtStart(schedule._id);
            const updated = await Schedule.findById(schedule._id).lean();
            if (updated) schedule.status = updated.status;
          } else if (now.isAfter(bookingDeadlineTime) && currentBookings > 0 && currentBookings < (schedule.min_bookings || 5)) {
            // 截止时间已过且有人预约但人数不足 → 触发 checkAndCancelIfInsufficient（兜底）
            // 注意：currentBookings === 0 时不触发，避免新建的空课程被误取消
            await checkAndCancelIfInsufficient(schedule._id);
            const updated = await Schedule.findById(schedule._id).lean();
            if (updated) schedule.status = updated.status;
          }
        } catch (e) {
          console.warn(`[getScheduleList] 兜底补偿失败 schedule=${schedule._id}:`, e.message);
        }
      }

      // 处理封面图片URL：将相对路径转为完整URL
      if (schedule.cover && !schedule.cover.startsWith('http')) {
        if (host) {
          schedule.cover = `${host}${schedule.cover}`;
        }
      }
    }
  }

  return { list, total, page: Number(page), pageSize: effectiveLimit };
};

// 获取排课详情
exports.getScheduleById = async (id, req = null) => {
  const schedule = await Schedule.findById(id)
    .populate('store_id', 'name address')
    .populate('coach_id', 'name avatar_url dance_styles')
    .populate('dance_style_id', 'name icon_url');
  if (!schedule) {
    throw new Error('排课不存在');
  }

  // 统一转换为普通对象并处理封面图片URL
  const scheduleObj = schedule.toObject ? schedule.toObject() : schedule;

  // 统一状态体系：查询时只读 DB 状态，不再动态覆盖
  // 兜底补偿：仅当 PendingTask 事件可能丢失时，触发对应事件函数
  if (!TERMINAL_STATUSES.includes(scheduleObj.status) && scheduleObj.date && scheduleObj.start_time && scheduleObj.end_time) {
    try {
      const now = dayjs().tz(BEIJING_TZ);
      const startDateTime = dayjs.tz(scheduleObj.date + ' ' + scheduleObj.start_time, BEIJING_TZ);
      const endDateTime = dayjs.tz(scheduleObj.date + ' ' + scheduleObj.end_time, BEIJING_TZ);
      if (endDateTime.isValid() && now.isAfter(endDateTime)) {
        // 课程已结束 → 触发 finalizeSchedule（兜底）
        await finalizeSchedule(id);
        const updated = await Schedule.findById(id).lean();
        if (updated) scheduleObj.status = updated.status;
      } else if (startDateTime.isValid() && now.isAfter(startDateTime) && scheduleObj.status !== SCHEDULE_STATUS.IN_PROGRESS) {
        // 课程已开始但状态未更新 → 触发 autoCheckInAtStart（兜底）
        await autoCheckInAtStart(id);
        const updated = await Schedule.findById(id).lean();
        if (updated) scheduleObj.status = updated.status;
      }
    } catch (e) {
      console.warn(`[getScheduleById] 兜底补偿失败 schedule=${id}:`, e.message);
    }
  }

  if (req && scheduleObj.cover && !scheduleObj.cover.startsWith('http')) {
    const host = `${req.protocol}://${req.get('host')}`;
    scheduleObj.cover = `${host}${scheduleObj.cover}`;
  }

  return scheduleObj;
};

// 新增排课 - 核心业务逻辑
exports.createSchedule = async (data, operatorId) => {
  const {
    store_id, schedule_type, course_name, dance_style_id, coach_id,
    date, start_time, end_time, duration, classroom, max_bookings, min_bookings,
    booking_deadline, cancel_deadline, credits_cost, remark, cycle_config, from_template, cover,
  } = data;

  // 1. 参数校验
  if (!store_id || !date || !start_time || !dance_style_id || !coach_id) {
    throw new Error('缺少必填参数(store_id, date, start_time, dance_style_id, coach_id)');
  }

  // 2. 时长校验(30-180分钟)
  const finalDuration = duration || 75;
  if (finalDuration < 30 || finalDuration > 180) {
    throw new Error('课程时长必须在30-180分钟之间');
  }

  // 3. 人数校验
  const finalMaxBookings = max_bookings || 20;
  const finalMinBookings = min_bookings || 5;
  if (finalMaxBookings < 3 || finalMaxBookings > 30) {
    throw new Error('最大预约人数必须在3-30之间');
  }
  if (finalMinBookings < 1 || finalMinBookings > 15) {
    throw new Error('最低预约人数必须在1-15之间');
  }
  if (finalMinBookings > finalMaxBookings) {
    throw new Error('最低预约人数不能大于最大预约人数');
  }

  // 4. 自动计算下课时间(如果前端没传)
  let finalEndTime = end_time;
  if (!finalEndTime) {
    finalEndTime = dayjs(date + ' ' + start_time).add(finalDuration, 'minute').format('HH:mm');
  }

  // 5. 教练时间冲突校验（同门店 + 跨门店）
  // 5a. 同门店冲突：同一教练、同一门店、同一天、时间段重叠
  const sameStoreConflict = await Schedule.findOne({
    store_id,
    coach_id,
    date,
    status: { $in: ['available', 'full'] },
    start_time: { $lt: finalEndTime },
    end_time: { $gt: start_time },
  }).populate('store_id', 'name');
  if (sameStoreConflict && !(await isEffectivelyCancelled(sameStoreConflict))) {
    throw new Error('该教练在此时间段已有排课，请选择其他时间');
  }

  // 5b. 跨门店冲突：同一教练、不同门店、同一天，需1小时通勤缓冲
  const CROSS_STORE_BUFFER_MINUTES = 60;
  const newStartMinutes = timeToMinutes(start_time);
  const newEndMinutes = timeToMinutes(finalEndTime);

  const crossStoreSchedules = await Schedule.find({
    coach_id,
    date,
    store_id: { $ne: store_id },
    status: { $in: ['available', 'full'] },
  }).populate('store_id', 'name');

  for (const existing of crossStoreSchedules) {
    // 跳过实质已取消的排课
    if (await isEffectivelyCancelled(existing)) continue;

    const existingStartMinutes = timeToMinutes(existing.start_time);
    const existingEndMinutes = timeToMinutes(existing.end_time);

    // 新课在已有课程之前：新课结束时间 + 缓冲 > 已有课程开始时间
    if (newEndMinutes + CROSS_STORE_BUFFER_MINUTES > existingStartMinutes
        && newEndMinutes <= existingEndMinutes) {
      const storeName = existing.store_id?.name || '其他门店';
      throw new Error(`该教练在${storeName}有课程（${existing.start_time}-${existing.end_time}），课后需1小时通勤时间，请调整开课时间`);
    }

    // 新课在已有课程之后：已有课程结束时间 + 缓冲 > 新课开始时间
    if (existingEndMinutes + CROSS_STORE_BUFFER_MINUTES > newStartMinutes
        && existingStartMinutes < newStartMinutes) {
      const storeName = existing.store_id?.name || '其他门店';
      const earliestStart = minutesToTime(existingEndMinutes + CROSS_STORE_BUFFER_MINUTES);
      throw new Error(`该教练在${storeName}有课程（${existing.start_time}-${existing.end_time}），课后需1小时通勤时间，请将开课时间调整到${earliestStart}之后`);
    }

    // 新课与已有课程时间重叠
    if (newStartMinutes < existingEndMinutes && newEndMinutes > existingStartMinutes) {
      const storeName = existing.store_id?.name || '其他门店';
      throw new Error(`该教练在${storeName}有课程（${existing.start_time}-${existing.end_time}），时间冲突，请调整开课时间`);
    }
  }

  // 6. 教室冲突校验(如果指定了教室)
  if (classroom) {
    const classroomConflict = await Schedule.findOne({
      store_id,
      date,
      classroom,
      status: { $in: ['available', 'full'] },
      $or: [
        { start_time: { $lt: finalEndTime }, end_time: { $gt: start_time } },
      ],
    });
    if (classroomConflict && !(await isEffectivelyCancelled(classroomConflict))) {
      throw new Error(`教室"${classroom}"在此时间段已被占用`);
    }
  }

  // 7. 门店放假校验（按门店过滤）
  const holidayFilter = {
    status: 'active',
    $and: [
      {
        $or: [
          { date: { $lte: date }, end_date: { $gte: date } },
          { date: date, end_date: { $exists: false } },
        ],
      },
      {
        $or: [
          { store_scope: 'all' },
          { store_scope: 'single', store_id: store_id },
        ],
      },
    ],
  };
  const holidayConflict = await Holiday.findOne(holidayFilter);
  if (holidayConflict) {
    throw new Error(`该日期存在放假安排"${holidayConflict.name}"，禁止排课`);
  }

  // 8. 创建排课
  const schedule = await Schedule.create({
    store_id,
    schedule_type: schedule_type || 'group',
    course_name: course_name || '',
    dance_style_id,
    coach_id,
    date,
    start_time,
    end_time: finalEndTime,
    duration: finalDuration,
    classroom: classroom || '',
    max_bookings: finalMaxBookings,
    min_bookings: finalMinBookings,
    booking_deadline: booking_deadline || 120,
    cancel_deadline: cancel_deadline || 60,
    credits_cost: credits_cost || 1,
    from_template: from_template === true,
    remark: remark || '',
    cycle_config: cycle_config || null,
    cover: cover || '',
    status: 'available',
    created_by: operatorId,
  });

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'create',
    module: 'schedule',
    target_id: schedule._id,
    detail: `新增排课: ${course_name || ''} ${date} ${start_time}-${finalEndTime}`,
  });

  // 写 PendingTask：三个精准定时任务
  const deadlineMins = schedule.booking_deadline || 120;
  const checkTriggerAt = dayjs.tz(date + ' ' + start_time, BEIJING_TZ).subtract(deadlineMins, 'minute').toDate();
  const startTriggerAt = dayjs.tz(date + ' ' + start_time, BEIJING_TZ).toDate();
  const endTriggerAt = dayjs.tz(date + ' ' + finalEndTime, BEIJING_TZ).toDate();

  await PendingTask.insertMany([
    { schedule_id: schedule._id, trigger_at: checkTriggerAt, type: 'min_bookings_check' },
    { schedule_id: schedule._id, trigger_at: startTriggerAt,   type: 'auto_check_in' },
    { schedule_id: schedule._id, trigger_at: endTriggerAt,     type: 'class_complete' },
  ]);

  return schedule;
};

// 编辑排课
exports.updateSchedule = async (id, data, operatorId) => {
  const schedule = await Schedule.findById(id);
  if (!schedule) throw new Error('排课不存在');

  // 检查是否已有预约
  const bookingCount = await Booking.countDocuments({
    schedule_id: id,
    status: 'booked',
  });

  if (bookingCount > 0) {
    // 已有预约，仅可修改教室、备注和人数设置，清除其他字段避免误触发冲突检查
    const allowedFields = ['classroom', 'remark', 'note', 'cover', 'max_bookings', 'min_bookings'];
    const filteredData = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        filteredData[key] = data[key];
      }
    }
    // 用过滤后的数据替换，确保不允许修改的字段不残留
    data = filteredData;
  } else {
    // 无预约，检查是否已开始(当天已过开始时间)
    const now = dayjs().tz(BEIJING_TZ);
    const scheduleStart = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ);
    if (now.isAfter(scheduleStart)) {
      throw new Error('已开始的排课不可编辑');
    }

    // 如果修改了时间或时长，重新计算
    if (data.start_time || data.duration) {
      const newStart = data.start_time || schedule.start_time;
      const newDuration = data.duration || schedule.duration;
      data.end_time = dayjs(schedule.date + ' ' + newStart).add(newDuration, 'minute').format('HH:mm');
      data.start_time = newStart;
      data.duration = newDuration;
    }

    const effectiveDate = data.date || schedule.date;
    const effectiveStart = data.start_time || schedule.start_time;
    const effectiveEnd = data.end_time || schedule.end_time;
    const effectiveCoach = data.coach_id || schedule.coach_id;
    const effectiveClassroom = data.classroom || schedule.classroom;
    const effectiveStoreId = data.store_id || schedule.store_id;

    if (data.start_time || data.duration || data.coach_id || data.classroom || data.date || data.store_id) {
      const sameStoreConflict = await Schedule.findOne({
        _id: { $ne: schedule._id },
        store_id: effectiveStoreId,
        coach_id: effectiveCoach,
        date: effectiveDate,
        status: { $in: ['available', 'full'] },
        start_time: { $lt: effectiveEnd },
        end_time: { $gt: effectiveStart },
      }).populate('store_id', 'name');
      if (sameStoreConflict && !(await isEffectivelyCancelled(sameStoreConflict))) {
        throw new Error('该教练在此时间段已有排课，请选择其他时间');
      }

      const timeToMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const CROSS_STORE_BUFFER_MINUTES = 60;
      const newStartM = timeToMinutes(effectiveStart);
      const newEndM = timeToMinutes(effectiveEnd);

      const crossStoreSchedules = await Schedule.find({
        _id: { $ne: schedule._id },
        coach_id: effectiveCoach,
        date: effectiveDate,
        store_id: { $ne: effectiveStoreId },
        status: { $in: ['available', 'full'] },
      }).populate('store_id', 'name');

      for (const existing of crossStoreSchedules) {
        if (await isEffectivelyCancelled(existing)) continue;
        const exStartM = timeToMinutes(existing.start_time);
        const exEndM = timeToMinutes(existing.end_time);
        if (newEndM + CROSS_STORE_BUFFER_MINUTES > exStartM && newEndM <= exEndM) {
          throw new Error(`该教练在${existing.store_id?.name || '其他门店'}有课程（${existing.start_time}-${existing.end_time}），课后需1小时通勤时间，请调整开课时间`);
        }
        if (exEndM + CROSS_STORE_BUFFER_MINUTES > newStartM && exStartM < newStartM) {
          const earliestStart = `${String(Math.floor((exEndM + CROSS_STORE_BUFFER_MINUTES) / 60)).padStart(2, '0')}:${String((exEndM + CROSS_STORE_BUFFER_MINUTES) % 60).padStart(2, '0')}`;
          throw new Error(`该教练在${existing.store_id?.name || '其他门店'}有课程（${existing.start_time}-${existing.end_time}），课后需1小时通勤时间，请将开课时间调整到${earliestStart}之后`);
        }
        if (newStartM < exEndM && newEndM > exStartM) {
          throw new Error(`该教练在${existing.store_id?.name || '其他门店'}有课程（${existing.start_time}-${existing.end_time}），时间冲突，请调整开课时间`);
        }
      }

      if (effectiveClassroom) {
        const classroomConflict = await Schedule.findOne({
          _id: { $ne: schedule._id },
          store_id: effectiveStoreId,
          date: effectiveDate,
          classroom: effectiveClassroom,
          status: { $in: ['available', 'full'] },
          start_time: { $lt: effectiveEnd },
          end_time: { $gt: effectiveStart },
        });
        if (classroomConflict && !(await isEffectivelyCancelled(classroomConflict))) {
          throw new Error(`教室"${effectiveClassroom}"在此时间段已被占用`);
        }
      }
    }
  }

  Object.assign(schedule, data);
  await schedule.save();

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'update',
    module: 'schedule',
    target_id: schedule._id,
    detail: `编辑排课: ${schedule.course_name || ''} ${schedule.date} ${schedule.start_time}-${schedule.end_time}`,
  });

  // 更新 PendingTask（时间或截止时间可能已变）
  const updatedDeadline = schedule.booking_deadline || 120;
  const updatedCheckAt = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ).subtract(updatedDeadline, 'minute').toDate();
  const updatedStartAt = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ).toDate();
  const updatedEndAt = dayjs.tz(schedule.date + ' ' + schedule.end_time, BEIJING_TZ).toDate();

  await PendingTask.updateOne(
    { schedule_id: schedule._id, type: 'min_bookings_check', processed: 'pending' },
    { trigger_at: updatedCheckAt }
  );
  await PendingTask.updateOne(
    { schedule_id: schedule._id, type: 'auto_check_in', processed: 'pending' },
    { trigger_at: updatedStartAt }
  );
  await PendingTask.updateOne(
    { schedule_id: schedule._id, type: 'class_complete', processed: 'pending' },
    { trigger_at: updatedEndAt }
  );

  return schedule;
};

// 取消排课（统一使用 cancelled 状态，cancel_reason 区分原因）
exports.cancelSchedule = async (id, operatorId, reason = '', cancelType = 'admin_cancel') => {
  const schedule = await Schedule.findById(id).populate('coach_id', 'name').populate('store_id', 'name');
  if (!schedule) throw new Error('排课不存在');
  if (schedule.status === SCHEDULE_STATUS.CANCELLED) throw new Error('该排课已取消');

  const cancelReason = reason || (cancelType === 'min_bookings_not_met' ? '预约人数不足' : '管理员取消排课');

  // 统一使用 cancelled 状态，cancel_reason 区分原因
  schedule.status = SCHEDULE_STATUS.CANCELLED;
  schedule.cancel_type = cancelType;
  schedule.cancel_reason = cancelType === 'min_bookings_not_met' ? CANCEL_REASON.MIN_BOOKINGS_NOT_MET
    : cancelType === 'holiday' ? CANCEL_REASON.HOLIDAY
    : CANCEL_REASON.ADMIN_CANCEL;
  await schedule.save();

  // 自动退还所有已预约会员的课时
  const bookings = await Booking.find({
    schedule_id: id,
    status: 'booked',
  });

  const UserPackage = require('../models/UserPackage');
  for (const booking of bookings) {
    booking.status = 'cancelled';
    booking.cancel_type = cancelType;
    booking.cancel_time = new Date();
    booking.cancel_reason = cancelReason;
    booking.credits_refunded = booking.credits_deducted;
    await booking.save();

    // 恢复会员课时
    if (booking.user_id) {
      const pkg = booking.user_package_id
        ? await UserPackage.findById(booking.user_package_id)
        : await UserPackage.findOne({ user_id: booking.user_id, store_id: schedule.store_id, status: 'active' });
      if (pkg) {
        pkg.remaining_credits += booking.credits_deducted;
        if (pkg.status === 'exhausted') pkg.status = 'active';
        await pkg.save();
        try {
          const wechatMessageService = require('./wechat-message.service');
          const User = require('../models/User');
          const bookingUser = await User.findById(booking.user_id);
          if (bookingUser && bookingUser.openid) {
            await wechatMessageService.sendBookingCancel(bookingUser, schedule, `${cancelReason}，次数已退还`);
          }
        } catch (notifyErr) {
        }
      }
    }
  }

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'cancel',
    module: 'schedule',
    target_id: id,
    detail: `取消排课: ${schedule.course_name || ''} ${schedule.date} ${schedule.start_time}, 影响预约: ${bookings.length}人`,
  });

  // 清理该课程的所有 PendingTask
  await PendingTask.deleteMany({ schedule_id: id });

  return schedule.toObject();
};

// 下架排课
exports.offlineSchedule = async (id, reason, operatorId) => {
  const schedule = await Schedule.findById(id).populate('coach_id', 'name').populate('store_id', 'name');
  if (!schedule) throw new Error('排课不存在');

  schedule.status = 'offline';
  schedule.cancel_type = 'admin_offline';
  schedule.cancel_reason = reason || '管理员下架课程';
  await schedule.save();

  // 自动退还所有已预约会员的课时
  const bookings = await Booking.find({
    schedule_id: id,
    status: 'booked',
  });

  const UserPackage = require('../models/UserPackage');
  for (const booking of bookings) {
    booking.status = 'cancelled';
    booking.cancel_type = 'admin_cancel';
    booking.cancel_time = new Date();
    booking.cancel_reason = reason || '管理员下架课程';
    booking.credits_refunded = booking.credits_deducted;
    await booking.save();

    // 恢复会员课时（优先归还到原套餐）
    if (booking.user_id) {
      const pkg = booking.user_package_id
        ? await UserPackage.findById(booking.user_package_id)
        : await UserPackage.findOne({ user_id: booking.user_id, store_id: schedule.store_id, status: 'active' });
      if (pkg) {
        pkg.remaining_credits += booking.credits_deducted;
        if (pkg.status === 'exhausted') pkg.status = 'active';
        await pkg.save();
        try {
          const wechatMessageService = require('./wechat-message.service');
          const User = require('../models/User');
          const bookingUser = await User.findById(booking.user_id);
          if (bookingUser && bookingUser.openid) {
            await wechatMessageService.sendBookingCancel(bookingUser, schedule, '管理员下架课程，次数已退还');
          }
        } catch (notifyErr) {
        }
      }
    }
  }

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'offline',
    module: 'schedule',
    target_id: id,
    detail: `下架排课: ${schedule.course_name || ''} ${schedule.date} ${schedule.start_time}, 原因: ${reason || '管理员下架课程'}, 影响预约: ${bookings.length}人`,
  });

  // 清理该课程的所有 PendingTask
  await PendingTask.deleteMany({ schedule_id: id });

  return schedule;
};

// 删除排课（软删除，仅对已取消/已下架/已完成状态生效）
// - 软删除改为 status = 'deleted'，不物理删除记录，保证 bookings 的 schedule_id 引用始终有效
// - 已取消 (cancelled)、已下架 (offline)、已完成 (completed) 均可删除
// - 删除时归档教练课时记录（不物理删除，保证薪酬统计不受影响）
exports.deleteSchedule = async (id, operatorId) => {
  const schedule = await Schedule.findById(id);
  if (!schedule) throw new Error('排课不存在');

  const deletableStatuses = [SCHEDULE_STATUS.CANCELLED, SCHEDULE_STATUS.OFFLINE, SCHEDULE_STATUS.COMPLETED];
  let isDeletable = deletableStatuses.includes(schedule.status);

  // 兜底：DB 状态仍是 available/full 但实际已因人数不足取消的排课
  if (!isDeletable) {
    const bookingDeadline = schedule.booking_deadline || 120;
    const startDateTime = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ);
    const deadlineTime = startDateTime.subtract(bookingDeadline, 'minute');
    if (dayjs().tz(BEIJING_TZ).isAfter(deadlineTime)) {
      const realtimeBookings = await Booking.countDocuments({
        schedule_id: id,
        status: 'booked'
      });
      const minBookings = schedule.min_bookings || 5;
      if (realtimeBookings < minBookings) {
        isDeletable = true;
      }
    }
  }

  if (!isDeletable) {
    throw new Error('只能删除已取消、已下架或已完成的排课');
  }

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'delete',
    module: 'schedule',
    target_id: id,
    detail: `删除排课: ${schedule.course_name || ''} ${schedule.date} ${schedule.start_time}-${schedule.end_time}`,
  });

  // 软删除：仅标记 status = 'deleted'，保留记录以维持 bookings 引用
  await Schedule.findByIdAndUpdate(id, { status: SCHEDULE_STATUS.DELETED });

  // 归档教练课时记录（不物理删除，保证薪酬统计不受影响）
  await coachAttendanceService.archiveCoachAttendance(id);

  // 清理该课程的所有 PendingTask
  await PendingTask.deleteMany({ schedule_id: id });

  // 将关联候补标记为过期（保留记录，供历史查询）
  await Waitlist.updateMany(
    { schedule_id: id, status: { $in: ['waiting', 'notified'] } },
    { $set: { status: 'expired' } }
  );

  return { success: true };
};

exports.batchDeleteSchedules = async (data, operatorId) => {
  const { store_id, start_date, end_date, scope } = data;

  if (!store_id) throw new Error('缺少门店ID');

  const filter = { store_id };

  if (scope === 'future') {
    const today = dayjs().format('YYYY-MM-DD');
    filter.date = { $gte: today };
  } else if (scope === 'range' && start_date && end_date) {
    filter.date = { $gte: start_date, $lte: end_date };
  } else if (start_date) {
    filter.date = { $gte: start_date };
  }

  filter.status = { $in: ['available', 'full', 'not_open'] };

  const schedulesToDelete = await Schedule.find(filter);
  let deletedCount = 0;
  let skippedCount = 0;

  for (const schedule of schedulesToDelete) {
    const bookingCount = await Booking.countDocuments({
      schedule_id: schedule._id,
      status: 'booked',
    });

    if (bookingCount > 0) {
      schedule.status = 'cancelled';
      await schedule.save();

      const bookings = await Booking.find({
        schedule_id: schedule._id,
        status: 'booked',
      });

      for (const booking of bookings) {
        if (booking.status === 'booked') {
          const UserPackage = require('../models/UserPackage');
          const userPackage = await UserPackage.findById(booking.user_package_id);
          if (userPackage) {
            userPackage.remaining_credits += schedule.credits_cost || 1;
            await userPackage.save();
          }
          booking.status = 'cancelled';
          booking.cancel_reason = '排课被批量删除';
          await booking.save();
        }
      }

      skippedCount++;
    } else {
      // 无有效预约 → 软删除，保留记录维持引用完整性
      await Schedule.findByIdAndUpdate(schedule._id, { status: 'deleted' });
      deletedCount++;
    }
  }

  await Waitlist.deleteMany({
    schedule_id: { $in: schedulesToDelete.map(s => s._id) },
  });

  // 清理所有受影响课程的 PendingTask
  await PendingTask.deleteMany({
    schedule_id: { $in: schedulesToDelete.map(s => s._id) }
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'batch_delete',
    module: 'schedule',
    target_id: null,
    detail: `批量删除排课: 门店${store_id}, 删除${deletedCount}节, 取消${skippedCount}节(有预约)`,
  });

  return {
    deleted_count: deletedCount,
    cancelled_count: skippedCount,
    total: schedulesToDelete.length,
  };
};

exports.batchCancelSchedules = async (data, operatorId) => {
  const { store_id, start_date, end_date } = data;

  if (!store_id) throw new Error('缺少门店ID');

  const filter = { store_id, status: { $in: ['available', 'full', 'not_open'] } };

  if (start_date) {
    filter.date = { $gte: start_date };
  }
  if (end_date) {
    if (filter.date && filter.date.$gte) {
      filter.date.$lte = end_date;
    } else {
      filter.date = { $lte: end_date };
    }
  }

  const schedulesToCancel = await Schedule.find(filter);
  let cancelledCount = 0;
  let failedCount = 0;

  for (const schedule of schedulesToCancel) {
    try {
      await exports.cancelSchedule(schedule._id, operatorId);
      cancelledCount++;
    } catch (err) {
      console.warn(`取消排课 ${schedule._id} 失败: ${err.message}`);
      failedCount++;
    }
  }

  await Waitlist.deleteMany({
    schedule_id: { $in: schedulesToCancel.map(s => s._id) },
  });

  // 清理所有受影响课程的 PendingTask
  await PendingTask.deleteMany({
    schedule_id: { $in: schedulesToCancel.map(s => s._id) }
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'batch_cancel',
    module: 'schedule',
    target_id: null,
    detail: `批量取消排课: 门店${store_id}, 共${cancelledCount}节`,
  });

  return {
    cancelled_count: cancelledCount,
  };
};

// 获取预约名单
exports.getScheduleBookings = async (scheduleId) => {
  const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
  if (!schedule) return [];

  const bookings = await Booking.find({
    schedule_id: scheduleId,
  })
    .populate('user_id', 'real_name nick_name avatar_url phone')
    .sort({ created_at: 1 });

  if (schedule.status === 'completed') {
    const attendanceService = require('./attendance.service');
    for (const booking of bookings) {
      if (booking.status === 'booked') {
        booking.status = 'completed';
        booking.checked_in = true;
        booking.check_in_time = booking.check_in_time || new Date();
        await booking.save();

        // 同步补建 Attendance 记录（修复漏建导致教练薪资统计偏低）
        try {
          await attendanceService.createAttendance({
            schedule_id: scheduleId,
            user_id: booking.user_id,
            booking_id: booking._id,
            store_id: schedule.store_id,
            coach_id: schedule.coach_id,
            dance_style_id: schedule.dance_style_id,
            check_in_time: booking.check_in_time || new Date(),
            source: 'booking',
            check_in_method: 'auto',
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
          console.error(`[getScheduleBookings] 补建attendance失败 userId=${booking.user_id}:`, attErr.message);
        }
      }
    }
  }

  return bookings;
};

// 标记上课(签到)
exports.markAttendance = async (scheduleId, userIds, operatorId) => {
  const schedule = await Schedule.findById(scheduleId).populate('coach_id', 'name').populate('store_id', 'name');
  const updates = [];
  const attendanceService = require('./attendance.service');
  for (const userId of userIds) {
    const booking = await Booking.findOneAndUpdate(
      {
        schedule_id: scheduleId,
        user_id: userId,
        status: 'booked',
      },
      {
        status: 'completed',
        checked_in: true,
        check_in_time: new Date(),
        checked_in_by: operatorId,
      },
      { new: true }
    );
    if (booking) {
      updates.push(booking);
      // 同步创建 Attendance 记录（修复漏建导致教练薪资统计偏低）
      if (schedule) {
        try {
          await attendanceService.createAttendance({
            schedule_id: scheduleId,
            user_id: userId,
            booking_id: booking._id,
            store_id: schedule.store_id,
            coach_id: schedule.coach_id,
            dance_style_id: schedule.dance_style_id,
            check_in_time: booking.check_in_time || new Date(),
            check_in_by: operatorId,
            source: 'admin',
            check_in_method: 'scan',
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
          console.error(`[markAttendance] 创建attendance失败 userId=${userId}:`, attErr.message);
        }
      }
    }
  }
  return updates;
};

// 获取周课程表
exports.getWeeklySchedule = async (storeId, startDate, endDate) => {
  const filter = {
    status: { $in: ['available', 'full'] },
  };
  if (storeId) filter.store_id = storeId;
  if (startDate && endDate) {
    filter.date = { $gte: startDate, $lte: endDate };
  } else if (startDate) {
    filter.date = startDate;
  }

  const list = await Schedule.find(filter)
    .populate('store_id', 'name')
    .populate('coach_id', 'name avatar_url')
    .populate('dance_style_id', 'name icon_url')
    .sort({ date: 1, start_time: 1 });

  // 按日期分组
  const grouped = {};
  for (const item of list) {
    if (!grouped[item.date]) {
      grouped[item.date] = [];
    }
    grouped[item.date].push(item);
  }

  return grouped;
};

// 复制周排课到未来数周/数月
exports.copyScheduleWeeks = async (data, operatorId) => {
  const {
    store_id,
    source_start_date,  // 源周起始日期 YYYY-MM-DD
    source_end_date,    // 源周结束日期 YYYY-MM-DD
    target_start_date,  // 目标周起始日期 YYYY-MM-DD
    copy_weeks = 1,     // 复制周数
    copy_months = 0,    // 复制月数（与copy_weeks二选一）
  } = data;

  if (!store_id || !source_start_date || !source_end_date || !target_start_date) {
    throw new Error('缺少必填参数(store_id, source_start_date, source_end_date, target_start_date)');
  }

  // 计算实际复制周数
  let totalWeeks = copy_weeks;
  if (copy_months > 0) {
    totalWeeks = copy_months * 4; // 简化：每月约4周
  }
  if (totalWeeks < 1) totalWeeks = 1;
  if (totalWeeks > 52) totalWeeks = 52; // 最多复制52周（1年）

  // 获取源周的排课
  const sourceSchedules = await Schedule.find({
    store_id,
    date: { $gte: source_start_date, $lte: source_end_date },
    status: { $in: ['available', 'full'] },
  }).sort({ date: 1, start_time: 1 });

  if (sourceSchedules.length === 0) {
    throw new Error('源周内没有可复制的排课');
  }

  // 计算源周和目标周的偏移天数
  const sourceStart = dayjs(source_start_date);
  const targetStart = dayjs(target_start_date);
  const dayOffset = targetStart.diff(sourceStart, 'day');

  let createdCount = 0;
  let skippedCount = 0;
  const errors = [];

  for (let week = 0; week < totalWeeks; week++) {
    const weekOffset = dayOffset + (week * 7);

    for (const source of sourceSchedules) {
      const newDate = dayjs(source.date).add(weekOffset, 'day').format('YYYY-MM-DD');

      // 跳过过去的日期
      if (dayjs(newDate).isBefore(dayjs(), 'day')) {
        skippedCount++;
        continue;
      }

      // 检查目标日期是否已有排课（同教练、同门店、同时间段）
      const existing = await Schedule.findOne({
        store_id,
        coach_id: source.coach_id,
        date: newDate,
        status: { $in: ['available', 'full'] },
        start_time: { $lt: source.end_time },
        end_time: { $gt: source.start_time },
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      // 检查跨门店教练冲突（1小时通勤缓冲）
      const CROSS_STORE_BUFFER = 60;
      const srcStartMin = timeToMinutes(source.start_time);
      const srcEndMin = timeToMinutes(source.end_time);

      const crossStoreExisting = await Schedule.find({
        coach_id: source.coach_id,
        date: newDate,
        store_id: { $ne: store_id },
        status: { $in: ['available', 'full'] },
      }).populate('store_id', 'name');

      let hasCrossStoreConflict = false;
      for (const cse of crossStoreExisting) {
        const existStartMin = timeToMinutes(cse.start_time);
        const existEndMin = timeToMinutes(cse.end_time);

        // 时间重叠
        if (srcStartMin < existEndMin && srcEndMin > existStartMin) {
          hasCrossStoreConflict = true;
          break;
        }
        // 新课在已有课程之后，缓冲不足
        if (srcStartMin >= existEndMin && srcStartMin < existEndMin + CROSS_STORE_BUFFER) {
          hasCrossStoreConflict = true;
          break;
        }
        // 新课在已有课程之前，缓冲不足
        if (srcEndMin <= existStartMin && srcEndMin + CROSS_STORE_BUFFER > existStartMin) {
          hasCrossStoreConflict = true;
          break;
        }
      }

      if (hasCrossStoreConflict) {
        skippedCount++;
        continue;
      }

      // 检查放假
      const Holiday = require('../models/Holiday');
      const holidayConflict = await Holiday.findOne({
        status: 'active',
        $and: [
          {
            $or: [
              { date: { $lte: newDate }, end_date: { $gte: newDate } },
              { date: newDate, end_date: { $exists: false } },
            ],
          },
          {
            $or: [
              { store_scope: 'all' },
              { store_scope: 'single', store_id: store_id },
            ],
          },
        ],
      });

      if (holidayConflict) {
        skippedCount++;
        continue;
      }

      try {
        const newSchedule = await Schedule.create({
          store_id,
          schedule_type: source.schedule_type,
          course_name: source.course_name,
          dance_style_id: source.dance_style_id,
          coach_id: source.coach_id,
          date: newDate,
          start_time: source.start_time,
          end_time: source.end_time,
          duration: source.duration,
          classroom: source.classroom,
          max_bookings: source.max_bookings,
          min_bookings: source.min_bookings,
          booking_deadline: source.booking_deadline,
          cancel_deadline: source.cancel_deadline,
          credits_cost: source.credits_cost,
          from_template: source.from_template === true,
          cover: source.cover || '',
          remark: source.remark ? `${source.remark} (复制)` : '复制排课',
          status: 'available',
          created_by: operatorId,
        });

        // 写 PendingTask：三个精准定时任务
        const copyDeadline = source.booking_deadline || 120;
        const copyCheckAt = dayjs.tz(newDate + ' ' + source.start_time, BEIJING_TZ).subtract(copyDeadline, 'minute').toDate();
        const copyStartAt = dayjs.tz(newDate + ' ' + source.start_time, BEIJING_TZ).toDate();
        const copyEndAt = dayjs.tz(newDate + ' ' + source.end_time, BEIJING_TZ).toDate();
        await PendingTask.insertMany([
          { schedule_id: newSchedule._id, trigger_at: copyCheckAt, type: 'min_bookings_check' },
          { schedule_id: newSchedule._id, trigger_at: copyStartAt,  type: 'auto_check_in' },
          { schedule_id: newSchedule._id, trigger_at: copyEndAt,    type: 'class_complete' },
        ]);

        createdCount++;
      } catch (err) {
        errors.push(`${newDate} ${source.start_time}: ${err.message}`);
      }
    }
  }

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'copy_schedule',
    module: 'schedule',
    target_id: null,
    detail: `复制周排课: ${source_start_date}~${source_end_date} → ${target_start_date}起, 共${totalWeeks}周, 成功${createdCount}节, 跳过${skippedCount}节`,
  });

  return {
    created_count: createdCount,
    skipped_count: skippedCount,
    total_weeks: totalWeeks,
    errors: errors.length > 0 ? errors : undefined,
  };
};

exports.batchCreateSchedules = async (schedules, operatorId) => {
  const results = { created: [], skipped: [] };

  for (const data of schedules) {
    try {
      const schedule = await exports.createSchedule(data, operatorId);
      results.created.push({
        course_name: schedule.course_name,
        date: schedule.date,
        start_time: schedule.start_time,
      });
    } catch (err) {
      results.skipped.push({
        course_name: (data.dance_style_id && data.dance_style_id.name) || data.course_name || '',
        date: data.date || '',
        start_time: data.start_time || '',
        reason: err.message,
      });
    }
  }

  return results;
};

// ============ 导出统一状态变更事件函数（供 scheduler.js 调用）============
exports.checkAndCancelIfInsufficient = checkAndCancelIfInsufficient;
exports.autoCheckInAtStart = autoCheckInAtStart;
exports.finalizeSchedule = finalizeSchedule;
exports.ensureFinalState = ensureFinalState;
