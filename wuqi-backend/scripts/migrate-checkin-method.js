/* 历史数据回填：签到方式三分（扫码签到/现场签到/课后补签）+ 空降标记 is_walk_in（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 背景：2026-11 签到体系重构——
 *   1. 扫码签到按签到时刻与课程时间关系细分为三种存储值：
 *      课程开始前 → 'scan'（扫码签到）；课程进行中 → 'scan_ongoing'（现场签到）；课程已结束 → 'scan_after'（课后补签）
 *   2. 新增 Booking/Attendance.is_walk_in 字段承载"无预约空降"身份（罚课按钮展示与后端校验依据）
 *   3. 'admin'/'onsite' 历史存储值不迁移，仅显示层映射为「人工签到」；新数据统一写 'manual'
 *
 * 历史数据口径（与旧版代码核对）：
 *   - 扫码已预约：check_in_method='scan'、source='booking'   → [1] 按时间重分类，非空降
 *   - 扫码+无预约（现场模式）：check_in_method='onsite'、source='onsite' → [2] 补空降标记
 *   - 手动选人已预约：check_in_method='admin'、source='booking' → [4] 不处理
 *   - 手动选人无预约：check_in_method='onsite'、source='onsite' → [2] 补空降标记
 *
 * 规则：
 *   [1] check_in_method='scan' 的 Booking/Attendance：按 check_in_time 与课程时间（北京时间）重分类
 *   [2] source='onsite' 或 check_in_method='onsite' 的记录：补 is_walk_in=true（Booking/Attendance 各自独立处理）
 *   [3] 兜底：check_in_method ∈ {scan, scan_ongoing, scan_after} 且 booking 在签到时刻新建
 *       （created_at 与 check_in_time 相差 <5 分钟）→ 补 is_walk_in=true，并同步其 Attendance
 *       （正常情况下空降记录 source 必为 'onsite'，已被 [2] 覆盖；本条为极端漏网数据兜底）
 *   [4] 'admin'/'auto' 记录不处理（显示层映射「人工签到」/「自动签到」）
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
  // 北京时间（UTC+8）
  const bj = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
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
    // [1] scan 重分类
    scanBookingCandidates: 0, scanBookingUpdated: 0, scanBookingSkippedNoSchedule: 0, scanBookingDist: {},
    scanAttendanceCandidates: 0, scanAttendanceUpdated: 0, scanAttendanceSkippedNoSchedule: 0, scanAttendanceDist: {},
    // [2] 空降标记（source/method='onsite'）
    walkInBookingCandidates: 0, walkInBookingUpdated: 0,
    walkInAttendanceCandidates: 0, walkInAttendanceUpdated: 0,
    // [3] 兜底（签到时刻新建的 scan 系 booking）
    fallbackBookingCandidates: 0, fallbackBookingUpdated: 0, fallbackAttendanceSynced: 0,
  };

  // ---- [1] check_in_method='scan' 重分类 ----
  const scanBookings = await Booking.find({ check_in_method: 'scan' })
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

  const scanAttendances = await Attendance.find({ check_in_method: 'scan' })
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
  console.log('[4] admin/onsite 存储值不迁移，显示层映射为「人工签到」。');
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
