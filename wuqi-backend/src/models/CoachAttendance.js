const mongoose = require('mongoose');

/**
 * 教练课时记录（独立审计、独立核算）
 * 与 Schedule 表解耦：即使 Schedule 被删除，CoachAttendance 仍保留课时数据
 * 写入条件：课程状态变为 completed 且 checked_in_count > 0
 * 特殊标记：checked_in_count = 0 时标记 not_counted = true（不计课时，但留审计凭据）
 */
const coachAttendanceSchema = new mongoose.Schema({
  coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
  schedule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule' }, // 可能为 null（Schedule 已删除）
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  course_name: { type: String, default: '' },
  course_date: { type: String, required: true },       // 课程日期 YYYY-MM-DD
  start_time: { type: String, required: true },         // 开始时间 HH:mm
  end_time: { type: String, required: true },           // 结束时间 HH:mm
  duration: { type: Number, default: 75 },              // 课程时长（分钟）
  dance_style_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DanceStyle' },
  dance_style_name: { type: String, default: '' },
  checked_in_count: { type: Number, default: 0 },       // 签到人数
  status: { type: String, enum: ['completed'], default: 'completed' },
  not_counted: { type: Boolean, default: false },        // 是否不计课时（无签到人数时为 true）
  not_counted_reason: { type: String, default: null },   // 不计课时原因
  archived: { type: Boolean, default: false },            // 软删除标记（不物理删除）
  // 课程快照（独立溯源）
  coach_name: { type: String, default: '' },
  store_name: { type: String, default: '' },
  classroom: { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

coachAttendanceSchema.index({ coach_id: 1, course_date: -1 });
coachAttendanceSchema.index({ schedule_id: 1 });
coachAttendanceSchema.index({ store_id: 1, course_date: -1 });
coachAttendanceSchema.index({ archived: 1 });

module.exports = mongoose.model('CoachAttendance', coachAttendanceSchema);
