const CoachAttendance = require('../models/CoachAttendance');
const Schedule = require('../models/Schedule');
const Booking = require('../models/Booking');

/**
 * 教练课时统计服务（独立审计、独立核算）
 * 与 Schedule 表解耦：即使 Schedule 被删除，CoachAttendance 仍保留课时数据
 */

/**
 * 记录教练课时（课程完成时调用）
 * 写入条件：status=completed
 * - checked_in_count > 0：正常计入课时
 * - checked_in_count = 0：标记 not_counted=true（不计课时，但留审计凭据）
 */
async function recordCoachAttendance(scheduleId) {
  try {
    const schedule = await Schedule.findById(scheduleId)
      .populate('coach_id', 'name')
      .populate('store_id', 'name')
      .populate('dance_style_id', 'name');

    if (!schedule) {
      console.warn(`[recordCoachAttendance] Schedule 不存在: ${scheduleId}`);
      return null;
    }

    // 已存在记录则跳过（幂等）
    const existing = await CoachAttendance.findOne({ schedule_id: scheduleId });
    if (existing) {
      return existing;
    }

    // 统计签到人数
    const checkedInCount = await Booking.countDocuments({
      schedule_id: scheduleId,
      status: 'completed',
      checked_in: true,
    });

    const coachName = schedule.coach_id?.name || '';
    const storeName = schedule.store_id?.name || '';
    const danceStyleName = schedule.dance_style_id?.name || '';

    const record = await CoachAttendance.create({
      coach_id: schedule.coach_id?._id || schedule.coach_id,
      schedule_id: schedule._id,
      store_id: schedule.store_id?._id || schedule.store_id,
      course_name: schedule.course_name || '',
      course_date: schedule.date,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      duration: schedule.duration || 0,
      dance_style_id: schedule.dance_style_id?._id || schedule.dance_style_id,
      dance_style_name: danceStyleName,
      checked_in_count: checkedInCount,
      status: 'completed',
      not_counted: checkedInCount === 0,
      not_counted_reason: checkedInCount === 0 ? '无签到人数，课程未实际开课' : null,
      coach_name: coachName,
      store_name: storeName,
      classroom: schedule.classroom || '',
    });

    console.log(`[recordCoachAttendance] 已记录教练课时: ${coachName} ${schedule.date} ${schedule.start_time} 签到${checkedInCount}人 ${checkedInCount > 0 ? '计入' : '不计入'}`);
    return record;
  } catch (err) {
    console.error(`[recordCoachAttendance] 执行失败 scheduleId=${scheduleId}:`, err.message);
    return null;
  }
}

/**
 * 获取教练课时统计
 * @param {String} coachId - 教练ID
 * @param {Object} dateRange - { start_date, end_date }
 * @param {Boolean} includeNotCounted - 是否包含不计课时的记录（默认 false）
 */
async function getCoachStats(coachId, dateRange = {}, includeNotCounted = false) {
  const filter = {
    coach_id: coachId,
    archived: false,
  };

  if (dateRange.start_date) {
    filter.course_date = filter.course_date || {};
    filter.course_date.$gte = dateRange.start_date;
  }
  if (dateRange.end_date) {
    filter.course_date = filter.course_date || {};
    filter.course_date.$lte = dateRange.end_date;
  }

  if (!includeNotCounted) {
    filter.not_counted = { $ne: true };
  }

  const records = await CoachAttendance.find(filter).sort({ course_date: -1, start_time: -1 });

  const totalClasses = records.filter(r => !r.not_counted).length;
  const totalCheckedIn = records.reduce((sum, r) => sum + (r.checked_in_count || 0), 0);
  const totalDuration = records
    .filter(r => !r.not_counted)
    .reduce((sum, r) => sum + (r.duration || 0), 0);

  return {
    records,
    summary: {
      total_classes: totalClasses,
      total_checked_in: totalCheckedIn,
      total_duration_minutes: totalDuration,
      total_hours: Math.round((totalDuration / 60) * 100) / 100,
    },
  };
}

/**
 * 批量获取教练课时统计（用于薪酬管理）
 * @param {Array} coachIds - 教练ID数组
 * @param {Object} dateRange - { start_date, end_date }
 */
async function getBatchCoachStats(coachIds, dateRange = {}) {
  const results = {};
  for (const coachId of coachIds) {
    results[coachId] = await getCoachStats(coachId, dateRange);
  }
  return results;
}

/**
 * 软删除教练课时记录（Schedule 删除时调用，不物理删除）
 */
async function archiveCoachAttendance(scheduleId) {
  try {
    const result = await CoachAttendance.updateMany(
      { schedule_id: scheduleId },
      { $set: { archived: true } }
    );
    return result;
  } catch (err) {
    console.error(`[archiveCoachAttendance] 执行失败 scheduleId=${scheduleId}:`, err.message);
    return null;
  }
}

module.exports = {
  recordCoachAttendance,
  getCoachStats,
  getBatchCoachStats,
  archiveCoachAttendance,
};
