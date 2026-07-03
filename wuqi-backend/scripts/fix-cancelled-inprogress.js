/**
 * 一次性数据修复脚本：修复"管理员中途取消 in_progress 课程但状态仍为 completed"的历史数据
 *
 * 两种用法：
 *
 * 【模式A：自动扫描】
 *   预览：node scripts/fix-cancelled-inprogress.js
 *   修复：node scripts/fix-cancelled-inprogress.js --apply
 *   修复（跳过确认）：node scripts/fix-cancelled-inprogress.js --apply --yes
 *
 * 【模式B：按日期+时间精准定位】（适合 cancelSchedule 完全没执行的情况）
 *   预览：node scripts/fix-cancelled-inprogress.js --date 2026-07-04 --start 02:39
 *   修复：node scripts/fix-cancelled-inprogress.js --date 2026-07-04 --start 02:39 --apply
 *   修复（跳过确认）：node scripts/fix-cancelled-inprogress.js --date 2026-07-04 --start 02:39 --apply --yes
 *
 *   可选参数：
 *     --end 03:54       进一步限定下课时间
 *     --name 关键字      按课程名模糊匹配
 *     --store 门店ID     按门店过滤
 *     --reason "原因"    自定义取消原因
 */

const mongoose = require('mongoose');

// ============ 配置 ============
// 数据库名从 .env 读取：MONGODB_URI=mongodb://localhost:27017/wuqi_dance
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wuqi_dance';

function log(...args) {
  console.log(...args);
}

// ============ 参数解析 ============
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    apply: args.includes('--apply'),
    yes: args.includes('--yes'),
    date: null,
    start: null,
    end: null,
    name: null,
    store: null,
    reason: '管理员中途取消',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) opts.date = args[++i];
    else if (args[i] === '--start' && args[i + 1]) opts.start = args[++i];
    else if (args[i] === '--end' && args[i + 1]) opts.end = args[++i];
    else if (args[i] === '--name' && args[i + 1]) opts.name = args[++i];
    else if (args[i] === '--store' && args[i + 1]) opts.store = args[++i];
    else if (args[i] === '--reason' && args[i + 1]) opts.reason = args[++i];
  }
  return opts;
}

// ============ 主逻辑 ============
async function main() {
  const opts = parseArgs();
  const targetedMode = !!(opts.date || opts.start || opts.end || opts.name);

  log('========================================');
  log('  修复脚本：in_progress 课程中途取消后状态异常');
  if (targetedMode) {
    log(`  模式: 🎯 精准定位`);
    if (opts.date)  log(`  日期: ${opts.date}`);
    if (opts.start) log(`  开始: ${opts.start}`);
    if (opts.end)   log(`  结束: ${opts.end}`);
    if (opts.name)  log(`  课程: ${opts.name}`);
    if (opts.store) log(`  门店: ${opts.store}`);
  } else {
    log(`  模式: 🔍 自动扫描所有 completed 课程`);
  }
  log(`  执行: ${opts.apply ? '⚡ 修复' : '👀 预览（不修改数据）'}`);
  log('========================================\n');

  await mongoose.connect(MONGODB_URI);
  log(`✅ 已连接数据库: ${MONGODB_URI}\n`);

  const db = mongoose.connection.db;
  const ScheduleCol = db.collection('schedules');
  const BookingCol = db.collection('bookings');
  const AttendanceCol = db.collection('attendances');
  const CoachAttendanceCol = db.collection('coachattendances');
  const UserPackageCol = db.collection('userpackages');

  // ============ 构建查询条件 ============
  let scheduleQuery = {};

  if (targetedMode) {
    if (opts.date) scheduleQuery.date = opts.date;
    if (opts.start) scheduleQuery.start_time = opts.start;
    if (opts.end) scheduleQuery.end_time = opts.end;
    if (opts.store) {
      try { scheduleQuery.store_id = new mongoose.Types.ObjectId(opts.store); }
      catch (e) { scheduleQuery.store_id = opts.store; }
    }
    if (opts.name) scheduleQuery.course_name = { $regex: opts.name, $options: 'i' };
  } else {
    scheduleQuery = { status: 'completed' };
  }

  log(`📋 查询条件: ${JSON.stringify(scheduleQuery)}\n`);

  const schedules = await ScheduleCol.find(scheduleQuery).toArray();
  log(`📋 查询到 ${schedules.length} 条课程\n`);

  if (schedules.length === 0) {
    log('❌ 没有查询到符合条件的课程！');
    log('   请检查日期、时间格式是否正确（日期：YYYY-MM-DD，时间：HH:MM）');
    log('   也可以用 mongosh 查询确认:');
    log('   use wuqi_dance');
    log('   db.schedules.find({ date: "2026-07-04", start_time: "02:39" }).pretty()');
    await mongoose.disconnect();
    return;
  }

  const abnormalSchedules = [];

  for (const schedule of schedules) {
    const scheduleId = schedule._id;
    const scheduleName = schedule.course_name || '未命名课程';
    const scheduleDate = schedule.date || '';
    const startTime = schedule.start_time || '';
    const endTime = schedule.end_time || '';

    log('----------------------------------------');
    log(`课程: ${scheduleName}`);
    log(`日期时间: ${scheduleDate} ${startTime}-${endTime}`);
    log(`Schedule ID: ${scheduleId}`);
    log(`Schedule 状态: ${schedule.status}`);
    log(`Schedule cancel_type: ${schedule.cancel_type || '无'}`);
    log(`Schedule cancel_reason: ${schedule.cancel_reason || '无'}`);

    // 查询所有 booking
    const bookings = await BookingCol.find({ schedule_id: scheduleId }).toArray();
    log(`预约记录 (${bookings.length} 条):`);
    for (const b of bookings) {
      log(`  - booking ${b._id}`);
      log(`    user_id=${b.user_id}`);
      log(`    status=${b.status}, cancel_type=${b.cancel_type || '无'}, cancel_reason=${b.cancel_reason || '无'}`);
      log(`    checked_in=${b.checked_in}, check_in_method=${b.check_in_method || '无'}`);
      log(`    credits_deducted=${b.credits_deducted}, credits_refunded=${b.credits_refunded}`);
      log(`    user_package_id=${b.user_package_id || '无'}`);
    }

    // 查询 attendance
    const attendances = await AttendanceCol.find({ schedule_id: scheduleId }).toArray();
    log(`上课记录 (${attendances.length} 条):`);
    for (const att of attendances) {
      log(`  - attendance ${att._id}, user=${att.user_id}, method=${att.check_in_method}, remark=${att.remark || '无'}`);
    }

    // 查询 CoachAttendance
    const coachAttendances = await CoachAttendanceCol.find({ schedule_id: scheduleId }).toArray();
    log(`教练课时记录 (${coachAttendances.length} 条):`);
    for (const ca of coachAttendances) {
      log(`  - coachattendance ${ca._id}, coach=${ca.coach_id}`);
    }
    log('');

    // ============ 判断是否需要修复 ============
    let needFix = false;
    let fixReason = '';

    if (targetedMode) {
      // 精准模式：用户指定了这节课被中途取消，直接修复
      const hasCheckedIn = bookings.some(b => b.status === 'completed' || b.checked_in);
      if (hasCheckedIn) {
        needFix = true;
        fixReason = '用户确认这节课被中途取消，且有会员签到';
      } else if (schedule.status === 'in_progress' || schedule.status === 'completed') {
        needFix = true;
        fixReason = '用户确认这节课被中途取消';
      }
    } else {
      // 自动扫描模式
      const hasAdminCancel = bookings.some(b => {
        if (b.cancel_type === 'admin_cancel' || b.cancel_type === 'after_checkin_cancel') return true;
        if (b.status === 'cancelled' && b.cancel_type !== 'min_bookings_not_met' && b.cancel_type !== 'holiday') return true;
        return false;
      });
      const scheduleCancelled = schedule.cancel_type === 'admin_cancel' || schedule.cancel_type === 'after_checkin_cancel';
      if (hasAdminCancel || scheduleCancelled) {
        needFix = true;
        fixReason = '自动扫描检测到取消记录但 schedule 状态异常';
      }
    }

    if (needFix) {
      abnormalSchedules.push({
        schedule,
        scheduleId,
        scheduleName,
        scheduleDate,
        startTime,
        endTime,
        bookings: bookings.map(b => ({
          booking_id: b._id,
          user_id: b.user_id,
          status: b.status,
          cancel_type: b.cancel_type || '',
          cancel_reason: b.cancel_reason || '',
          checked_in: b.checked_in,
          check_in_method: b.check_in_method || '',
          credits_deducted: b.credits_deducted || 0,
          credits_refunded: b.credits_refunded || 0,
          user_package_id: b.user_package_id,
        })),
        attendances,
        coachAttendances,
        fixReason,
      });
    }
  }

  log('\n========================================');
  log(`🔍 需要修复的课程: ${abnormalSchedules.length} 条`);
  log('========================================\n');

  if (abnormalSchedules.length === 0) {
    log('✅ 没有发现需要修复的课程。');
    await mongoose.disconnect();
    return;
  }

  for (const item of abnormalSchedules) {
    log(`📌 ${item.scheduleName} ${item.scheduleDate} ${item.startTime}-${item.endTime}`);
    log(`   修复原因: ${item.fixReason}`);
  }

  if (!opts.apply) {
    log('\n👀 以上为预览结果。如需执行修复，请加 --apply 参数');
    await mongoose.disconnect();
    return;
  }

  // 确认执行
  if (!opts.yes) {
    log('\n⚠️  即将修复以上异常数据。');
    log('   修复内容：');
    log('   1. schedule.status → cancelled, cancel_type → after_checkin_cancel');
    log('   2. booking.status → cancelled, cancel_type → after_checkin_cancel');
    log('   3. 已签到的 attendance → 标记为 cancelled_after_checkin');
    log('   4. 未签到的 attendance → 删除');
    log('   5. CoachAttendance → 删除');
    log('   6. UserPackage → 退还课时');
    log('\n请确认后输入 yes 继续：');
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question('', resolve));
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      log('已取消修复。');
      await mongoose.disconnect();
      return;
    }
  }

  // ============ 执行修复 ============
  log('\n⚡ 开始执行修复...\n');

  let fixedCount = 0;
  let bookingFixedCount = 0;
  let attendanceMarkedCount = 0;
  let attendanceDeletedCount = 0;
  let coachAttendanceDeletedCount = 0;
  let creditsRefundedCount = 0;

  for (const item of abnormalSchedules) {
    const { scheduleId, schedule, bookings, coachAttendances } = item;
    const cancelReason = opts.reason || schedule.cancel_reason || '管理员中途取消';

    log(`修复课程: ${item.scheduleName} ${item.scheduleDate} ${item.startTime}-${item.endTime}`);

    // 1. 修复 schedule 状态
    await ScheduleCol.updateOne(
      { _id: scheduleId },
      { $set: {
        status: 'cancelled',
        cancel_type: 'after_checkin_cancel',
        cancel_reason: 'admin_cancel',
      }}
    );
    log(`  ✅ schedule.status → cancelled`);
    fixedCount++;

    // 2. 修复 booking
    for (const b of bookings) {
      const wasCheckedIn = b.status === 'completed' || b.checked_in;

      // 检查是否已经修复过
      if (b.status === 'cancelled' && b.cancel_type === 'after_checkin_cancel') {
        log(`  ⏭️  booking ${b.booking_id} 已修复过，跳过`);
        continue;
      }

      await BookingCol.updateOne(
        { _id: b.booking_id },
        { $set: {
          status: 'cancelled',
          cancel_type: 'after_checkin_cancel',
          cancel_time: b.cancel_time || new Date(),
          cancel_reason: cancelReason,
          credits_refunded: b.credits_deducted,
          checked_in: false,
          check_in_time: null,
        }}
      );
      bookingFixedCount++;
      log(`  ✅ booking ${b.booking_id} → cancelled (wasCheckedIn=${wasCheckedIn})`);

      // 3. 处理 attendance
      if (wasCheckedIn) {
        // 已签到的：标记为 cancelled_after_checkin
        const attResult = await AttendanceCol.updateOne(
          { schedule_id: scheduleId, user_id: b.user_id },
          { $set: {
            check_in_method: 'cancelled_after_checkin',
            remark: cancelReason,
          }}
        );
        if (attResult.matchedCount > 0) {
          attendanceMarkedCount++;
          log(`  ✅ attendance 标记为 cancelled_after_checkin`);
        } else {
          log(`  ⚠️  booking 显示已签到但 attendance 不存在（数据不一致，跳过）`);
        }
      } else {
        // 未签到的：删除 attendance（如果存在）
        const delResult = await AttendanceCol.deleteOne({
          schedule_id: scheduleId,
          user_id: b.user_id,
        });
        if (delResult.deletedCount > 0) {
          attendanceDeletedCount++;
          log(`  ✅ attendance 已删除（未签到）`);
        }
      }

      // 4. 退还课时
      if (b.user_id && b.credits_deducted > 0) {
        // 检查是否已退还过（避免重复退还）
        if (b.credits_refunded >= b.credits_deducted) {
          log(`  ⏭️  课时已退还过，跳过`);
          continue;
        }

        const pkg = b.user_package_id
          ? await UserPackageCol.findOne({ _id: b.user_package_id })
          : await UserPackageCol.findOne({ user_id: b.user_id, store_id: schedule.store_id, status: 'active' });

        if (pkg) {
          await UserPackageCol.updateOne(
            { _id: pkg._id },
            { $inc: { remaining_credits: b.credits_deducted } }
          );
          if (pkg.status === 'exhausted') {
            await UserPackageCol.updateOne(
              { _id: pkg._id },
              { $set: { status: 'active' } }
            );
          }
          creditsRefundedCount++;
          log(`  ✅ 退还课时 ${b.credits_deducted} 到套餐 ${pkg._id} (当前剩余 ${pkg.remaining_credits})`);
        } else {
          log(`  ⚠️  未找到对应套餐，无法退还课时（user_id=${b.user_id}）`);
        }
      }
    }

    // 5. 删除 CoachAttendance
    if (coachAttendances.length > 0) {
      await CoachAttendanceCol.deleteMany({ schedule_id: scheduleId });
      coachAttendanceDeletedCount += coachAttendances.length;
      log(`  ✅ 删除 ${coachAttendances.length} 条 CoachAttendance`);
    }

    log('');
  }

  // ============ 修复结果汇总 ============
  log('========================================');
  log('  修复完成！');
  log('========================================');
  log(`修复课程数:           ${fixedCount}`);
  log(`修复预约数:           ${bookingFixedCount}`);
  log(`标记 attendance:      ${attendanceMarkedCount} 条（签到后取消）`);
  log(`删除 attendance:      ${attendanceDeletedCount} 条（未签到）`);
  log(`删除 CoachAttendance: ${coachAttendanceDeletedCount} 条`);
  log(`退还课时套餐数:       ${creditsRefundedCount} 个`);
  log('========================================');
  log('\n💡 修复完成后，请重启后端服务让缓存生效：');
  log('   pm2 restart wuqi-backend  (或对应的 pm2 进程名)');
  log('   会员端/管理端需要下拉刷新或重新进入页面\n');

  await mongoose.disconnect();
  log('✅ 已断开数据库连接');
}

main().catch(err => {
  console.error('❌ 修复脚本执行失败:', err);
  process.exit(1);
});
