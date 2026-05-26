const CoachSalary = require('../models/CoachSalary');
const CoachSalaryStat = require('../models/CoachSalaryStat');
const Coach = require('../models/Coach');
const Schedule = require('../models/Schedule');
const Booking = require('../models/Booking');
const User = require('../models/User');
const logService = require('./log.service');

// 获取教练薪酬配置列表
exports.getCoachSalaryList = async (query) => {
  const { coach_id, store_id, is_active, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (coach_id) filter.coach_id = coach_id;
  if (store_id) {
    filter.$or = [{ store_id: store_id }, { store_id: null }];
  }
  if (is_active !== undefined) filter.is_active = is_active === 'true';

  const list = await CoachSalary.find(filter)
    .populate('coach_id', 'name')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await CoachSalary.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取教练薪酬配置详情
exports.getCoachSalaryById = async (id) => {
  const salary = await CoachSalary.findById(id)
    .populate('coach_id', 'name')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name');
  if (!salary) throw new Error('薪酬配置不存在');
  return salary;
};

// 创建教练薪酬配置
exports.createCoachSalary = async (data, operatorId) => {
  try {
    console.log('[createCoachSalary] 开始创建薪酬配置');
    console.log('[createCoachSalary] 输入数据:', data);
    console.log('[createCoachSalary] operatorId:', operatorId);

    const { coach_id, store_id, duration, salary_rate, effective_from, remark } = data;

    // 验证必填字段
    if (!coach_id) throw new Error('教练ID不能为空');
    if (!duration || duration <= 0) throw new Error('课程时长必须大于0');
    if (salary_rate === undefined || salary_rate < 0) throw new Error('薪酬标准不能为负数');

    console.log('[createCoachSalary] 验证通过，开始检查教练是否存在');

    // 检查教练是否存在
    const coach = await Coach.findById(coach_id);
    if (!coach) throw new Error('教练不存在');

    console.log('[createCoachSalary] 教练存在:', coach.name);

    // 检查是否已存在相同配置
    const existing = await CoachSalary.findOne({
      coach_id,
      duration,
      is_active: true
    });
    if (existing) throw new Error('已存在相同时长的薪酬配置');

    console.log('[createCoachSalary] 没有重复配置，准备创建');

    // 获取操作者信息
    let operatorName = '系统';
    try {
      const operator = await User.findById(operatorId);
      if (operator) {
        operatorName = operator.nick_name || operator.username || '未知';
      }
    } catch (err) {
      console.warn('[createCoachSalary] 获取操作者信息失败:', err.message);
    }

    console.log('[createCoachSalary] 操作者:', operatorName);

    const salaryData = {
      coach_id,
      store_id: store_id || null,
      duration: Number(duration),
      salary_rate: Number(salary_rate),
      effective_from: effective_from ? new Date(effective_from) : new Date(),
      remark,
      created_by: operatorId
    };

    console.log('[createCoachSalary] 准备创建的数据:', salaryData);

    // 创建薪酬配置
    const salary = await CoachSalary.create(salaryData);
    console.log('[createCoachSalary] 创建成功，ID:', salary._id);

    // 记录操作日志 - 即使失败也不要影响主流程
    try {
      await logService.createLog({
        operator_id: operatorId,
        operator_name: operatorName,
        action: 'create',
        module: 'coach_salary',
        target_id: salary._id,
        detail: `创建教练薪酬配置: ${coach.name}, 时长${duration}分钟, 标准${salary_rate}元/节`
      });
      console.log('[createCoachSalary] 操作日志记录成功');
    } catch (logErr) {
      console.error('[createCoachSalary] 记录操作日志失败:', logErr.message);
    }

    // 重新查询以获取populated数据
    console.log('[createCoachSalary] 重新查询populated数据');
    const newSalary = await CoachSalary.findById(salary._id)
      .populate('coach_id', 'name')
      .populate('store_id', 'name');

    console.log('[createCoachSalary] 完成');
    return newSalary;
  } catch (err) {
    console.error('[createCoachSalary] 创建失败:', err);
    console.error('[createCoachSalary] 错误堆栈:', err.stack);
    throw err;
  }
};

// 更新教练薪酬配置
exports.updateCoachSalary = async (id, data, operatorId) => {
  const salary = await CoachSalary.findById(id);
  if (!salary) throw new Error('薪酬配置不存在');

  const operator = await User.findById(operatorId);
  const operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';

  const allowedFields = ['salary_rate', 'effective_from', 'effective_to', 'is_active', 'remark'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      if (key === 'salary_rate') {
        salary[key] = Number(data[key]);
      } else {
        salary[key] = data[key];
      }
    }
  }

  await salary.save();

  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'update',
    module: 'coach_salary',
    target_id: salary._id,
    detail: '更新教练薪酬配置'
  });

  const updatedSalary = await CoachSalary.findById(id)
    .populate('coach_id', 'name')
    .populate('store_id', 'name');

  return updatedSalary;
};

// 删除教练薪酬配置
exports.deleteCoachSalary = async (id, operatorId) => {
  const salary = await CoachSalary.findById(id);
  if (!salary) throw new Error('薪酬配置不存在');

  const operator = await User.findById(operatorId);
  const operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';

  salary.is_active = false;
  salary.effective_to = new Date();
  await salary.save();

  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'delete',
    module: 'coach_salary',
    target_id: id,
    detail: '删除教练薪酬配置'
  });

  return { success: true };
};

// 获取教练薪酬统计列表
exports.getCoachSalaryStats = async (query) => {
  const { coach_id, store_id, status, start_date, end_date, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (coach_id) filter.coach_id = coach_id;
  if (store_id) filter.store_id = store_id;
  if (status) filter.status = status;
  if (start_date || end_date) {
    filter.class_date = {};
    if (start_date) filter.class_date.$gte = new Date(start_date);
    if (end_date) filter.class_date.$lte = new Date(end_date);
  }

  const list = await CoachSalaryStat.find(filter)
    .populate('coach_id', 'name')
    .populate('store_id', 'name')
    .populate('schedule_id', 'course_name date start_time end_time')
    .populate('booking_id', 'user_id')
    .populate('settled_by', 'nick_name')
    .sort({ class_date: -1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await CoachSalaryStat.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 生成教练薪酬统计（签到后调用）
exports.createSalaryStat = async (scheduleId, operatorId) => {
  const schedule = await Schedule.findById(scheduleId);
  if (!schedule) throw new Error('排课不存在');

  const attendanceCount = await Booking.countDocuments({
    schedule_id: scheduleId,
    $or: [{ status: 'completed' }, { booking_status: 'completed' }]
  });

  const duration = schedule.duration || 75;

  // 优先查找没有门店限制的配置（共用教练），按时长精确匹配
  let salary = await CoachSalary.findOne({
    coach_id: schedule.coach_id,
    store_id: null,
    duration: duration,
    is_active: true
  }).sort({ effective_from: -1 });

  if (!salary) {
    // 查找该教练任意时长的通用配置
    salary = await CoachSalary.findOne({
      coach_id: schedule.coach_id,
      store_id: null,
      is_active: true
    }).sort({ effective_from: -1 });
  }

  if (!salary) {
    // 如果没有通用配置，再查找有门店限制的配置
    salary = await CoachSalary.findOne({
      coach_id: schedule.coach_id,
      store_id: schedule.store_id,
      duration: duration,
      is_active: true
    }).sort({ effective_from: -1 });
  }

  if (!salary) {
    // 查找该门店任意时长的配置
    salary = await CoachSalary.findOne({
      coach_id: schedule.coach_id,
      store_id: schedule.store_id,
      is_active: true
    }).sort({ effective_from: -1 });
  }

  if (!salary) throw new Error('未找到教练薪酬配置');

  const totalSalary = salary.salary_rate;

  let operatorName = '系统';
  if (operatorId) {
    const operator = await User.findById(operatorId);
    operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';
  }

  const stat = await CoachSalaryStat.create({
    coach_id: schedule.coach_id,
    store_id: schedule.store_id,
    booking_id: null,
    schedule_id: scheduleId,
    class_date: new Date(schedule.date),
    duration,
    attendance_count: attendanceCount,
    salary_rate: salary.salary_rate,
    total_salary: totalSalary,
    status: 'pending',
    remark: `自动生成于 ${new Date().toISOString()}`
  });

  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'create',
    module: 'coach_salary_stat',
    target_id: stat._id,
    detail: `生成教练薪酬统计: ${schedule.course_name}, 薪酬${totalSalary}元`
  });

  return stat;
};

// 结算薪酬
exports.settleSalary = async (id, operatorId, remark = '') => {
  const stat = await CoachSalaryStat.findById(id);
  if (!stat) throw new Error('薪酬统计不存在');
  if (stat.status !== 'pending') throw new Error('该薪酬记录已结算或已取消');

  const operator = await User.findById(operatorId);
  const operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';

  stat.status = 'settled';
  stat.settled_at = new Date();
  stat.settled_by = operatorId;
  if (remark) stat.remark = remark;
  await stat.save();

  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'settle',
    module: 'coach_salary_stat',
    target_id: id,
    detail: `结算教练薪酬: ${stat.total_salary}元`
  });

  return stat;
};

// 取消薪酬统计
exports.cancelSalaryStat = async (id, operatorId, reason = '') => {
  const stat = await CoachSalaryStat.findById(id);
  if (!stat) throw new Error('薪酬统计不存在');
  if (stat.status === 'settled') throw new Error('已结算的薪酬记录不能取消');

  const operator = await User.findById(operatorId);
  const operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';

  stat.status = 'cancelled';
  if (reason) stat.remark = reason;
  await stat.save();

  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'cancel',
    module: 'coach_salary_stat',
    target_id: id,
    detail: `取消教练薪酬统计, 原因: ${reason || '未说明'}`
  });

  return stat;
};

// 获取薪酬汇总数据
exports.getSalarySummary = async (query) => {
  const { coach_id, store_id, start_date, end_date } = query;

  const settledFilter = { status: 'settled' };
  if (coach_id) settledFilter.coach_id = coach_id;
  if (store_id) settledFilter.store_id = store_id;
  if (start_date || end_date) {
    settledFilter.class_date = {};
    if (start_date) settledFilter.class_date.$gte = new Date(start_date);
    if (end_date) settledFilter.class_date.$lte = new Date(end_date);
  }

  const pendingFilter = { status: 'pending' };
  if (coach_id) pendingFilter.coach_id = coach_id;
  if (store_id) pendingFilter.store_id = store_id;

  const settledStats = await CoachSalaryStat.find(settledFilter);
  const pendingCount = await CoachSalaryStat.countDocuments(pendingFilter);

  const totalAmount = settledStats.reduce((sum, s) => sum + s.total_salary, 0);
  const totalClasses = settledStats.length;
  const totalAttendance = settledStats.reduce((sum, s) => sum + s.attendance_count, 0);

  return {
    total_amount: totalAmount,
    total_classes: totalClasses,
    total_attendance: totalAttendance,
    pending_count: pendingCount,
    average_attendance: totalClasses > 0 ? Math.round(totalAttendance / totalClasses) : 0
  };
};

// 批量生成薪酬统计账单
exports.generateSalaryBill = async (startDate, endDate, preview = false, operatorId = null) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const schedules = await Schedule.find({
    date: {
      $gte: start,
      $lte: end
    },
    status: 'completed',
    coach_id: { $ne: null }
  }).populate('coach_id', 'name');

  if (schedules.length === 0) {
    return { bill: [], settled_warning: '', total_amount: 0 };
  }

  const coachStats = {};
  
  for (const schedule of schedules) {
    const coachId = schedule.coach_id._id.toString();
    const coachName = schedule.coach_id.name || '未知教练';
    const duration = schedule.duration || 75;
    
    if (!coachStats[coachId]) {
      coachStats[coachId] = { coach_id: coachId, coach_name: coachName, items: {} };
    }
    
    if (!coachStats[coachId].items[duration]) {
      coachStats[coachId].items[duration] = { duration, count: 0, schedule_ids: [] };
    }
    
    coachStats[coachId].items[duration].count++;
    coachStats[coachId].items[duration].schedule_ids.push(schedule._id.toString());
  }

  const allScheduleIds = [];
  Object.values(coachStats).forEach(coach => {
    Object.values(coach.items).forEach(item => {
      allScheduleIds.push(...item.schedule_ids);
    });
  });

  const settledCount = await CoachSalaryStat.countDocuments({
    schedule_id: { $in: allScheduleIds },
    status: 'settled'
  });

  let settledWarning = '';
  if (settledCount > 0) {
    settledWarning = `检测到 ${settledCount} 个课程已结算，再次生成将重复结算这些课程。`;
  }

  const bill = [];
  let totalAmount = 0;

  for (const [coachId, stats] of Object.entries(coachStats)) {
    const coachBill = { coach_id: coachId, coach_name: stats.coach_name, items: [] };

    for (const [duration, item] of Object.entries(stats.items)) {
      let salary = await CoachSalary.findOne({
        coach_id: coachId,
        store_id: null,
        duration: parseInt(duration),
        is_active: true
      }).sort({ effective_from: -1 });

      if (!salary) {
        salary = await CoachSalary.findOne({
          coach_id: coachId,
          duration: parseInt(duration),
          is_active: true
        }).sort({ effective_from: -1 });
      }

      const rate = salary ? salary.salary_rate : 0;
      const amount = rate * item.count;
      totalAmount += amount;

      coachBill.items.push({
        duration: parseInt(duration),
        count: item.count,
        rate,
        amount,
        schedule_ids: item.schedule_ids
      });
    }

    coachBill.total_amount = coachBill.items.reduce((sum, i) => sum + i.amount, 0);
    bill.push(coachBill);
  }

  if (!preview && operatorId) {
    const operator = await User.findById(operatorId);
    const operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';

    for (const coachBill of bill) {
      for (const item of coachBill.items) {
        for (const scheduleId of item.schedule_ids) {
          const existingStat = await CoachSalaryStat.findOne({
            schedule_id: scheduleId,
            status: { $in: ['pending', 'settled'] }
          });

          if (!existingStat) {
            const schedule = await Schedule.findById(scheduleId);
            if (schedule) {
              await CoachSalaryStat.create({
                coach_id: coachBill.coach_id,
                store_id: schedule.store_id,
                booking_id: null,
                schedule_id: scheduleId,
                class_date: new Date(schedule.date),
                duration: item.duration,
                attendance_count: 0,
                salary_rate: item.rate,
                total_salary: item.rate,
                status: 'pending',
                remark: `批量生成于 ${new Date().toISOString()}`
              });
            }
          }
        }
      }
    }

    await logService.createLog({
      operator_id: operatorId,
      operator_name: operatorName,
      action: 'generate_bill',
      module: 'coach_salary_stat',
      detail: `批量生成薪酬账单: ${startDate} ~ ${endDate}, 共${bill.length}位教练, 总计${totalAmount}元`
    });
  }

  return { bill, settled_warning: settledWarning, total_amount: totalAmount };
};