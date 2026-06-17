const Holiday = require('../models/Holiday');
const Schedule = require('../models/Schedule');
const UserPackage = require('../models/UserPackage');
const User = require('../models/User');
const Booking = require('../models/Booking');
const logService = require('./log.service');
const packageService = require('./package.service');
const wechatMessageService = require('./wechat-message.service');
const dayjs = require('dayjs');

// 计算放假天数
const calculateHolidayDays = (startDate, endDate) => {
  console.log('=== 计算放假天数 ===');
  console.log('原始参数 - startDate:', startDate, '类型:', typeof startDate);
  console.log('原始参数 - endDate:', endDate, '类型:', typeof endDate);
  
  if (!startDate) {
    console.log('startDate为空，返回0');
    return 0;
  }
  
  // 处理可能的 Date 对象或字符串
  const normalizeDate = (date) => {
    if (!date) return null;
    console.log('normalizeDate 处理:', date, '类型:', typeof date);
    
    if (date instanceof Date) {
      console.log('是 Date 对象');
      return dayjs(date);
    }
    
    // 处理字符串格式
    const strDate = String(date);
    console.log('转换为字符串:', strDate);
    
    // 如果是 ISO 格式的 Date 对象字符串，提取日期部分
    if (strDate.includes('T')) {
      const datePart = strDate.split('T')[0];
      console.log('提取日期部分:', datePart);
      return dayjs(datePart);
    }
    
    // 如果是 "YYYY-MM-DD" 格式
    if (/^\d{4}-\d{2}-\d{2}$/.test(strDate)) {
      console.log('是标准日期格式');
      return dayjs(strDate);
    }
    
    // 尝试直接解析
    const result = dayjs(strDate);
    console.log('直接解析结果:', result.isValid() ? '有效' : '无效');
    return result;
  };
  
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate) || start;
  
  console.log('解析后 - start:', start ? start.format('YYYY-MM-DD') : 'null', '有效:', start ? start.isValid() : 'N/A');
  console.log('解析后 - end:', end ? end.format('YYYY-MM-DD') : 'null', '有效:', end ? end.isValid() : 'N/A');
  
  if (!start || !start.isValid()) {
    console.log('start日期无效，返回0');
    return 0;
  }
  
  // 计算天数差（包含起止日期）
  const diff = end.diff(start, 'day') + 1;
  console.log('计算差值:', end.diff(start, 'day'), '+ 1 =', diff);
  
  const result = Math.max(1, diff);
  console.log('最终结果:', result);
  return result;
};

// 获取放假列表(支持store_scope/status筛选)
exports.getHolidays = async (query) => {
  const { store_scope, status, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (store_scope) filter.store_scope = store_scope;
  if (status) filter.status = status;

  const list = await Holiday.find(filter)
    .populate('store_id', 'name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  console.log('查询到的放假记录数量:', list.length);
  if (list.length > 0) {
    console.log('第一条记录数据:', JSON.stringify(list[0].toObject()));
  }

  // 计算每个放假记录的天数
  const listWithDays = list.map(holiday => {
    const holidayObj = holiday.toObject();
    console.log('处理假期记录:', holidayObj.name, 'date:', holidayObj.date, 'end_date:', holidayObj.end_date);
    console.log('store_scope:', holidayObj.store_scope, 'store_id:', holidayObj.store_id, 'store_id类型:', typeof holidayObj.store_id);
    // 使用 date 作为开始日期，end_date 作为结束日期
    holidayObj.daysCount = calculateHolidayDays(holidayObj.date, holidayObj.end_date);
    console.log('计算结果:', holidayObj.daysCount);
    // 统一返回 start_date 字段方便前端使用
    holidayObj.start_date = holidayObj.date;
    // 处理门店名称和 ID
    if (holidayObj.store_scope === 'single' && holidayObj.store_id) {
      // 检查 store_id 是对象还是字符串
      if (typeof holidayObj.store_id === 'object' && holidayObj.store_id.name) {
        holidayObj.storeNames = [holidayObj.store_id.name];
        holidayObj.store_id_str = holidayObj.store_id._id ? holidayObj.store_id._id.toString() : holidayObj.store_id.toString();
      } else {
        // store_id 是字符串，没有 populate 出名称
        holidayObj.storeNames = [];
        holidayObj.store_id_str = holidayObj.store_id.toString();
      }
      console.log('处理后的门店信息:', { storeNames: holidayObj.storeNames, store_id_str: holidayObj.store_id_str });
    } else if (holidayObj.store_scope === 'single') {
      holidayObj.storeNames = [];
    }
    return holidayObj;
  });

  console.log('处理后包含daysCount的第一条记录:', listWithDays[0]);

  const total = await Holiday.countDocuments(filter);
  return { list: listWithDays, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取放假详情
exports.getHolidayById = async (id) => {
  const holiday = await Holiday.findById(id).populate('store_id', 'name');
  if (!holiday) throw new Error('放假记录不存在');
  return holiday;
};

// 检查某日期是否为放假
exports.checkHoliday = async (date, storeId) => {
  const filter = {
    status: 'active',
    date: { $lte: date },
  };

  if (storeId) {
    filter.$or = [
      { store_scope: 'all' },
      { store_scope: 'single', store_id: storeId },
    ];
  }

  // 有end_date的放假记录，end_date需要 >= date
  const holidays = await Holiday.find(filter);

  for (const holiday of holidays) {
    if (!holiday.end_date || holiday.end_date >= date) {
      return holiday;
    }
  }

  return null;
};

// 取消放假期间已预约的课程
const cancelHolidayBookings = async (startDate, endDate, storeId, holidayId, operatorId) => {
  const scheduleFilter = {
    date: { $gte: startDate, $lte: endDate },
  };
  
  if (storeId) {
    scheduleFilter.store_id = storeId;
  }
  
  const scheduleIds = await Schedule.distinct('_id', scheduleFilter);
  
  const bookingFilter = {
    schedule_id: { $in: scheduleIds },
    status: 'booked'
  };

  const bookings = await Booking.find(bookingFilter);
  const cancelledBookings = [];

  for (const booking of bookings) {
    booking.status = 'cancelled';
    booking.cancel_type = 'holiday';
    booking.cancel_time = new Date();
    booking.cancel_reason = '放假调课';
    booking.credits_refunded = booking.credits_deducted;
    await booking.save();
    
    // 退款（仅次卡用户退还 remaining_credits）
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
    
    // 发送取消通知
    try {
      const user = await User.findById(booking.user_id);
      const schedule = await Schedule.findById(booking.schedule_id).populate('coach_id', 'name').populate('store_id', 'name');
      if (user && user.openid && schedule) {
        await wechatMessageService.sendBookingCancel(user, schedule, '因放假课程已取消');
      }
    } catch (err) {
      console.error('发送放假课程取消通知失败:', err);
    }
    
    cancelledBookings.push(booking);
  }
  
  // 更新排课人数
  for (const scheduleId of scheduleIds) {
    const cancelledCount = cancelledBookings.filter(b => b.schedule_id.toString() === scheduleId.toString()).length;
    if (cancelledCount > 0) {
      const schedule = await Schedule.findById(scheduleId);
      if (schedule) {
        schedule.current_bookings = Math.max(0, schedule.current_bookings - cancelledCount);
        if (schedule.status === 'full') {
          schedule.status = 'available';
        }
        await schedule.save();
      }
    }
  }

  // 通知候补用户（课程恢复可预约后有空位）
  const uniqueScheduleIds = [...new Set(cancelledBookings.map(b => b.schedule_id.toString()))];
  for (const scheduleId of uniqueScheduleIds) {
    try {
      const schedule = await Schedule.findById(scheduleId);
      if (schedule) {
        const bookingService = require('../services/booking.service');
        await bookingService.notifyWaitlistUsers(scheduleId);
      }
    } catch (err) {
      console.error('通知候补用户失败:', err);
    }
  }
  
  return cancelledBookings;
};

// 封禁放假期间的可预约排课
const blockSchedules = async (startDate, endDate, storeId) => {
  const filter = {
    status: { $in: ['available', 'full'] },
    date: { $gte: startDate, $lte: endDate },
  };

  if (storeId) {
    filter.store_id = storeId;
  }

  const result = await Schedule.updateMany(filter, { status: 'offline' });
  return result.modifiedCount;
};

// 解除封禁排课(将放假期间offline的排课恢复为available)
const unblockSchedules = async (startDate, endDate, storeId) => {
  const filter = {
    status: 'offline',
    date: { $gte: startDate, $lte: endDate },
  };

  if (storeId) {
    filter.store_id = storeId;
  }

  // 恢复为available(仅恢复当前预约人数为0的排课)
  const schedules = await Schedule.find(filter);
  let restoredCount = 0;
  for (const schedule of schedules) {
    if (schedule.current_bookings > 0) {
      schedule.status = 'full';
    } else {
      schedule.status = 'available';
    }
    await schedule.save();
    restoredCount++;
  }

  return restoredCount;
};

// 顺延对应门店正式会员的有效期，并记录PackageExtension
const extendMemberPackages = async (totalDays, storeId, holidayId, operatorId, operatorName) => {
  const filter = {
    user_type: 'member',
    member_status: 'official',
    status: 'active',
  };

  if (storeId) {
    filter.store_id = storeId;
  }

  const users = await User.find(filter);
  let extendedCount = 0;
  const extensionRecords = [];

  for (const user of users) {
    const activePackages = await UserPackage.find({
      user_id: user._id,
      status: 'active',
      end_date: { $ne: null },
    });

    for (const pkg of activePackages) {
      const originalExpireAt = new Date(pkg.end_date);
      pkg.end_date = dayjs(pkg.end_date).add(totalDays, 'day').toDate();
      pkg.extension_days = (pkg.extension_days || 0) + totalDays;
      if (pkg.is_suspended && pkg.suspend_end_date) {
        pkg.suspend_end_date = dayjs(pkg.suspend_end_date).add(totalDays, 'day').toDate();
      }
      await pkg.save();
      
      // 记录PackageExtension
      try {
        const extension = await packageService.extendPackage(
          pkg._id, 
          totalDays, 
          operatorId, 
          operatorName, 
          { 
            reason: '放假顺延', 
            holidayId, 
            storeId 
          }
        );
        extensionRecords.push(extension);
      } catch (err) {
        console.error('记录PackageExtension失败:', err);
      }
      
      extendedCount++;
    }
  }

  return { extendedCount, extensionRecords };
};

// 回滚有效期补偿，并记录PackageExtension
const rollbackMemberPackages = async (totalDays, storeId, holidayId, operatorId, operatorName) => {
  const filter = {
    user_type: 'member',
    member_status: 'official',
    status: 'active',
  };

  if (storeId) {
    filter.store_id = storeId;
  }

  const users = await User.find(filter);
  let rollbackCount = 0;

  for (const user of users) {
    const activePackages = await UserPackage.find({
      user_id: user._id,
      status: 'active',
      end_date: { $ne: null },
    });

    for (const pkg of activePackages) {
      const originalExpireAt = new Date(pkg.end_date);
      pkg.end_date = dayjs(pkg.end_date).subtract(totalDays, 'day').toDate();
      pkg.extension_days = Math.max(0, (pkg.extension_days || 0) - totalDays);
      if (pkg.is_suspended && pkg.suspend_end_date) {
        pkg.suspend_end_date = dayjs(pkg.suspend_end_date).subtract(totalDays, 'day').toDate();
      }
      await pkg.save();
      
      // 记录回滚操作
      try {
        await packageService.extendPackage(
          pkg._id, 
          -totalDays, 
          operatorId, 
          operatorName, 
          { 
            reason: '撤销放假顺延', 
            holidayId, 
            storeId 
          }
        );
      } catch (err) {
        console.error('记录PackageExtension回滚失败:', err);
      }
      
      rollbackCount++;
    }
  }

  return rollbackCount;
};

// 新增放假
exports.createHoliday = async (data, operatorId, operatorName) => {
  const { name, store_scope, store_id, start_date, end_date, type, description } = data;

  // 1. 参数校验
  if (!name) throw new Error('放假名称不能为空');
  if (!store_scope || !['all', 'single'].includes(store_scope)) {
    throw new Error('store_scope必须为all或single');
  }
  if (store_scope === 'single' && !store_id) {
    throw new Error('指定门店放假时必须提供store_id');
  }
  if (!start_date) throw new Error('开始日期不能为空');

  const finalEndDate = end_date || start_date;

  // 2. 自动计算天数 - 使用统一的计算函数
  const totalDays = calculateHolidayDays(start_date, finalEndDate);
  console.log('新增放假 - 计算天数:', start_date, '~', finalEndDate, '=', totalDays);
  
  // 3. 校验时间重叠冲突
  const overlapFilter = {
    status: 'active',
    $or: [
      // 新放假的start_date落在已有放假的范围内
      { date: { $lte: start_date }, end_date: { $gte: start_date } },
      // 新放假的end_date落在已有放假的范围内
      { date: { $lte: finalEndDate }, end_date: { $gte: finalEndDate } },
      // 新放假完全包含已有放假
      { date: { $gte: start_date }, end_date: { $lte: finalEndDate } },
      // 已有放假没有end_date(单日放假)，且日期在新放假范围内
      { date: { $gte: start_date, $lte: finalEndDate }, end_date: { $exists: false } },
    ],
  };

  if (store_scope === 'single' && store_id) {
    overlapFilter.$and = [
      {
        $or: [
          { store_scope: 'all' },
          { store_scope: 'single', store_id: store_id },
        ],
      },
    ];
  } else {
    overlapFilter.store_scope = 'all';
  }

  const overlap = await Holiday.findOne(overlapFilter);
  if (overlap) {
    throw new Error(`与已有放假安排"${overlap.name}"(${overlap.date}~${overlap.end_date || overlap.date})存在时间冲突`);
  }

  // 4. 创建放假记录
  const holiday = await Holiday.create({
    name,
    date: start_date,
    end_date: finalEndDate,
    store_scope,
    store_id: store_scope === 'single' ? store_id : undefined,
    type: type || 'holiday',
    description: description || '',
    status: 'active',
  });

  // 5. 取消放假期间已预约的课程
  const cancelledBookings = await cancelHolidayBookings(
    start_date, 
    finalEndDate, 
    store_scope === 'single' ? store_id : undefined,
    holiday._id,
    operatorId
  );

  // 6. 封禁对应门店的课程
  const blockedCount = await blockSchedules(start_date, finalEndDate, store_scope === 'single' ? store_id : undefined);

  // 7. 顺延对应门店正式会员的有效期，并记录PackageExtension
  const extendResult = await extendMemberPackages(
    totalDays, 
    store_scope === 'single' ? store_id : undefined,
    holiday._id,
    operatorId,
    operatorName
  );

  // 8. 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'create',
    module: 'holiday',
    target_id: holiday._id,
    detail: `新增放假: ${name}, ${start_date}~${finalEndDate}, 共${totalDays}天, 取消${cancelledBookings.length}个预约, 封禁${blockedCount}节课, 顺延${extendResult.extendedCount}个会员套餐`,
  });

  return {
    holiday,
    cancelled_bookings: cancelledBookings,
    blocked_schedules: blockedCount,
    extended_packages: extendResult.extendedCount,
    extension_records: extendResult.extensionRecords,
    total_days: totalDays,
  };
};

// 编辑放假
exports.updateHoliday = async (id, data, operatorId, operatorName) => {
  const holiday = await Holiday.findById(id);
  if (!holiday) throw new Error('放假记录不存在');
  if (holiday.status !== 'active') throw new Error('仅active状态的放假记录可编辑');

  const { name, store_scope, store_id, start_date, end_date, type, description } = data;

  // 1. 校验时间重叠冲突（排除当前记录，必须在回滚之前检测）
  const newDate = start_date !== undefined ? start_date : holiday.date;
  const newEndDate = end_date !== undefined ? end_date : (holiday.end_date || holiday.date);
  const finalNewEndDate = newEndDate || newDate;
  const overlapFilter = {
    _id: { $ne: id },
    status: 'active',
    $or: [
      { date: { $lte: newDate }, end_date: { $gte: newDate } },
      { date: { $lte: finalNewEndDate }, end_date: { $gte: finalNewEndDate } },
      { date: { $gte: newDate, $lte: finalNewEndDate } },
      { date: { $gte: newDate, $lte: finalNewEndDate }, end_date: { $exists: false } },
    ],
  };

  const newStoreScope = store_scope !== undefined ? store_scope : holiday.store_scope;
  const newStoreId = store_id !== undefined ? store_id : holiday.store_id;

  if (newStoreScope === 'single' && newStoreId) {
    overlapFilter.$and = [
      {
        $or: [
          { store_scope: 'all' },
          { store_scope: 'single', store_id: newStoreId },
        ],
      },
    ];
  } else {
    overlapFilter.store_scope = 'all';
  }

  const overlap = await Holiday.findOne(overlapFilter);
  if (overlap) {
    throw new Error(`与已有放假安排"${overlap.name}"(${overlap.date}~${overlap.end_date || overlap.date})存在时间冲突`);
  }

  // 2. 先回滚原有有效期补偿
  const oldEndDate = holiday.end_date || holiday.date;
  const oldTotalDays = calculateHolidayDays(holiday.date, oldEndDate);
  console.log('编辑放假 - 原有天数:', holiday.date, '~', oldEndDate, '=', oldTotalDays);
  const oldStoreId = holiday.store_scope === 'single' ? holiday.store_id : undefined;
  await rollbackMemberPackages(oldTotalDays, oldStoreId, holiday._id, operatorId, operatorName);

  // 3. 解除原有课程封禁
  await unblockSchedules(holiday.date, oldEndDate, oldStoreId);

  // 4. 更新放假信息
  if (name !== undefined) holiday.name = name;
  if (store_scope !== undefined) holiday.store_scope = store_scope;
  if (store_id !== undefined) holiday.store_id = store_id;
  if (start_date !== undefined) holiday.date = start_date;
  if (end_date !== undefined) holiday.end_date = end_date;
  if (type !== undefined) holiday.type = type;
  if (description !== undefined) holiday.description = description;

  // 确保store_scope和store_id的一致性
  if (holiday.store_scope === 'single' && !holiday.store_id) {
    throw new Error('指定门店放假时必须提供store_id');
  }

  const finalEndDate = holiday.end_date || holiday.date;
  const newTotalDays = calculateHolidayDays(holiday.date, finalEndDate);
  console.log('编辑放假 - 新天数:', holiday.date, '~', finalEndDate, '=', newTotalDays);
  // newStoreId 已在前面重叠检测中声明，直接复用已有的
  const finalNewStoreId = holiday.store_scope === 'single' ? holiday.store_id : undefined;

  await holiday.save();

  // 5. 取消新放假期间已预约的课程
  const cancelledBookings = await cancelHolidayBookings(
    holiday.date, 
    finalEndDate, 
    finalNewStoreId,
    holiday._id,
    operatorId
  );

  // 6. 重新封禁课程
  const blockedCount = await blockSchedules(holiday.date, finalEndDate, finalNewStoreId);

  // 7. 重新顺延有效期，并记录PackageExtension
  const extendResult = await extendMemberPackages(
    newTotalDays, 
    finalNewStoreId,
    holiday._id,
    operatorId,
    operatorName
  );

  // 7. 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'update',
    module: 'holiday',
    target_id: holiday._id,
    detail: `编辑放假: ${holiday.name}, ${holiday.date}~${finalEndDate}, 共${newTotalDays}天, 取消${cancelledBookings.length}个预约, 封禁${blockedCount}节课, 顺延${extendResult.extendedCount}个会员套餐`,
  });

  return {
    holiday,
    cancelled_bookings: cancelledBookings,
    blocked_schedules: blockedCount,
    extended_packages: extendResult.extendedCount,
    extension_records: extendResult.extensionRecords,
    total_days: newTotalDays,
  };
};

// 撤销放假
exports.cancelHoliday = async (id, operatorId, operatorName) => {
  const holiday = await Holiday.findById(id);
  if (!holiday) throw new Error('放假记录不存在');
  if (holiday.status !== 'active') throw new Error('仅active状态的放假记录可撤销');

  const endDate = holiday.end_date || holiday.date;
  const totalDays = calculateHolidayDays(holiday.date, endDate);
  console.log('撤销放假 - 天数:', holiday.date, '~', endDate, '=', totalDays);
  const storeId = holiday.store_scope === 'single' ? holiday.store_id : undefined;

  // 1. 回滚有效期补偿，并记录PackageExtension
  const rollbackCount = await rollbackMemberPackages(
    totalDays, 
    storeId, 
    holiday._id, 
    operatorId, 
    operatorName
  );

  // 2. 解除课程封禁
  const unblockedCount = await unblockSchedules(holiday.date, endDate, storeId);

  // 3. 通知被取消预约的会员可重新预约
  try {
    const scheduleFilter = { date: { $gte: holiday.date, $lte: endDate } };
    if (storeId) scheduleFilter.store_id = storeId;
    const restoredScheduleIds = await Schedule.distinct('_id', scheduleFilter);
    if (restoredScheduleIds.length > 0) {
      const cancelledBookings = await Booking.find({
        schedule_id: { $in: restoredScheduleIds },
        cancel_type: 'holiday',
        status: 'cancelled',
      }).populate('user_id', 'openid nick_name');
      const notifiedUsers = new Set();
      for (const booking of cancelledBookings) {
        if (booking.user_id && booking.user_id.openid && !notifiedUsers.has(booking.user_id._id.toString())) {
          notifiedUsers.add(booking.user_id._id.toString());
          try {
            const schedule = await Schedule.findById(booking.schedule_id).populate('coach_id', 'name').populate('store_id', 'name');
            if (schedule) {
              await wechatMessageService.sendBookingCancel(booking.user_id, schedule, '放假已撤销，课程已恢复，可重新预约');
            }
          } catch (notifyErr) {
            console.error('发送放假撤销通知失败:', notifyErr);
          }
        }
      }
    }
  } catch (err) {
    console.error('通知放假撤销用户失败:', err);
  }

  // 4. 更新状态为cancelled
  holiday.status = 'cancelled';
  await holiday.save();

  // 4. 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'cancel',
    module: 'holiday',
    target_id: holiday._id,
    detail: `撤销放假: ${holiday.name}, 回滚${rollbackCount}个会员套餐, 解封${unblockedCount}节课`,
  });

  return {
    holiday,
    rollback_packages: rollbackCount,
    unblocked_schedules: unblockedCount,
  };
};

// 删除放假(仅已撤销/已结束的)
exports.deleteHoliday = async (id, operatorId, operatorName) => {
  const holiday = await Holiday.findById(id);
  if (!holiday) throw new Error('放假记录不存在');

  if (holiday.status === 'active') {
    throw new Error('active状态的放假记录不可删除，请先撤销');
  }

  await Holiday.findByIdAndDelete(id);

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'delete',
    module: 'holiday',
    target_id: id,
    detail: `删除放假记录: ${holiday.name}`,
  });

  return { success: true };
};
