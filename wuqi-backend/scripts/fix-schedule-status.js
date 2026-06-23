/**
 * 一次性数据修复脚本：修正课程状态 + 重建 PendingTask
 *
 * 修复目标：
 *   1. 扫描所有非 deleted 的课程，按时间节点和预约人数重新判定状态
 *   2. 为状态流转未完成的课程重建 PendingTask
 *
 * 判定规则（与 scheduleStatus.constants.js 状态规范一致）：
 *   - 已过下课时间 + 预约人数达标 → completed
 *   - 已过下课时间 + 预约人数不足 → cancelled (min_bookings_not_met)
 *   - 已过上课时间未过下课时间 + 预约人数达标 → in_progress
 *   - 已过上课时间未过下课时间 + 预约人数不足 → cancelled (min_bookings_not_met)
 *   - 已过预约截止时间 + 预约人数不足 → cancelled (min_bookings_not_met)
 *   - 未过预约截止时间 → 保持 available / full（根据预约数）
 *   - offline 状态：已过下课时间的保持 offline（不恢复），未过下课时间的恢复并重建 PendingTask
 *   - cancelled / deleted：终态，不修改
 *   - completed：需验证，如果人数不足则修正为 cancelled（修复历史错误数据）
 *
 * 用法：
 *   cd wuqi-backend
 *   node scripts/fix-schedule-status.js          # 预览模式（只打印不修改）
 *   node scripts/fix-schedule-status.js --apply   # 执行模式（实际修改）
 *
 * 执行前请先停止后端服务，避免冲突。
 */

require('dotenv').config();
const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const BEIJING_TZ = 'Asia/Shanghai';

// 直接定义 Schema，避免依赖项目模型文件（脚本独立可运行）
const scheduleSchema = new mongoose.Schema({
  coach_id: mongoose.Schema.Types.ObjectId,
  dance_style_id: mongoose.Schema.Types.ObjectId,
  store_id: mongoose.Schema.Types.ObjectId,
  date: String,
  start_time: String,
  end_time: String,
  max_bookings: { type: Number, default: 20 },
  min_bookings: { type: Number, default: 5 },
  current_bookings: { type: Number, default: 0 },
  status: { type: String, enum: ['not_open', 'available', 'full', 'offline', 'cancelled', 'in_progress', 'completed', 'deleted'] },
  cancel_reason: String,
  cancel_type: String,
  booking_deadline: { type: Number, default: 120 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const bookingSchema = new mongoose.Schema({
  schedule_id: mongoose.Schema.Types.ObjectId,
  user_id: mongoose.Schema.Types.ObjectId,
  status: String,
});

const pendingTaskSchema = new mongoose.Schema({
  schedule_id: mongoose.Schema.Types.ObjectId,
  trigger_at: Date,
  type: String,
  processed: { type: String, default: 'pending' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const Schedule = mongoose.model('Schedule', scheduleSchema, 'schedules');
const Booking = mongoose.model('Booking', bookingSchema, 'bookings');
const PendingTask = mongoose.model('PendingTask', pendingTaskSchema, 'pendingtasks');

// ============ 状态常量（与 scheduleStatus.constants.js 保持一致）============
const SCHEDULE_STATUS = {
  NOT_OPEN: 'not_open',
  AVAILABLE: 'available',
  FULL: 'full',
  OFFLINE: 'offline',
  CANCELLED: 'cancelled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DELETED: 'deleted',
};
const CANCEL_REASON = {
  MIN_BOOKINGS_NOT_MET: 'min_bookings_not_met',
};
const TERMINAL_STATUSES = ['cancelled', 'completed', 'deleted'];
// 不可变终态：只有 cancelled 和 deleted 不可修改
// completed 需要验证人数，可能被修正为 cancelled
const IMMUTABLE_STATUSES = ['cancelled', 'deleted'];

// ============ 主逻辑 ============
async function fixScheduleStatus(isApply) {
  const now = dayjs().tz(BEIJING_TZ);
  console.log(`\n========== 课程状态修复脚本 ==========`);
  console.log(`当前北京时间: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log(`模式: ${isApply ? '执行（实际修改）' : '预览（只打印不修改）'}`);
  console.log(`======================================\n`);

  // 查询所有非 deleted 的课程
  const schedules = await Schedule.find({ status: { $ne: 'deleted' } }).sort({ date: 1, start_time: 1 });
  console.log(`共扫描 ${schedules.length} 条课程记录\n`);

  const stats = {
    total: schedules.length,
    needFix: 0,
    fixed: 0,
    skipped: 0,
    byAction: {
      toCompleted: 0,
      toCancelled: 0,
      toInProgress: 0,
      toAvailable: 0,
      toFull: 0,
      rebuildTask: 0,
      keepOffline: 0,
    },
  };

  for (const schedule of schedules) {
    try {
      const result = await analyzeSchedule(schedule, now);

      if (!result.needFix) {
        stats.skipped++;
        continue;
      }

      stats.needFix++;
      console.log(`[${stats.needFix}] ${schedule.date} ${schedule.start_time}-${schedule.end_time} | ${schedule.course_name || '(无名)'} | ${schedule._id}`);
      console.log(`    当前状态: ${schedule.status} → 目标状态: ${result.newStatus}`);
      console.log(`    原因: ${result.reason}`);

      if (result.rebuildTask) {
        console.log(`    同时重建 PendingTask（3个任务）`);
      }

      if (isApply) {
        await applyFix(schedule, result);
        stats.fixed++;
      }

      if (result.byAction) {
        stats.byAction[result.byAction]++;
      }
      if (result.rebuildTask) {
        stats.byAction.rebuildTask++;
      }
      console.log('');
    } catch (err) {
      console.log(`  ❌ 处理课程 ${schedule._id} 时出错: ${err.message}`);
      stats.skipped++;
    }
  }

  // 打印汇总
  console.log(`\n========== 修复汇总 ==========`);
  console.log(`总课程数: ${stats.total}`);
  console.log(`需要修复: ${stats.needFix}`);
  console.log(`已修复: ${stats.fixed}（${isApply ? '已执行' : '预览模式未执行'}）`);
  console.log(`无需修复: ${stats.skipped}`);
  console.log(`\n按操作分类:`);
  console.log(`  → completed: ${stats.byAction.toCompleted}`);
  console.log(`  → cancelled: ${stats.byAction.toCancelled}`);
  console.log(`  → in_progress: ${stats.byAction.toInProgress}`);
  console.log(`  → available: ${stats.byAction.toAvailable}`);
  console.log(`  → full: ${stats.byAction.toFull}`);
  console.log(`  重建 PendingTask: ${stats.byAction.rebuildTask}`);
  console.log(`  保持 offline（已过期）: ${stats.byAction.keepOffline}`);
  console.log(`==============================\n`);

  if (!isApply && stats.needFix > 0) {
    console.log(`以上为预览结果。确认无误后，执行以下命令实际修复：`);
    console.log(`  node scripts/fix-schedule-status.js --apply\n`);
  } else if (!isApply && stats.needFix === 0) {
    console.log(`所有课程状态均正常，无需修复。\n`);
  } else if (isApply) {
    console.log(`修复完成！请重启后端服务。\n`);
  }
}

// 将 date 字段标准化为 "YYYY-MM-DD" 字符串
// 数据库中 date 可能是 String、Date 对象或其他格式
function normalizeDate(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    // 已经是 "YYYY-MM-DD" 格式
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
    // ISO 字符串，提取日期部分
    if (dateVal.includes('T')) return dateVal.split('T')[0];
    // 其他格式，尝试用 dayjs 解析
    const d = dayjs(dateVal);
    return d.isValid() ? d.format('YYYY-MM-DD') : null;
  }
  if (dateVal instanceof Date) {
    const d = dayjs(dateVal);
    return d.isValid() ? d.format('YYYY-MM-DD') : null;
  }
  return null;
}

// 将 time 字段标准化为 "HH:mm" 字符串
function normalizeTime(timeVal) {
  if (!timeVal) return null;
  if (typeof timeVal === 'string') {
    // "HH:mm" 或 "HH:mm:ss"
    if (/^\d{2}:\d{2}/.test(timeVal)) return timeVal.substring(0, 5);
    return null;
  }
  if (timeVal instanceof Date) {
    const d = dayjs(timeVal);
    return d.isValid() ? d.format('HH:mm') : null;
  }
  return null;
}

// 分析单条课程应该是什么状态
async function analyzeSchedule(schedule, now) {
  const result = {
    needFix: false,
    newStatus: schedule.status,
    reason: '',
    rebuildTask: false,
    byAction: null,
  };

  // 不可变终态（cancelled / deleted）直接跳过
  if (IMMUTABLE_STATUSES.includes(schedule.status)) {
    return result;
  }

  // 时间字段校验 + 标准化
  const dateStr = normalizeDate(schedule.date);
  const startTimeStr = normalizeTime(schedule.start_time);
  const endTimeStr = normalizeTime(schedule.end_time);

  if (!dateStr || !startTimeStr || !endTimeStr) {
    console.log(`  ⚠️ 跳过：时间字段异常 date=${JSON.stringify(schedule.date)} start=${JSON.stringify(schedule.start_time)} end=${JSON.stringify(schedule.end_time)} | ${schedule._id}`);
    return result;
  }

  let startDateTime, endDateTime;
  try {
    startDateTime = dayjs.tz(dateStr + ' ' + startTimeStr, BEIJING_TZ);
    endDateTime = dayjs.tz(dateStr + ' ' + endTimeStr, BEIJING_TZ);
  } catch (e) {
    console.log(`  ⚠️ 跳过：时间解析失败 date="${dateStr}" start="${startTimeStr}" end="${endTimeStr}" | ${schedule._id}`);
    return result;
  }

  if (!startDateTime.isValid() || !endDateTime.isValid()) {
    console.log(`  ⚠️ 跳过：时间无效 date="${dateStr}" start="${startTimeStr}" end="${endTimeStr}" | ${schedule._id}`);
    return result;
  }

  // 实时查询预约人数（不信任 current_bookings 字段）
  const realBookings = await Booking.countDocuments({
    schedule_id: schedule._id,
    status: 'booked',
  });
  const minBookings = schedule.min_bookings || 5;
  const maxBookings = schedule.max_bookings || 20;
  const bookingDeadline = schedule.booking_deadline || 120;
  const bookingDeadlineTime = startDateTime.subtract(bookingDeadline, 'minute');

  // ========== offline 状态特殊处理 ==========
  if (schedule.status === SCHEDULE_STATUS.OFFLINE) {
    if (now.isAfter(endDateTime)) {
      // 已过下课时间 → 保持 offline（不恢复为 available）
      // 状态流转由查询时兜底机制处理，这里不强制改
      result.reason = '已下线且课程已过期，保持 offline（由兜底机制处理）';
      result.byAction = 'keepOffline';
      // 不标记 needFix，保持原状
      return result;
    }
    // 未过下课时间 → 恢复为 available/full 并重建 PendingTask
    // 注意：这里只处理"明显应该恢复"的情况，实际放假撤销由 holiday.service 处理
    // 脚本不主动恢复 offline 状态，避免误恢复管理员主动下线的课程
    result.reason = '已下线，保持 offline（由管理员或放假撤销时恢复）';
    result.byAction = 'keepOffline';
    return result;
  }

  // ========== not_open / available / full / in_progress 状态处理 ==========
  let targetStatus = schedule.status;
  let reason = '';

  if (now.isAfter(endDateTime)) {
    // 情况1：已过下课时间
    if (realBookings >= minBookings) {
      // 人数达标 → completed
      targetStatus = SCHEDULE_STATUS.COMPLETED;
      reason = `已过下课时间，预约${realBookings}/${minBookings}达标 → completed`;
      result.byAction = 'toCompleted';
    } else {
      // 人数不足 → cancelled
      targetStatus = SCHEDULE_STATUS.CANCELLED;
      reason = `已过下课时间，预约${realBookings}/${minBookings}不足 → cancelled`;
      result.byAction = 'toCancelled';
    }
  } else if (now.isAfter(startDateTime)) {
    // 情况2：已过上课时间，未过下课时间
    if (realBookings >= minBookings) {
      // 人数达标 → in_progress
      targetStatus = SCHEDULE_STATUS.IN_PROGRESS;
      reason = `课程进行中，预约${realBookings}/${minBookings}达标 → in_progress`;
      result.byAction = 'toInProgress';
    } else {
      // 人数不足 → cancelled
      targetStatus = SCHEDULE_STATUS.CANCELLED;
      reason = `已过上课时间，预约${realBookings}/${minBookings}不足 → cancelled`;
      result.byAction = 'toCancelled';
    }
  } else if (now.isAfter(bookingDeadlineTime)) {
    // 情况3：已过预约截止时间，未到上课时间
    if (realBookings < minBookings) {
      // 人数不足 → cancelled
      targetStatus = SCHEDULE_STATUS.CANCELLED;
      reason = `已过预约截止时间，预约${realBookings}/${minBookings}不足 → cancelled`;
      result.byAction = 'toCancelled';
    } else {
      // 人数达标 → 保持 available/full
      targetStatus = realBookings >= maxBookings ? SCHEDULE_STATUS.FULL : SCHEDULE_STATUS.AVAILABLE;
      reason = `已过预约截止时间，预约${realBookings}/${minBookings}达标，保持可预约`;
    }
  } else {
    // 情况4：未过预约截止时间 → 保持 available/full
    targetStatus = realBookings >= maxBookings ? SCHEDULE_STATUS.FULL : SCHEDULE_STATUS.AVAILABLE;
    reason = `未过预约截止时间，保持可预约`;
  }

  // 判断是否需要修复
  if (targetStatus !== schedule.status) {
    result.needFix = true;
    result.newStatus = targetStatus;
    result.reason = reason;

    // 如果目标状态不是终态，需要重建 PendingTask
    if (!TERMINAL_STATUSES.includes(targetStatus)) {
      result.rebuildTask = true;
    }
  } else if (schedule.status === SCHEDULE_STATUS.AVAILABLE || schedule.status === SCHEDULE_STATUS.FULL) {
    // 状态正确，但检查 PendingTask 是否完整
    const pendingTasks = await PendingTask.countDocuments({
      schedule_id: schedule._id,
      processed: 'pending',
    });
    if (pendingTasks < 3) {
      result.needFix = true;
      result.newStatus = schedule.status;
      result.reason = `状态正确但 PendingTask 不完整（${pendingTasks}/3），重建任务`;
      result.rebuildTask = true;
      result.byAction = schedule.status === SCHEDULE_STATUS.FULL ? 'toFull' : 'toAvailable';
    }
  }

  return result;
}

// 应用修复
async function applyFix(schedule, result) {
  // 更新状态
  if (result.newStatus !== schedule.status) {
    const updateData = { status: result.newStatus };

    // 如果是取消，补充取消原因
    if (result.newStatus === SCHEDULE_STATUS.CANCELLED) {
      updateData.cancel_reason = CANCEL_REASON.MIN_BOOKINGS_NOT_MET;
      updateData.cancel_type = 'min_bookings_not_met';
    }

    await Schedule.updateOne({ _id: schedule._id }, updateData);
  }

  // 重建 PendingTask
  if (result.rebuildTask) {
    const dateStr = normalizeDate(schedule.date);
    const startTimeStr = normalizeTime(schedule.start_time);
    const endTimeStr = normalizeTime(schedule.end_time);

    if (!dateStr || !startTimeStr || !endTimeStr) {
      console.log(`    ⚠️ PendingTask 重建跳过：时间字段异常`);
      return;
    }

    const startDateTime = dayjs.tz(dateStr + ' ' + startTimeStr, BEIJING_TZ);
    const endDateTime = dayjs.tz(dateStr + ' ' + endTimeStr, BEIJING_TZ);
    const deadlineMins = schedule.booking_deadline || 120;

    const checkTriggerAt = startDateTime.subtract(deadlineMins, 'minute').toDate();
    const startTriggerAt = startDateTime.toDate();
    const endTriggerAt = endDateTime.toDate();

    // 清理旧任务
    await PendingTask.deleteMany({ schedule_id: schedule._id });

    // 重建3个任务
    await PendingTask.insertMany([
      { schedule_id: schedule._id, trigger_at: checkTriggerAt, type: 'min_bookings_check' },
      { schedule_id: schedule._id, trigger_at: startTriggerAt, type: 'auto_check_in' },
      { schedule_id: schedule._id, trigger_at: endTriggerAt, type: 'class_complete' },
    ]);
  }
}

// ============ 入口 ============
async function main() {
  const isApply = process.argv.includes('--apply');
  const isYes = process.argv.includes('--yes');

  if (isApply && !isYes) {
    console.log('\n⚠️  您正在使用 --apply 模式，将实际修改数据库。');
    console.log('   请先执行预览模式（不带 --apply）确认结果，');
    console.log('   确认无误后添加 --yes 参数执行：');
    console.log('   node scripts/fix-schedule-status.js --apply --yes\n');
    process.exit(0);
  }

  const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

  console.log(`连接数据库: ${mongodbUri.replace(/\/\/.*@/, '//***@')}`);

  try {
    await mongoose.connect(mongodbUri);
    console.log('数据库连接成功\n');

    await fixScheduleStatus(isApply);

    await mongoose.disconnect();
    console.log('数据库连接已断开');
    process.exit(0);
  } catch (err) {
    console.error('\n执行失败:', err.message);
    console.error(err.stack);
    try { await mongoose.disconnect(); } catch (e) {}
    process.exit(1);
  }
}

main();
