/* 历史数据回填：签到方式口径统一（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 全局口径表（2026-11-17 定稿，与 booking.service.js / 三端显示层一致）：
 *   开课前扫码（有预约）           scan          扫码签到
 *   开课前扫码（无预约空降）       scan          扫码签到
 *   开课自动签到                   auto          自动签到
 *   课程进行中扫码（必然无预约）   scan_ongoing  现场签到
 *   课程结束后扫码（必然无预约）   scan_after    课后补签
 *   人工选人签有预约会员           manual        人工签到
 *   人工选人签无预约会员           manual        人工签到
 *
 * 关键事实：修复前管理端 check-in 请求从不携带 encrypted_token（扫码仅用于打开会员档案），
 * 后端无法区分「扫码进入」与「搜索会员号人工选人」。因此历史空降记录（is_walk_in/source='onsite'）
 * 全部来自现场模式人工选人 → 应为 manual；扫码空降（rows 2/4/5）自本次修复（前端携带 token）起才可能出现。
 *
 * 规则：
 *   [1] check_in_method='scan' 且非空降的 Booking/Attendance：按 check_in_time 与课程时间（北京时间）重分类
 *       （修复时区 bug：旧公式在 UTC+8 服务器上把"课中"误判成"开课前"）
 *   [2] source='onsite' 或 check_in_method='onsite' 的记录：补 is_walk_in=true（Booking/Attendance 各自独立处理）
 *   [3] 兜底：check_in_method ∈ {scan, scan_ongoing, scan_after} 且 booking 在签到时刻新建
 *       （created_at 与 check_in_time 相差 <5 分钟）→ 补 is_walk_in=true，并同步其 Attendance
 *   [4] 空降记录（is_walk_in=true）的 scan 系/onsite/admin 存储值 → 统一迁移为 'manual'（历史空降均为人工选人）
 *   [5] 残留的 'onsite'/'admin' 存储值 → 统一迁移为 'manual'（显示层原本就映射「人工签到」，存储口径归一）
 *
 * 幂等：可重复执行；已是目标状态的记录跳过。
 *
 * 用法（脚本自动读后端根目录 .env，也可显式传 MONGODB_URI 覆盖）：
 *  node scripts/migrate-checkin-method.js            # 预览
 *  node scripts/migrate-checkin-method.js --apply    # 写库
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const APPLY = process.argv.includes('--apply');

// 空降兜底判定：booking 创建时刻与签到时刻相差小于 5 分钟视为"签到时刻新建"
const WALK_IN_CREATED_DIFF_MS = 5 * 60 * 1000;

/**
 * 按签到时刻（UTC Date）与课程时间（北京时间口径的 date/start_time/end_time）判定签到方式
 * 与 booking.service.js 的 resolveScanMethod 保持一致
 * @returns {'scan'|'scan_ongoing'|'scan_after'|null} 课程信息缺失时返回 null（跳过）
 */
function classifyScanMethod(checkInTime, schedule) {
  if (!checkInTime || !schedule || !schedule.date) return null;
  const now = checkInTime;
  // 北京时间：从 UTC 显式平移 +8h（与服务器本地时区无关，修复旧 getTimezoneOffset 公式在 UTC+8 服务器上差 8 小时的问题）
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const bjDate = bj.toISOString().slice(0, 10);
  const toMin = (t) => {
    if (!t) return null;
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  if (bjDate > schedule.date) return 'scan_after';
  if (bjDate < schedule.date) return 'scan';
  const curMin = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  const startMin = toMin(schedule.start_time) ?? 0;
  const endMin = toMin(schedule.end_time) ?? (startMin + 60);
  if (curMin < startMin) return 'scan';
  if (curMin <= endMin) return 'scan_ongoing';
  return 'scan_after';
}

/**
 * 执行回填逻辑（供 CLI 与冒烟脚本共用）
 * @param {Object} opts
 * @param {boolean} opts.apply - true 写库，false 仅统计
 * @returns {Promise<Object>} 统计结果
 */
async function runMigration({ apply = false } = {}) {
  const Booking = require('../src/models/Booking');
  const Attendance = require('../src/models/Attendance');
  require('../src/models/Schedule'); // 注册 Schedule 模型，供 populate('schedule_id') 使用

  const result = {
    // [1] scan 重分类（仅非空降记录）
    scanBookingCandidates: 0, scanBookingUpdated: 0, scanBookingSkippedNoSchedule: 0, scanBookingDist: {},
    scanAttendanceCandidates: 0, scanAttendanceUpdated: 0, scanAttendanceSkippedNoSchedule: 0, scanAttendanceDist: {},
    // [2] 空降标记（source/method='onsite'）
    walkInBookingCandidates: 0, walkInBookingUpdated: 0,
    walkInAttendanceCandidates: 0, walkInAttendanceUpdated: 0,
    // [3] 兜底（签到时刻新建的 scan 系 booking）
    fallbackBookingCandidates: 0, fallbackBookingUpdated: 0, fallbackAttendanceSynced: 0,
    // [4] 空降记录 scan 系/onsite/admin → manual
    walkInManualBookingCandidates: 0, walkInManualBookingUpdated: 0,
    walkInManualAttendanceCandidates: 0, walkInManualAttendanceUpdated: 0,
    // [5] 残留 onsite/admin → manual
    legacyMethodBookingCandidates: 0, legacyMethodBookingUpdated: 0,
    legacyMethodAttendanceCandidates: 0, legacyMethodAttendanceUpdated: 0,
  };

  // ---- [1] check_in_method='scan' 重分类（排除空降记录——历史空降均为人工选人，由 [4] 归一为 manual）----
  const scanBookings = await Booking.find({
    check_in_method: 'scan',
    source: { $ne: 'onsite' },
    is_walk_in: { $ne: true },
  })
    .select('schedule_id check_in_time created_at')
    .populate('schedule_id', 'date start_time end_time')
    .lean();
  for (const b of scanBookings) {
    const method = classifyScanMethod(b.check_in_time || b.created_at, b.schedule_id);
    if (!method) { result.scanBookingSkippedNoSchedule++; continue; }
    if (method === 'scan') continue; // 课程开始前签到，本就是目标状态
    result.scanBookingCandidates++;
    result.scanBookingDist[method] = (result.scanBookingDist[method] || 0) + 1;
    if (apply) {
      await Booking.updateOne({ _id: b._id }, { $set: { check_in_method: method } });
      result.scanBookingUpdated++;
    }
  }

  const scanAttendances = await Attendance.find({
    check_in_method: 'scan',
    is_walk_in: { $ne: true },
  })
    .select('schedule_id check_in_time created_at date start_time end_time')
    .populate('schedule_id', 'date start_time end_time')
    .lean();
  for (const a of scanAttendances) {
    // 课程已删除时回退到 Attendance 快照字段（date/start_time/end_time）
    const schedule = a.schedule_id && a.schedule_id.date
      ? a.schedule_id
      : { date: a.date, start_time: a.start_time, end_time: a.end_time };
    const method = classifyScanMethod(a.check_in_time || a.created_at, schedule);
    if (!method) { result.scanAttendanceSkippedNoSchedule++; continue; }
    if (method === 'scan') continue;
    result.scanAttendanceCandidates++;
    result.scanAttendanceDist[method] = (result.scanAttendanceDist[method] || 0) + 1;
    if (apply) {
      await Attendance.updateOne({ _id: a._id }, { $set: { check_in_method: method } });
      result.scanAttendanceUpdated++;
    }
  }

  // ---- [2] 空降标记：source='onsite' 或 method='onsite' ----
  const walkInCond = {
    is_walk_in: { $ne: true },
    $or: [{ source: 'onsite' }, { check_in_method: 'onsite' }],
  };
  result.walkInBookingCandidates = await Booking.countDocuments(walkInCond);
  if (apply && result.walkInBookingCandidates > 0) {
    const r = await Booking.updateMany(walkInCond, { $set: { is_walk_in: true } });
    result.walkInBookingUpdated = r.modifiedCount;
  }
  result.walkInAttendanceCandidates = await Attendance.countDocuments(walkInCond);
  if (apply && result.walkInAttendanceCandidates > 0) {
    const r = await Attendance.updateMany(walkInCond, { $set: { is_walk_in: true } });
    result.walkInAttendanceUpdated = r.modifiedCount;
  }

  // ---- [3] 兜底：签到时刻新建的 scan 系 booking（在 [1] 之后执行，覆盖已重分类的记录）----
  const fallbackCandidates = (await Booking.find({
    check_in_method: { $in: ['scan', 'scan_ongoing', 'scan_after'] },
    is_walk_in: { $ne: true },
    source: { $ne: 'onsite' },
    check_in_time: { $ne: null },
  }).select('created_at check_in_time').lean())
    .filter((b) => Math.abs(new Date(b.check_in_time).getTime() - new Date(b.created_at).getTime()) < WALK_IN_CREATED_DIFF_MS);
  result.fallbackBookingCandidates = fallbackCandidates.length;
  if (fallbackCandidates.length > 0) {
    const fallbackIds = fallbackCandidates.map((b) => b._id);
    if (apply) {
      const r = await Booking.updateMany({ _id: { $in: fallbackIds } }, { $set: { is_walk_in: true } });
      result.fallbackBookingUpdated = r.modifiedCount;
      const ra = await Attendance.updateMany(
        { booking_id: { $in: fallbackIds }, is_walk_in: { $ne: true } },
        { $set: { is_walk_in: true } }
      );
      result.fallbackAttendanceSynced = ra.modifiedCount;
    }
  }

  // ---- [4] 空降记录归一：历史空降（is_walk_in=true）的 scan 系/onsite/admin → manual ----
  // 须在 [2]/[3] 之后执行，覆盖刚被标记为空降的记录。
  // 历史空降全部来自现场模式人工选人（前端此前不携带 encrypted_token），按口径表应为 manual。
  const walkInManualBookingCond = {
    is_walk_in: true,
    check_in_method: { $in: ['scan', 'scan_ongoing', 'scan_after', 'onsite', 'admin'] },
  };
  result.walkInManualBookingCandidates = await Booking.countDocuments(walkInManualBookingCond);
  if (apply && result.walkInManualBookingCandidates > 0) {
    const r = await Booking.updateMany(walkInManualBookingCond, { $set: { check_in_method: 'manual' } });
    result.walkInManualBookingUpdated = r.modifiedCount;
  }
  const walkInManualAttendanceCond = {
    is_walk_in: true,
    check_in_method: { $in: ['scan', 'scan_ongoing', 'scan_after', 'onsite', 'admin'] },
  };
  result.walkInManualAttendanceCandidates = await Attendance.countDocuments(walkInManualAttendanceCond);
  if (apply && result.walkInManualAttendanceCandidates > 0) {
    const r = await Attendance.updateMany(walkInManualAttendanceCond, { $set: { check_in_method: 'manual' } });
    result.walkInManualAttendanceUpdated = r.modifiedCount;
  }

  // ---- [5] 残留归一：非空降记录中残留的 'onsite'/'admin' → manual ----
  // 显示层原本就映射为「人工签到」，仅存储口径归一。
  const legacyMethodBookingCond = { check_in_method: { $in: ['onsite', 'admin'] } };
  result.legacyMethodBookingCandidates = await Booking.countDocuments(legacyMethodBookingCond);
  if (apply && result.legacyMethodBookingCandidates > 0) {
    const r = await Booking.updateMany(legacyMethodBookingCond, { $set: { check_in_method: 'manual' } });
    result.legacyMethodBookingUpdated = r.modifiedCount;
  }
  const legacyMethodAttendanceCond = { check_in_method: { $in: ['onsite', 'admin'] } };
  result.legacyMethodAttendanceCandidates = await Attendance.countDocuments(legacyMethodAttendanceCond);
  if (apply && result.legacyMethodAttendanceCandidates > 0) {
    const r = await Attendance.updateMany(legacyMethodAttendanceCond, { $set: { check_in_method: 'manual' } });
    result.legacyMethodAttendanceUpdated = r.modifiedCount;
  }

  return result;
}

async function main() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`[migrate] 数据库: ${db.databaseName}  模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览，加 --apply 执行）'}`);

  const r = await runMigration({ apply: APPLY });

  console.log('\n===== 迁移汇总 =====');
  console.log(`[1] Booking  scan 重分类: 待处理 ${r.scanBookingCandidates} 条${APPLY ? `，已更新 ${r.scanBookingUpdated} 条` : ''}，分布 ${JSON.stringify(r.scanBookingDist)}，课程缺失跳过 ${r.scanBookingSkippedNoSchedule} 条`);
  console.log(`[1] Attendance scan 重分类: 待处理 ${r.scanAttendanceCandidates} 条${APPLY ? `，已更新 ${r.scanAttendanceUpdated} 条` : ''}，分布 ${JSON.stringify(r.scanAttendanceDist)}，课程缺失跳过 ${r.scanAttendanceSkippedNoSchedule} 条`);
  console.log(`[2] 空降标记 is_walk_in=true（source/method='onsite'）: Booking ${r.walkInBookingCandidates} 条${APPLY ? `，已更新 ${r.walkInBookingUpdated} 条` : ''}；Attendance ${r.walkInAttendanceCandidates} 条${APPLY ? `，已更新 ${r.walkInAttendanceUpdated} 条` : ''}`);
  console.log(`[3] 兜底（签到时刻新建的扫码 booking）: ${r.fallbackBookingCandidates} 条${APPLY ? `，已标记 ${r.fallbackBookingUpdated} 条，同步 Attendance ${r.fallbackAttendanceSynced} 条` : ''}`);
  console.log(`[4] 空降记录归一（is_walk_in=true 的 scan系/onsite/admin → manual）: Booking ${r.walkInManualBookingCandidates} 条${APPLY ? `，已更新 ${r.walkInManualBookingUpdated} 条` : ''}；Attendance ${r.walkInManualAttendanceCandidates} 条${APPLY ? `，已更新 ${r.walkInManualAttendanceUpdated} 条` : ''}`);
  console.log(`[5] 残留归一（onsite/admin → manual）: Booking ${r.legacyMethodBookingCandidates} 条${APPLY ? `，已更新 ${r.legacyMethodBookingUpdated} 条` : ''}；Attendance ${r.legacyMethodAttendanceCandidates} 条${APPLY ? `，已更新 ${r.legacyMethodAttendanceUpdated} 条` : ''}`);
  if (!APPLY) console.log('\n预览完成。确认无误后加 --apply 执行写库。');

  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[migrate] 执行失败:', err);
    process.exit(1);
  });
}

exports.runMigration = runMigration;
