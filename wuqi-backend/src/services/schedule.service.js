const Schedule = require('../models/Schedule');
const Booking = require('../models/Booking');
const Holiday = require('../models/Holiday');
const Coach = require('../models/Coach');
const Store = require('../models/Store');
const DanceStyle = require('../models/DanceStyle');
const Waitlist = require('../models/Waitlist');
const logService = require('./log.service');
const dayjs = require('dayjs');

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 获取排课列表(会员端/管理端)
exports.getScheduleList = async (query) => {
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
  } else if (!status) {
    filter.status = { $in: ['available', 'full'] };
    if (!date && !start_date) {
      const today = dayjs().format('YYYY-MM-DD');
      filter.date = filter.date || {};
      filter.date.$gte = today;
    }
  }

  const effectiveLimit = limit ? Number(limit) : Number(pageSize);

  const list = await Schedule.find(filter)
    .populate('store_id', 'name address')
    .populate('coach_id', 'name avatar_url')
    .populate('dance_style_id', 'name icon_url')
    .sort({ date: 1, start_time: 1 })
    .skip(limit ? 0 : (page - 1) * effectiveLimit)
    .limit(effectiveLimit);

  const total = await Schedule.countDocuments(filter);

  if (list.length > 0) {
    const scheduleIds = list.map(s => s._id);
    const bookings = await Booking.find({
      schedule_id: { $in: scheduleIds },
      $or: [{ status: 'booked' }, { booking_status: 'booked' }]
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

    for (const schedule of list) {
      const sid = String(schedule._id);
      schedule._doc = schedule._doc || schedule;
      schedule._doc.booked_users = bookingsBySchedule[sid] || [];
      schedule._doc.current_bookings = bookingCountBySchedule[sid] || 0;
    }
  }

  return { list, total, page: Number(page), pageSize: effectiveLimit };
};

// 获取排课详情
exports.getScheduleById = async (id) => {
  const schedule = await Schedule.findById(id)
    .populate('store_id', 'name address')
    .populate('coach_id', 'name avatar_url dance_styles')
    .populate('dance_style_id', 'name icon_url');
  if (!schedule) {
    throw new Error('排课不存在');
  }
  return schedule;
};

// 新增排课 - 核心业务逻辑
exports.createSchedule = async (data, operatorId) => {
  const {
    store_id, schedule_type, course_name, dance_style_id, coach_id,
    date, start_time, end_time, duration, classroom, max_bookings, min_bookings,
    booking_deadline, cancel_deadline, credits_cost, remark, cycle_config, from_template,
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
  if (sameStoreConflict) {
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
    if (classroomConflict) {
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

  return schedule;
};

// 编辑排课
exports.updateSchedule = async (id, data, operatorId) => {
  const schedule = await Schedule.findById(id);
  if (!schedule) throw new Error('排课不存在');

  // 检查是否已有预约
  const bookingCount = await Booking.countDocuments({
    schedule_id: id,
    $or: [{ status: 'booked' }, { booking_status: 'booked' }],
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
    const now = dayjs();
    const scheduleStart = dayjs(schedule.date + ' ' + schedule.start_time);
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
      if (sameStoreConflict) {
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
        if (classroomConflict) {
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

  return schedule;
};

// 取消排课（将状态改为 cancelled，退还已预约会员课时）
exports.cancelSchedule = async (id, operatorId, reason = '') => {
  const schedule = await Schedule.findById(id);
  if (!schedule) throw new Error('排课不存在');
  if (schedule.status === 'cancelled') throw new Error('该排课已取消');

  const cancelReason = reason || '管理员取消排课';

  schedule.status = 'cancelled';
  schedule.cancel_type = 'admin_cancel';
  schedule.cancel_reason = cancelReason;
  await schedule.save();

  // 自动退还所有已预约会员的课时
  const bookings = await Booking.find({
    schedule_id: id,
    $or: [{ status: 'booked' }, { booking_status: 'booked' }],
  });

  const UserPackage = require('../models/UserPackage');
  for (const booking of bookings) {
    booking.status = 'cancelled';
    booking.booking_status = 'cancelled';
    booking.cancel_type = 'admin_cancel';
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

  return schedule.toObject();
};

// 下架排课
exports.offlineSchedule = async (id, reason, operatorId) => {
  const schedule = await Schedule.findById(id);
  if (!schedule) throw new Error('排课不存在');

  schedule.status = 'offline';
  schedule.cancel_type = 'admin_offline';
  schedule.cancel_reason = reason || '管理员下架课程';
  await schedule.save();

  // 自动退还所有已预约会员的课时
  const bookings = await Booking.find({
    schedule_id: id,
    $or: [{ status: 'booked' }, { booking_status: 'booked' }],
  });

  const UserPackage = require('../models/UserPackage');
  for (const booking of bookings) {
    booking.status = 'cancelled';
    booking.booking_status = 'cancelled';
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

  return schedule;
};

// 删除排课(仅未开始且无预约)
exports.deleteSchedule = async (id, operatorId) => {
  const schedule = await Schedule.findById(id);
  if (!schedule) throw new Error('排课不存在');

  const bookingCount = await Booking.countDocuments({ schedule_id: id });
  if (bookingCount > 0) throw new Error('已有预约记录的排课不可删除，请使用下架功能');

  const now = dayjs();
  const scheduleStart = dayjs(schedule.date + ' ' + schedule.start_time);
  if (now.isAfter(scheduleStart)) throw new Error('已开始或已结束的排课不可删除');

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'delete',
    module: 'schedule',
    target_id: id,
    detail: `删除排课: ${schedule.course_name || ''} ${schedule.date} ${schedule.start_time}-${schedule.end_time}`,
  });

  await Schedule.findByIdAndDelete(id);
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
      $or: [{ status: 'booked' }, { booking_status: 'booked' }],
    });

    if (bookingCount > 0) {
      schedule.status = 'cancelled';
      await schedule.save();

      const bookings = await Booking.find({
        schedule_id: schedule._id,
        $or: [{ status: 'booked' }, { booking_status: 'booked' }],
      });

      for (const booking of bookings) {
        if (booking.booking_status === 'booked' || booking.status === 'booked') {
          const UserPackage = require('../models/UserPackage');
          const userPackage = await UserPackage.findById(booking.user_package_id);
          if (userPackage) {
            userPackage.remaining_credits += schedule.credits_cost || 1;
            await userPackage.save();
          }
          booking.booking_status = 'cancelled';
          booking.status = 'cancelled';
          booking.cancel_reason = '排课被批量删除';
          await booking.save();
        }
      }

      skippedCount++;
    } else {
      await Schedule.findByIdAndDelete(schedule._id);
      deletedCount++;
    }
  }

  await Waitlist.deleteMany({
    schedule_id: { $in: schedulesToDelete.map(s => s._id) },
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

  for (const schedule of schedulesToCancel) {
    // 调用单个取消的逻辑
    await exports.cancelSchedule(schedule._id, operatorId);
    cancelledCount++;
  }

  await Waitlist.deleteMany({
    schedule_id: { $in: schedulesToCancel.map(s => s._id) },
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
  const bookings = await Booking.find({
    schedule_id: scheduleId,
  })
    .populate('user_id', 'real_name nick_name avatar_url phone')
    .sort({ created_at: 1 });
  return bookings;
};

// 标记上课(签到)
exports.markAttendance = async (scheduleId, userIds, operatorId) => {
  const updates = [];
  for (const userId of userIds) {
    const booking = await Booking.findOneAndUpdate(
      {
        schedule_id: scheduleId,
        user_id: userId,
        $or: [{ status: 'booked' }, { booking_status: 'booked' }],
      },
      {
        status: 'completed',
        booking_status: 'completed',
        checked_in: true,
        check_in_time: new Date(),
        checked_in_by: operatorId,
      },
      { new: true }
    );
    if (booking) updates.push(booking);
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
        await Schedule.create({
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
          remark: source.remark ? `${source.remark} (复制)` : '复制排课',
          status: 'available',
          created_by: operatorId,
        });
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
