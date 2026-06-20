/**
 * 数据修复脚本：统一课程状态业务逻辑
 *
 * 修复内容：
 *   1. Schedule: 将旧的 cancelled_insufficient 状态迁移为 cancelled + cancel_reason='min_bookings_not_met'
 *   2. Booking: 将旧的 timeout cancel_type 迁移为 exempt（若 is_exempt=true）或 normal
 *   3. CoachAttendance: 为历史已完成课程回填教练课时记录
 *   4. Config: 确保 default_exemption_count 配置存在且值为 '2'
 *   5. User: 将 exemption_count 为 null/undefined 的用户补默认值 2
 *
 * 使用方法：
 *   1. 停止后端服务（建议低峰期执行）
 *   2. 先执行审计：node scripts/normalize-schedule-status.js --audit
 *   3. 查看审计结果，确认无异常后执行迁移：node scripts/normalize-schedule-status.js --migrate
 *   4. 迁移后再次审计验证：node scripts/normalize-schedule-status.js --audit
 *   5. 确认无误后重启后端服务
 */

const mongoose = require('mongoose');

// ========== 配置 ==========
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi_dance';

// ========== 连接数据库 ==========
async function main() {
  const mode = process.argv[2] || '--audit';
  console.log(`[Normalize] 模式: ${mode}`);
  console.log('[Normalize] 连接数据库...');
  await mongoose.connect(MONGO_URI);
  console.log('[Normalize] 数据库已连接\n');

  const db = mongoose.connection.db;
  const schedulesCol = db.collection('schedules');
  const bookingsCol = db.collection('bookings');
  const usersCol = db.collection('users');
  const configCol = db.collection('configs');
  const coachAttendanceCol = db.collection('coachattendances');

  if (mode === '--audit') {
    await audit(schedulesCol, bookingsCol, usersCol, configCol, coachAttendanceCol);
  } else if (mode === '--migrate') {
    await migrate(schedulesCol, bookingsCol, usersCol, configCol, coachAttendanceCol);
  } else {
    console.log('用法: node scripts/normalize-schedule-status.js [--audit|--migrate]');
    console.log('  --audit   只读审计，不修改数据');
    console.log('  --migrate 执行迁移修复');
  }

  await mongoose.disconnect();
  console.log('\n[Normalize] 数据库已断开，脚本结束');
}

// ========== 审计函数 ==========
async function audit(schedulesCol, bookingsCol, usersCol, configCol, coachAttendanceCol) {
  console.log('========== 数据审计报告 ==========\n');

  // 1. Schedule: cancelled_insufficient 状态
  const cancelledInsufficientCount = await schedulesCol.countDocuments({ status: 'cancelled_insufficient' });
  console.log(`[Schedule] cancelled_insufficient 状态记录: ${cancelledInsufficientCount}`);

  // 2. Schedule: cancelled 但无 cancel_reason 的记录
  const cancelledNoReason = await schedulesCol.countDocuments({
    status: 'cancelled',
    $or: [{ cancel_reason: null }, { cancel_reason: { $exists: false } }],
  });
  console.log(`[Schedule] cancelled 状态但无 cancel_reason: ${cancelledNoReason}`);

  // 3. Booking: timeout cancel_type
  const timeoutBookings = await bookingsCol.countDocuments({ cancel_type: 'timeout' });
  console.log(`[Booking] timeout cancel_type 记录: ${timeoutBookings}`);

  // 4. Booking: timeout 且 is_exempt 分布
  const timeoutExempt = await bookingsCol.countDocuments({ cancel_type: 'timeout', is_exempt: true });
  const timeoutNotExempt = await bookingsCol.countDocuments({ cancel_type: 'timeout', is_exempt: { $ne: true } });
  console.log(`[Booking] timeout + is_exempt=true: ${timeoutExempt} (将迁移为 exempt)`);
  console.log(`[Booking] timeout + is_exempt!=true: ${timeoutNotExempt} (将迁移为 normal)`);

  // 5. User: exemption_count 为 null/undefined
  const usersNoExemption = await usersCol.countDocuments({
    $or: [
      { exemption_count: null },
      { exemption_count: { $exists: false } },
    ],
  });
  console.log(`[User] exemption_count 缺失记录: ${usersNoExemption}`);

  // 6. User: exemption_count 分布
  const exemptionAgg = await usersCol.aggregate([
    { $group: { _id: '$exemption_count', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  console.log(`[User] exemption_count 分布:`);
  exemptionAgg.forEach(g => {
    console.log(`  值=${g._id === null ? 'null' : g._id === undefined ? 'undefined' : g._id}, 人数=${g.count}`);
  });

  // 7. Config: default_exemption_count
  const configDoc = await configCol.findOne({ key: 'default_exemption_count' });
  console.log(`[Config] default_exemption_count: ${configDoc ? `存在, 值='${configDoc.value}'` : '不存在'}`);

  // 8. CoachAttendance: 已有记录数
  const attendanceCount = await coachAttendanceCol.countDocuments({});
  console.log(`[CoachAttendance] 已有记录数: ${attendanceCount}`);

  // 9. Schedule: completed 状态但无对应 CoachAttendance 的记录
  const completedSchedules = await schedulesCol.find({ status: 'completed' }).project({ _id: 1, coach_id: 1, date: 1, course_name: 1, start_time: 1, end_time: 1, store_id: 1 }).toArray();
  let missingAttendance = 0;
  for (const sch of completedSchedules) {
    if (!sch.coach_id) continue;
    const exists = await coachAttendanceCol.findOne({ schedule_id: sch._id });
    if (!exists) missingAttendance++;
  }
  console.log(`[CoachAttendance] completed 课程缺教练课时记录: ${missingAttendance} (共 ${completedSchedules.length} 个已完成课程)`);

  console.log('\n========== 审计完成 ==========');
}

// ========== 迁移函数 ==========
async function migrate(schedulesCol, bookingsCol, usersCol, configCol, coachAttendanceCol) {
  console.log('========== 开始数据迁移 ==========\n');

  // 1. Schedule: cancelled_insufficient → cancelled + cancel_reason='min_bookings_not_met'
  const schResult = await schedulesCol.updateMany(
    { status: 'cancelled_insufficient' },
    { $set: { status: 'cancelled', cancel_reason: 'min_bookings_not_met' } }
  );
  console.log(`[Schedule] cancelled_insufficient → cancelled: 修改 ${schResult.modifiedCount} 条`);

  // 2. Schedule: cancelled 但无 cancel_reason 的，补默认值 admin_cancel
  const schNoReasonResult = await schedulesCol.updateMany(
    { status: 'cancelled', $or: [{ cancel_reason: null }, { cancel_reason: { $exists: false } }] },
    { $set: { cancel_reason: 'admin_cancel' } }
  );
  console.log(`[Schedule] cancelled 补 cancel_reason='admin_cancel': 修改 ${schNoReasonResult.modifiedCount} 条`);

  // 3. Booking: timeout + is_exempt=true → exempt
  const timeoutExemptResult = await bookingsCol.updateMany(
    { cancel_type: 'timeout', is_exempt: true },
    { $set: { cancel_type: 'exempt', exemption_used: true } }
  );
  console.log(`[Booking] timeout+is_exempt → exempt: 修改 ${timeoutExemptResult.modifiedCount} 条`);

  // 4. Booking: timeout + is_exempt!=true → normal
  const timeoutNormalResult = await bookingsCol.updateMany(
    { cancel_type: 'timeout', is_exempt: { $ne: true } },
    { $set: { cancel_type: 'normal' } }
  );
  console.log(`[Booking] timeout+非exempt → normal: 修改 ${timeoutNormalResult.modifiedCount} 条`);

  // 5. User: 补默认 exemption_count = 2
  const userResult = await usersCol.updateMany(
    { $or: [{ exemption_count: null }, { exemption_count: { $exists: false } }] },
    { $set: { exemption_count: 2 } }
  );
  console.log(`[User] 补 exemption_count=2: 修改 ${userResult.modifiedCount} 条`);

  // 6. Config: 确保 default_exemption_count = '2'
  const existingConfig = await configCol.findOne({ key: 'default_exemption_count' });
  if (!existingConfig) {
    await configCol.insertOne({
      key: 'default_exemption_count',
      value: '2',
      description: '新会员注册时的默认豁免取消次数',
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`[Config] 新增 default_exemption_count='2'`);
  } else if (existingConfig.value !== '2') {
    await configCol.updateOne(
      { key: 'default_exemption_count' },
      { $set: { value: '2', updated_at: new Date() } }
    );
    console.log(`[Config] 更新 default_exemption_count: '${existingConfig.value}' → '2'`);
  } else {
    console.log(`[Config] default_exemption_count 已为 '2'，无需修改`);
  }

  // 7. CoachAttendance: 回填历史已完成课程的教练课时记录
  console.log('\n[CoachAttendance] 开始回填教练课时记录...');
  const completedSchedules = await schedulesCol.find({ status: 'completed' })
    .project({ _id: 1, coach_id: 1, date: 1, course_name: 1, start_time: 1, end_time: 1, store_id: 1, dance_style_id: 1, duration: 1 })
    .toArray();
  let backfillCount = 0;
  let skipCount = 0;

  for (const sch of completedSchedules) {
    if (!sch.coach_id) {
      skipCount++;
      continue;
    }
    // 检查是否已有记录
    const exists = await coachAttendanceCol.findOne({ schedule_id: sch._id });
    if (exists) {
      skipCount++;
      continue;
    }

    // 统计该课程的签到人数
    const checkedInCount = await bookingsCol.countDocuments({
      schedule_id: sch._id,
      status: 'completed',
      checked_in: true,
    });

    await coachAttendanceCol.insertOne({
      coach_id: sch.coach_id,
      schedule_id: sch._id,
      store_id: sch.store_id || null,
      course_date: sch.date,
      course_name: sch.course_name || '',
      start_time: sch.start_time || '',
      end_time: sch.end_time || '',
      duration: sch.duration || 0,
      dance_style_id: sch.dance_style_id || null,
      checked_in_count: checkedInCount,
      not_counted: checkedInCount === 0,
      not_counted_reason: checkedInCount === 0 ? '历史数据回填：无签到记录' : null,
      archived: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    backfillCount++;
  }
  console.log(`[CoachAttendance] 回填 ${backfillCount} 条, 跳过 ${skipCount} 条（无教练或已存在）`);

  console.log('\n========== 迁移完成 ==========');
  console.log('建议：再次执行 --audit 验证迁移结果');
}

main().catch(err => {
  console.error('[Normalize] 脚本执行失败:', err);
  process.exit(1);
});
