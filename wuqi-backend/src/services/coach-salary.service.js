const CoachSalary = require('../models/CoachSalary');
const CoachSalaryStat = require('../models/CoachSalaryStat');
const Coach = require('../models/Coach');
const Schedule = require('../models/Schedule');
const Booking = require('../models/Booking');
const User = require('../models/User');
const logService = require('./log.service');
const { getAllowedStoreIds } = require('../utils/storeOwnership');

/**
 * 校验薪酬配置的门店归属（店长/员工只能操作所属门店的配置，不能操作全局配置 store_id=null）
 * @param {Object} salary - 薪酬配置记录
 * @param {Object} reqUser - req.user 对象
 * @param {string} [action='操作'] - 操作描述
 */
function assertCanManageSalary(salary, reqUser, action = '操作') {
  if (!salary) return;
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管/审核员：通过
  if (allowedStoreIds === null) return;

  // 全局配置（store_id 为空，多门店执教教练配置）：仅超管可操作
  if (!salary.store_id) {
    throw new Error(`多门店执教教练的薪酬配置仅超级管理员可${action}`);
  }

  // 校验配置所属门店在允许范围内
  if (!allowedStoreIds.includes(String(salary.store_id))) {
    throw new Error(`无权${action}非所属门店的薪酬配置`);
  }
}

/**
 * 校验教练是否可在指定门店执教（用于创建薪酬配置时校验教练归属）
 * - 多门店执教教练（store_ids 为空）：可在任何门店配置薪酬（仅超管可操作）
 * - 门店独占教练：store_ids 必须包含该门店
 */
async function assertCoachCanManageAtStore(coachId, storeId, reqUser, action = '配置') {
  const coach = await Coach.findById(coachId).select('name store_ids');
  if (!coach) throw new Error('教练不存在');

  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管：可操作任意教练
  if (allowedStoreIds === null) return coach;

  // 店长/员工：教练 store_ids 必须是 allowedStoreIds 的子集（即教练完全归属当前用户所辖门店）
  const storeIds = coach.store_ids;
  // 多门店执教教练（store_ids 为空）：仅超管可配置薪酬
  if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
    throw new Error(`多门店执教教练"${coach.name}"的薪酬配置仅超级管理员可${action}`);
  }
  const isSubset = storeIds.every(s => allowedStoreIds.includes(String(s)));
  if (!isSubset) {
    throw new Error(`无权${action}非所属门店教练"${coach.name}"的薪酬`);
  }
  return coach;
}

// 获取教练薪酬配置列表
exports.getCoachSalaryList = async (query, reqUser) => {
  const { coach_id, store_id, is_active, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (coach_id) filter.coach_id = coach_id;

  // 门店过滤：
  // - 超管/审核员（allowedStoreIds 为 null）：按 query.store_id 过滤（若传），否则返回全部（含全局配置 store_id=null）
  // - 店长/员工：只返回所属门店的配置（不含全局配置 store_id=null）
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds === null) {
    // 超管/审核员
    if (store_id) filter.store_id = store_id;
  } else {
    // 店长/员工：限定为所属门店（store_id 不能为 null）
    if (allowedStoreIds.length === 0) {
      // 无门店权限：强制空结果
      filter._id = { $exists: false };
    } else if (allowedStoreIds.length === 1) {
      filter.store_id = allowedStoreIds[0];
    } else {
      filter.store_id = { $in: allowedStoreIds };
    }
  }

  // 默认只返回启用中的配置（is_active: true），除非显式传入 is_active 参数
  if (is_active !== undefined) {
    filter.is_active = is_active === 'true';
  } else {
    filter.is_active = true;
  }

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
exports.getCoachSalaryById = async (id, reqUser) => {
  const salary = await CoachSalary.findById(id)
    .populate('coach_id', 'name')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name');
  if (!salary) throw new Error('薪酬配置不存在');
  // 校验归属
  assertCanManageSalary(salary, reqUser, '查看');
  return salary;
};

// 创建教练薪酬配置
exports.createCoachSalary = async (data, operatorId, reqUser) => {
  try {
    const { coach_id, duration, salary_rate, effective_from, remark } = data;

    // 验证必填字段
    if (!coach_id) throw new Error('教练ID不能为空');
    if (!duration || duration <= 0) throw new Error('课程时长必须大于0');
    if (salary_rate === undefined || salary_rate < 0) throw new Error('薪酬标准不能为负数');

    // 计算 store_id：
    // - 超管：可用 data.store_id（含 null=多门店执教教练全局配置）
    // - 店长/员工：强制为所属门店（单门店）或 data.store_id 必须在允许范围内（多门店店长）
    const allowedStoreIds = getAllowedStoreIds(reqUser);
    let finalStoreId;
    if (allowedStoreIds === null) {
      // 超管：使用 data.store_id，未传则 null（多门店执教教练配置）
      finalStoreId = data.store_id || null;
    } else if (allowedStoreIds.length === 0) {
      throw new Error('您的账号未分配门店，无法创建薪酬配置');
    } else {
      // 店长/员工：store_id 必须为所属门店之一，不能为 null
      const requested = data.store_id ? String(data.store_id) : null;
      if (requested) {
        if (!allowedStoreIds.includes(requested)) {
          throw new Error('无权为非所属门店创建薪酬配置');
        }
        finalStoreId = requested;
      } else {
        // 未传 store_id：单门店默认为所属门店；多门店店长必须明确指定
        if (allowedStoreIds.length === 1) {
          finalStoreId = allowedStoreIds[0];
        } else {
          throw new Error('请选择薪酬配置所属门店');
        }
      }
    }

    // 校验教练归属（店长/员工只能为所属门店教练创建配置；多门店执教教练配置仅超管可创建）
    const coach = await assertCoachCanManageAtStore(coach_id, finalStoreId, reqUser, '配置');

    // 检查是否已存在相同配置（按教练+门店+时长唯一）
    // 注意：唯一索引 { coach_id, store_id, duration } 包含软删除记录，
    // 因此需检查所有记录（含 is_active: false），若存在则恢复而非新建，避免 E11000 冲突
    const existingAny = await CoachSalary.findOne({
      coach_id,
      duration,
      store_id: finalStoreId
    });
    if (existingAny) {
      if (existingAny.is_active) {
        throw new Error('已存在相同门店相同时长的薪酬配置');
      }
      // 恢复已软删除的配置（更新薪酬、生效日期等，重新启用）
      existingAny.salary_rate = Number(salary_rate);
      existingAny.effective_from = effective_from ? new Date(effective_from) : new Date();
      existingAny.effective_to = undefined;
      existingAny.is_active = true;
      existingAny.remark = remark;
      existingAny.created_by = operatorId;
      await existingAny.save();

      // 记录操作日志
      try {
        const operator = await User.findById(operatorId);
        const operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';
        await logService.createLog({
          operator_id: operatorId,
          operator_name: operatorName,
          action: 'create',
          module: 'coach_salary',
          target_id: existingAny._id,
          detail: `恢复教练薪酬配置: ${coach.name}, 时长${duration}分钟, 标准${salary_rate}元/节`,
          store_id: finalStoreId,
        });
      } catch (logErr) {
        console.error('[createCoachSalary] 记录操作日志失败:', logErr.message);
      }

      const restoredSalary = await CoachSalary.findById(existingAny._id)
        .populate('coach_id', 'name')
        .populate('store_id', 'name');
      return restoredSalary;
    }

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

    const salaryData = {
      coach_id,
      store_id: finalStoreId,
      duration: Number(duration),
      salary_rate: Number(salary_rate),
      effective_from: effective_from ? new Date(effective_from) : new Date(),
      remark,
      created_by: operatorId
    };

    // 创建薪酬配置
    const salary = await CoachSalary.create(salaryData);

    // 记录操作日志 - 即使失败也不要影响主流程
    try {
      await logService.createLog({
        operator_id: operatorId,
        operator_name: operatorName,
        action: 'create',
        module: 'coach_salary',
        target_id: salary._id,
        detail: `创建教练薪酬配置: ${coach.name}, 时长${duration}分钟, 标准${salary_rate}元/节`,
        store_id: finalStoreId,
      });
    } catch (logErr) {
      console.error('[createCoachSalary] 记录操作日志失败:', logErr.message);
    }

    // 重新查询以获取populated数据
    const newSalary = await CoachSalary.findById(salary._id)
      .populate('coach_id', 'name')
      .populate('store_id', 'name');

    return newSalary;
  } catch (err) {
    console.error('[createCoachSalary] 创建失败:', err);
    throw err;
  }
};

// 更新教练薪酬配置
exports.updateCoachSalary = async (id, data, operatorId, reqUser) => {
  const salary = await CoachSalary.findById(id);
  if (!salary) throw new Error('薪酬配置不存在');

  // 校验归属
  assertCanManageSalary(salary, reqUser, '编辑');

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
    detail: '更新教练薪酬配置',
    store_id: salary.store_id,
  });

  const updatedSalary = await CoachSalary.findById(id)
    .populate('coach_id', 'name')
    .populate('store_id', 'name');

  return updatedSalary;
};

// 删除教练薪酬配置
exports.deleteCoachSalary = async (id, operatorId, reqUser) => {
  const salary = await CoachSalary.findById(id);
  if (!salary) throw new Error('薪酬配置不存在');

  // 校验归属
  assertCanManageSalary(salary, reqUser, '删除');

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
    detail: '删除教练薪酬配置',
    store_id: salary.store_id,
  });

  return { success: true };
};

// 批量删除教练薪酬配置（删除该教练的所有时长配置）
// 用于"删除整教练配置"场景：传入多个 salary ID，逐个校验归属后软删除
exports.batchDeleteCoachSalary = async (ids, operatorId, reqUser) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('请提供要删除的配置ID');
  }

  const operator = await User.findById(operatorId);
  const operatorName = operator ? (operator.nick_name || operator.username || '未知') : '未知';

  const results = [];
  for (const id of ids) {
    try {
      const salary = await CoachSalary.findById(id);
      if (!salary) {
        results.push({ id, success: false, message: '配置不存在' });
        continue;
      }
      // 校验归属
      assertCanManageSalary(salary, reqUser, '删除');
      salary.is_active = false;
      salary.effective_to = new Date();
      await salary.save();

      await logService.createLog({
        operator_id: operatorId,
        operator_name: operatorName,
        action: 'delete',
        module: 'coach_salary',
        target_id: id,
        detail: '批量删除教练薪酬配置',
        store_id: salary.store_id,
      });

      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, message: err.message });
    }
  }

  const failedCount = results.filter(r => !r.success).length;
  return { success: failedCount === 0, results, failedCount };
};

// 获取教练薪酬统计列表
exports.getCoachSalaryStats = async (query, reqUser) => {
  const { coach_id, store_id, status, start_date, end_date, page = 1, pageSize = 20 } = query;
  const filter = {};

  // 门店隔离：单门店角色只能查看所属门店数据
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      return { list: [], total: 0, page: Number(page), pageSize: Number(pageSize) };
    }
    filter.store_id = { $in: allowedStoreIds };
  }

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

  const Attendance = require('../models/Attendance');
  const attendanceCount = await Attendance.countDocuments({
    schedule_id: scheduleId,
    check_in_method: { $nin: ['exempt_cancel', 'cancelled_after_checkin'] },  // 豁免取消和签到后取消不计入课时
  });

  const duration = schedule.duration || 75;

  // 优先查找门店专属配置（同教练不同门店薪资不同），按时长精确匹配
  let salary = await CoachSalary.findOne({
    coach_id: schedule.coach_id,
    store_id: schedule.store_id,
    duration: duration,
    is_active: true
  }).sort({ effective_from: -1 });

  if (!salary) {
    // 查找多门店执教通用配置（store_id为null），按时长精确匹配
    salary = await CoachSalary.findOne({
      coach_id: schedule.coach_id,
      store_id: null,
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

  if (!salary) {
    // 查找该教练任意时长的通用配置
    salary = await CoachSalary.findOne({
      coach_id: schedule.coach_id,
      store_id: null,
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
exports.getSalarySummary = async (query, reqUser) => {
  const { coach_id, store_id, start_date, end_date } = query;

  // 门店隔离：单门店角色只能查看所属门店数据
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  const storeFilterCond = allowedStoreIds !== null
    ? (allowedStoreIds && allowedStoreIds.length > 0 ? { store_id: { $in: allowedStoreIds } } : { _id: { $exists: false } })
    : null;

  const settledFilter = { status: 'settled' };
  if (coach_id) settledFilter.coach_id = coach_id;
  if (store_id) settledFilter.store_id = store_id;
  if (storeFilterCond) Object.assign(settledFilter, storeFilterCond);
  if (start_date || end_date) {
    settledFilter.class_date = {};
    if (start_date) settledFilter.class_date.$gte = new Date(start_date);
    if (end_date) settledFilter.class_date.$lte = new Date(end_date);
  }

  const pendingFilter = { status: 'pending' };
  if (coach_id) pendingFilter.coach_id = coach_id;
  if (store_id) pendingFilter.store_id = store_id;
  if (storeFilterCond) Object.assign(pendingFilter, storeFilterCond);

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
exports.generateSalaryBill = async (startDate, endDate, preview = false, operatorId = null, coachIds = null, reqUser = null, storeId = null) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const Attendance = require('../models/Attendance');

  // 门店隔离：单门店角色只能基于所属门店的签到数据生成账单（复用课时统计/月度薪酬的过滤逻辑）
  const allowedStoreIds = reqUser ? getAllowedStoreIds(reqUser) : null;

  // 只统计有签到的排课（有人上课教练才算干活，排除豁免取消）
  const attendanceFilter = {
    date: {
      $gte: startDate,
      $lte: endDate
    },
    check_in_method: { $nin: ['exempt_cancel', 'cancelled_after_checkin'] },
  };
  // 单门店角色：仅统计所属门店的签到记录
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      return { bill: [], settled_warning: '', total_amount: 0 };
    }
    attendanceFilter.store_id = { $in: allowedStoreIds };
  } else if (storeId) {
    // 超管/审核员选了具体门店：按该门店过滤
    attendanceFilter.store_id = storeId;
  }
  const attendanceRecords = await Attendance.find(attendanceFilter).select('schedule_id');

  const attendedScheduleIds = [...new Set(attendanceRecords.map(a => a.schedule_id.toString()))];

  if (attendedScheduleIds.length === 0) {
    return { bill: [], settled_warning: '', total_amount: 0 };
  }

  const scheduleFilter = {
    _id: { $in: attendedScheduleIds },
    coach_id: { $ne: null }
  };
  // 单门店角色：仅查询所属门店的排课（防止 attendance store_id 缺失时跨门店）
  if (allowedStoreIds !== null) {
    scheduleFilter.store_id = { $in: allowedStoreIds };
  } else if (storeId) {
    // 超管/审核员选了具体门店：按该门店过滤
    scheduleFilter.store_id = storeId;
  }
  // 支持只生成选中教练的账单
  if (coachIds && Array.isArray(coachIds) && coachIds.length > 0) {
    scheduleFilter.coach_id = { $in: coachIds };
  }

  const schedules = await Schedule.find(scheduleFilter).populate('coach_id', 'name');

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
      coachStats[coachId].items[duration] = { duration, count: 0, schedule_ids: [], store_ids: new Set() };
    }
    
    coachStats[coachId].items[duration].count++;
    coachStats[coachId].items[duration].schedule_ids.push(schedule._id.toString());
    if (schedule.store_id) {
      coachStats[coachId].items[duration].store_ids.add(schedule.store_id.toString());
    }
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
      const storeIds = [...item.store_ids];
      let salary = null;

      // 单一门店：优先查找门店专属配置
      if (storeIds.length === 1) {
        salary = await CoachSalary.findOne({
          coach_id: coachId,
          store_id: storeIds[0],
          duration: parseInt(duration),
          is_active: true
        }).sort({ effective_from: -1 });
      }

      if (!salary) {
        // 查找多门店执教通用配置
        salary = await CoachSalary.findOne({
          coach_id: coachId,
          store_id: null,
          duration: parseInt(duration),
          is_active: true
        }).sort({ effective_from: -1 });
      }

      if (!salary && storeIds.length === 1) {
        // 查找该门店任意时长的配置
        salary = await CoachSalary.findOne({
          coach_id: coachId,
          store_id: storeIds[0],
          is_active: true
        }).sort({ effective_from: -1 });
      }

      if (!salary) {
        // 回退：查找任意配置
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
              // 从 Attendance 表获取实际签到人数
              const Attendance = require('../models/Attendance');
              const realAttendance = await Attendance.countDocuments({
                schedule_id: scheduleId,
                check_in_method: { $nin: ['exempt_cancel', 'cancelled_after_checkin'] },  // 豁免取消和签到后取消不计入课时
              });
              
              await CoachSalaryStat.create({
                coach_id: coachBill.coach_id,
                store_id: schedule.store_id,
                booking_id: null,
                schedule_id: scheduleId,
                class_date: new Date(schedule.date),
                duration: item.duration,
                attendance_count: realAttendance,
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

    // 保存账单文档（持久化成果）
    const SalaryBill = require('../models/SalaryBill');
    await SalaryBill.create({
      start_date: new Date(startDate),
      end_date: new Date(endDate),
      coaches: bill.map(c => ({
        coach_id: c.coach_id,
        coach_name: c.coach_name,
        items: c.items.map(i => ({
          duration: i.duration,
          count: i.count,
          rate: i.rate,
          amount: i.amount
        })),
        total_amount: c.total_amount
      })),
      total_amount: totalAmount,
      coach_count: bill.length,
      generated_by: operatorId
    });

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

// ========== 账单列表 ==========

/**
 * 获取生成的账单列表
 * 门店隔离：单门店角色（店长/员工）只能查看自己生成的账单（账单数据来源于门店隔离后的课时统计）
 */
exports.getBillList = async (query, reqUser) => {
  const { page = 1, pageSize = 20 } = query;
  const SalaryBill = require('../models/SalaryBill');

  // 单门店角色：只能查看自己生成的账单（生成时已按所属门店过滤数据）
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  let filter = {};
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      return { list: [], total: 0, page: Number(page), pageSize: Number(pageSize) };
    }
    filter.generated_by = reqUser.id;
  }

  const list = await SalaryBill.find(filter)
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await SalaryBill.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

/**
 * 获取单个账单详情
 */
exports.getBillDetail = async (id, reqUser) => {
  const SalaryBill = require('../models/SalaryBill');
  const bill = await SalaryBill.findById(id);
  if (!bill) throw new Error('账单不存在');
  // 单门店角色只能查看自己生成的账单
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds !== null && String(bill.generated_by) !== String(reqUser.id)) {
    throw new Error('无权查看非本人生成的账单');
  }
  return bill;
};

/**
 * 删除账单
 */
exports.deleteBill = async (id, reqUser) => {
  const SalaryBill = require('../models/SalaryBill');
  const bill = await SalaryBill.findById(id);
  if (!bill) throw new Error('账单不存在');
  // 单门店角色只能删除自己生成的账单
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds !== null && String(bill.generated_by) !== String(reqUser.id)) {
    throw new Error('无权删除非本人生成的账单');
  }
  await SalaryBill.deleteOne({ _id: id });
  return { success: true };
};

// ========== 薪酬按月聚合（基于实际上课数据） ==========

/**
 * 获取月度薪酬明细（基于Attendance实际签到 + CoachSalary配置计算）
 * 不依赖生成账单，直接用上课数据 × 薪酬配置得出每位教练每月薪酬
 * 
 * @param {Object} query - { year?, coach_id?, store_id? }
 * @returns {Object} { years: [{ year, yearLabel, months: [{ monthKey, monthLabel, totalAmount, coaches: [{ coach_id, coach_name, durations: [{ duration, count, rate, amount }], total_amount }] }] }] }
 */
exports.getMonthlySalaryBreakdown = async (query, reqUser) => {
  const { coach_id, store_id } = query;
  const Attendance = require('../models/Attendance');

  // 步骤1：查所有实际上课的签到记录（排除豁免取消的签到），并带出快照字段
  const attendanceFilter = {};
  if (coach_id) attendanceFilter.coach_id = coach_id;
  if (store_id) attendanceFilter.store_id = store_id;
  attendanceFilter.check_in_method = { $nin: ['exempt_cancel', 'cancelled_after_checkin'] };

  // 门店隔离：单门店角色只能查看所属门店数据
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      return { years: [] };
    }
    attendanceFilter.store_id = { $in: allowedStoreIds };
  }

  const attendances = await Attendance.find(attendanceFilter)
    .select('schedule_id coach_id store_id date course_name start_time end_time duration coach_name store_name check_in_time');

  if (attendances.length === 0) {
    return { years: [] };
  }

  // 步骤2：查询关联的排课作为补充（部分课程可能已被删除，但Attendance快照仍可溯源）
  const scheduleIds = [...new Set(attendances.map(a => a.schedule_id && a.schedule_id.toString()).filter(Boolean))];
  const schedules = await Schedule.find({ _id: { $in: scheduleIds } })
    .populate('coach_id', 'name')
    .populate('store_id', 'name')
    .lean();
  const scheduleMap = new Map(schedules.map(s => [s._id.toString(), s]));

  // 预加载所有涉及的 Coach（通过 coach_id 批量查询，Coach 软删除后仍存在）
  const coachIdsInAttendance = [...new Set(
    attendances.filter(a => a.coach_id).map(a => a.coach_id.toString())
  )];
  const coachMap = new Map();
  if (coachIdsInAttendance.length > 0) {
    const coaches = await Coach.find({ _id: { $in: coachIdsInAttendance } }).select('name').lean();
    coaches.forEach(c => coachMap.set(c._id.toString(), c));
  }

  // 步骤3：去重课次。同一 schedule_id 只算一节课；若 schedule 已删除，每条 attendance 独立成一节课
  const classMap = new Map();
  attendances.forEach(a => {
    const sid = a.schedule_id ? a.schedule_id.toString() : null;
    const schedule = sid ? scheduleMap.get(sid) : null;

    // 优先使用 Attendance 快照字段；若快照缺失则回退到 Coach 表，再回退到 Schedule 关联数据
    const coachId = a.coach_id ? a.coach_id.toString() : (schedule && schedule.coach_id ? schedule.coach_id._id.toString() : '_unknown');
    const coachName = a.coach_name
      || (a.coach_id && coachMap.get(a.coach_id.toString()) ? coachMap.get(a.coach_id.toString()).name : '')
      || (schedule && schedule.coach_id ? schedule.coach_id.name : '未知');
    const storeId = a.store_id ? a.store_id.toString() : (schedule && schedule.store_id ? schedule.store_id._id.toString() : '_none');
    const dateStr = a.date || (schedule ? schedule.date : null);
    const duration = a.duration || (schedule ? schedule.duration : 75) || 75;

    if (!dateStr) return;

    const date = new Date(dateStr);
    const year = date.getFullYear();
    const monthKey = String(date.getMonth() + 1).padStart(2, '0');
    const monthLabel = `${date.getMonth() + 1}月`;
    const classKey = sid || a._id.toString();

    if (!classMap.has(classKey)) {
      classMap.set(classKey, {
        year,
        monthKey,
        monthLabel,
        coachId,
        coachName,
        storeId,
        duration
      });
    }
  });

  // 步骤4：按年份→月份→教练→时长分组，统计课时数
  const yearsMap = {};

  classMap.forEach(cls => {
    if (!yearsMap[cls.year]) yearsMap[cls.year] = { year: cls.year, yearLabel: `${cls.year}年`, monthsMap: {} };
    if (!yearsMap[cls.year].monthsMap[cls.monthKey]) {
      yearsMap[cls.year].monthsMap[cls.monthKey] = { monthKey: cls.monthKey, monthLabel: cls.monthLabel, sort: cls.monthKey, coachesMap: {} };
    }
    if (!yearsMap[cls.year].monthsMap[cls.monthKey].coachesMap[cls.coachId]) {
      yearsMap[cls.year].monthsMap[cls.monthKey].coachesMap[cls.coachId] = {
        coach_id: cls.coachId,
        coach_name: cls.coachName,
        durationsMap: {}
      };
    }

    const coach = yearsMap[cls.year].monthsMap[cls.monthKey].coachesMap[cls.coachId];
    if (!coach.durationsMap[cls.duration]) {
      coach.durationsMap[cls.duration] = { duration: cls.duration, count: 0, store_counts: {} };
    }
    coach.durationsMap[cls.duration].count++;
    if (cls.storeId && cls.storeId !== '_none') {
      coach.durationsMap[cls.duration].store_counts[cls.storeId] =
        (coach.durationsMap[cls.duration].store_counts[cls.storeId] || 0) + 1;
    }
  });

  // 步骤4：批量查询所有教练的薪酬配置（按coach_id + duration匹配）
  const allCoachIds = [...new Set(
    Object.values(yearsMap).flatMap(y =>
      Object.values(y.monthsMap).flatMap(m => Object.keys(m.coachesMap))
    )
  )];

  // 一次查询所有相关教练的配置（含已停用配置，按生效日期匹配历史课程薪资）
  const salaryConfigs = await CoachSalary.find({
    coach_id: { $in: allCoachIds }
  }).sort({ effective_from: -1 });

  // 构建 store-aware rate 映射：门店专属配置和多门店通用配置分别存储
  const rateMapSpecific = {};  // key: `${coach_id}_${store_id}_${duration}` → rate
  const rateMapGeneric = {};   // key: `${coach_id}_${duration}` → rate（store_id为null的通用配置）
  const coachesWithConfig = new Set();
  salaryConfigs.forEach(cfg => {
    if (cfg.store_id) {
      const key = `${cfg.coach_id.toString()}_${cfg.store_id.toString()}_${cfg.duration}`;
      if (!rateMapSpecific[key]) {
        rateMapSpecific[key] = cfg.salary_rate;
      }
    } else {
      const key = `${cfg.coach_id.toString()}_${cfg.duration}`;
      if (!rateMapGeneric[key]) {
        rateMapGeneric[key] = cfg.salary_rate;
      }
    }
    coachesWithConfig.add(cfg.coach_id.toString());
  });

  // 步骤5：计算金额并转换为数组
  const years = Object.values(yearsMap)
    .sort((a, b) => b.year - a.year)
    .map(y => ({
      year: y.year,
      yearLabel: y.yearLabel,
      months: Object.values(y.monthsMap)
        .sort((a, b) => b.sort.localeCompare(a.sort))
        .map(m => {
          const coaches = Object.values(m.coachesMap)
            .map(c => {
              const durations = Object.values(c.durationsMap)
                .map(d => {
                  // 按门店计算金额：同一时长在不同门店可能有不同薪酬费率
                  const storeEntries = Object.entries(d.store_counts || {});
                  let amount = 0;
                  let displayRate = 0;
                  let rateForAll = null; // 用于判断所有门店是否同一费率

                  if (storeEntries.length === 0) {
                    // 无门店信息，使用通用配置
                    const genericKey = `${c.coach_id}_${d.duration}`;
                    displayRate = rateMapGeneric[genericKey] || 0;
                    amount = d.count * displayRate;
                  } else {
                    // 按门店分别计算
                    for (const [storeId, storeCount] of storeEntries) {
                      const specificKey = `${c.coach_id}_${storeId}_${d.duration}`;
                      const genericKey = `${c.coach_id}_${d.duration}`;
                      const rate = rateMapSpecific[specificKey] !== undefined
                        ? rateMapSpecific[specificKey]
                        : (rateMapGeneric[genericKey] || 0);
                      amount += storeCount * rate;
                      if (rateForAll === null) {
                        rateForAll = rate;
                      } else if (rateForAll !== rate) {
                        rateForAll = -1; // 标记费率不一致
                      }
                    }
                    // 展示费率：所有门店一致时显示该费率，不一致时显示0（前端可特殊处理）
                    displayRate = rateForAll === -1 ? 0 : (rateForAll || 0);
                  }

                  return {
                    duration: d.duration,
                    count: d.count,
                    rate: Math.round(displayRate * 100) / 100,
                    amount: Math.round(amount * 100) / 100
                  };
                })
                .sort((a, b) => a.duration - b.duration);

              const total_amount = Math.round(
                durations.reduce((sum, d) => sum + d.amount, 0) * 100
              ) / 100;

              return {
                coach_id: c.coach_id,
                coach_name: c.coach_name,
                durations,
                total_amount,
                has_salary_config: coachesWithConfig.has(c.coach_id)
              };
            })
            .sort((a, b) => b.total_amount - a.total_amount);

          const totalAmount = Math.round(
            coaches.reduce((sum, c) => sum + c.total_amount, 0) * 100
          ) / 100;

          return {
            monthKey: m.monthKey,
            monthLabel: m.monthLabel,
            totalAmount,
            coaches
          };
        })
    }));

  return { years };
};

// ========== 课时统计 ==========

/**
 * 获取教练课时统计（按月份分组，按教练分组）
 * @param {Object} query - { year?, coach_id?, store_id? }
 * @returns {Object} { months: [{ month, label, coaches: [{ coach_name, total_classes, durations: [{duration, count}], records: [{...}] }] }] }
 */
exports.getClassHoursStats = async (query, reqUser) => {
  const { coach_id, store_id } = query;
  const Attendance = require('../models/Attendance');
  const Coach = require('../models/Coach');
  const Schedule = require('../models/Schedule');

  // 课时统计基于 Attendance 表，快照字段优先，缺失时通过 coach_id 回退查询
  const attendanceFilter = {};
  if (coach_id) attendanceFilter.coach_id = coach_id;
  if (store_id) attendanceFilter.store_id = store_id;
  // 豁免取消和签到后取消的签到不计入课时统计
  attendanceFilter.check_in_method = { $nin: ['exempt_cancel', 'cancelled_after_checkin'] };

  // 门店隔离：单门店角色只能查看所属门店数据
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      return { years: [], summary: { total_years: 0, total_classes: 0 } };
    }
    attendanceFilter.store_id = { $in: allowedStoreIds };
  }

  const attendances = await Attendance.find(attendanceFilter)
    .select('schedule_id coach_id store_id date course_name start_time end_time duration coach_name store_name check_in_time');

  if (attendances.length === 0) {
    return { years: [], summary: { total_years: 0, total_classes: 0 } };
  }

  // 预加载所有涉及的 Coach（通过 coach_id 批量查询，Coach 软删除后仍存在）
  // 用于补全 coach_name 快照缺失的记录
  const coachIdsInAttendance = [...new Set(
    attendances.filter(a => a.coach_id).map(a => a.coach_id.toString())
  )];
  const coachMap = new Map();
  if (coachIdsInAttendance.length > 0) {
    const coaches = await Coach.find({ _id: { $in: coachIdsInAttendance } }).select('name avatar_url').lean();
    coaches.forEach(c => coachMap.set(c._id.toString(), c));
  }

  // 预加载所有涉及的 Schedule（用于补全 store_id/date/time 等快照缺失的记录）
  const scheduleIds = [...new Set(
    attendances.filter(a => a.schedule_id).map(a => a.schedule_id.toString())
  )];
  const scheduleMap = new Map();
  if (scheduleIds.length > 0) {
    const schedules = await Schedule.find({ _id: { $in: scheduleIds } })
      .populate('coach_id', 'name avatar_url')
      .populate('store_id', 'name')
      .lean();
    schedules.forEach(s => scheduleMap.set(s._id.toString(), s));
  }

  // 按 schedule_id 统计签到人数（同一节课的签到人数）
  const attendanceCountMap = {};
  attendances.forEach(a => {
    const sid = a.schedule_id ? a.schedule_id.toString() : null;
    if (sid) attendanceCountMap[sid] = (attendanceCountMap[sid] || 0) + 1;
  });

  // 去重课次：同一 schedule_id 只算一节课；无 schedule_id 的每条独立成一节课
  const classMap = new Map();
  attendances.forEach(a => {
    const sid = a.schedule_id ? a.schedule_id.toString() : null;
    const schedule = sid ? scheduleMap.get(sid) : null;

    // 教练信息：Attendance 快照 → Coach 表直接查询 → Schedule populate → "未知教练"
    const coachId = a.coach_id ? a.coach_id.toString()
      : (schedule && schedule.coach_id ? schedule.coach_id._id.toString() : '_unknown');
    let coachName = a.coach_name || '';
    if (!coachName) {
      // 快照缺失，从 Coach 表直接查询（Coach 软删除后仍存在）
      const coachDoc = a.coach_id ? coachMap.get(a.coach_id.toString()) : null;
      if (coachDoc) {
        coachName = coachDoc.name || '';
      } else if (schedule && schedule.coach_id) {
        // Coach 表也没有，从 Schedule populate 获取
        coachName = schedule.coach_id.name || '';
      }
      if (!coachName) coachName = '未知教练';
    }

    // 门店信息：Attendance 快照 → Schedule populate → "未知门店"
    const storeId = a.store_id ? a.store_id.toString()
      : (schedule && schedule.store_id ? schedule.store_id._id.toString() : '_none');
    const storeName = a.store_name || (schedule && schedule.store_id ? schedule.store_id.name : '') || '未知门店';

    // 时间信息：Attendance 快照 → Schedule
    const dateStr = a.date || (schedule ? schedule.date : null);
    const startTime = a.start_time || (schedule ? schedule.start_time : '') || '';
    const endTime = a.end_time || (schedule ? schedule.end_time : '') || '';
    const duration = a.duration || (schedule ? schedule.duration : 0) || 75;

    if (!dateStr) return;

    const date = new Date(dateStr);
    const year = date.getFullYear();
    const monthKey = String(date.getMonth() + 1).padStart(2, '0');
    const monthLabel = `${date.getMonth() + 1}月`;
    const dayOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    const classKey = sid || a._id.toString();

    if (!classMap.has(classKey)) {
      classMap.set(classKey, {
        year,
        monthKey,
        monthLabel,
        coachId,
        coachName,
        storeId,
        storeName,
        date: dateStr,
        startTime,
        endTime,
        duration,
        dayOfWeek,
        attendance_count: sid ? (attendanceCountMap[sid] || 1) : 1
      });
    }
  });

  // 按年份 → 月份 → 教练 → 门店分组
  const yearsMap = {};
  classMap.forEach(cls => {
    if (!yearsMap[cls.year]) yearsMap[cls.year] = { year: cls.year, yearLabel: `${cls.year}年`, monthsMap: {} };
    if (!yearsMap[cls.year].monthsMap[cls.monthKey]) {
      yearsMap[cls.year].monthsMap[cls.monthKey] = { monthKey: cls.monthKey, monthLabel: cls.monthLabel, sort: cls.monthKey, coachesMap: {} };
    }
    if (!yearsMap[cls.year].monthsMap[cls.monthKey].coachesMap[cls.coachId]) {
      yearsMap[cls.year].monthsMap[cls.monthKey].coachesMap[cls.coachId] = {
        coach_id: cls.coachId,
        coach_name: cls.coachName,
        storesMap: {}
      };
    }

    const coach = yearsMap[cls.year].monthsMap[cls.monthKey].coachesMap[cls.coachId];
    if (!coach.storesMap[cls.storeId]) {
      coach.storesMap[cls.storeId] = { store_id: cls.storeId, store_name: cls.storeName, durationsMap: {}, records: [] };
    }

    const store = coach.storesMap[cls.storeId];
    if (!store.durationsMap[cls.duration]) store.durationsMap[cls.duration] = { duration: cls.duration, count: 0 };
    store.durationsMap[cls.duration].count++;

    store.records.push({
      class_date: cls.date,
      weekday: cls.dayOfWeek,
      start_time: cls.startTime,
      end_time: cls.endTime,
      duration: cls.duration,
      attendance_count: cls.attendance_count,
      store_name: cls.storeName
    });
  });

  // 转换为数组：年份降序，月份降序，教练按课时降序，门店按课时降序
  const years = Object.values(yearsMap)
    .sort((a, b) => b.year - a.year)
    .map(y => ({
      ...y,
      months: Object.values(y.monthsMap)
        .sort((a, b) => b.sort.localeCompare(a.sort))
        .map(m => ({
          ...m,
          coaches: Object.values(m.coachesMap)
            .map(c => {
              const stores = Object.values(c.storesMap)
                .map(s => ({
                  ...s,
                  total_classes: s.records.length,
                  durations: Object.values(s.durationsMap).sort((a, b) => a.duration - b.duration)
                }))
                .sort((a, b) => b.total_classes - a.total_classes);
              const total = stores.reduce((sum, s) => sum + s.total_classes, 0);
              return { ...c, total_classes: total, stores };
            })
            .sort((a, b) => b.total_classes - a.total_classes)
        }))
    }));

  return {
    years,
    summary: {
      total_years: years.length,
      total_classes: years.reduce((sum, y) => sum + (y.months || []).reduce((s, m) => s + (m.coaches || []).reduce((cs, c) => cs + (c.total_classes || 0), 0), 0), 0)
    }
  };
};