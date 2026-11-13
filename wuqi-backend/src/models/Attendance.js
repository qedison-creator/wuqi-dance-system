const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  schedule_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    required: true,
    index: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  booking_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null,
  },
  store_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    index: true,
  },
  coach_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coach',
  },
  dance_style_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DanceStyle',
  },
  check_in_time: {
    type: Date,
    default: Date.now,
  },
  check_in_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  source: {
    type: String,
    enum: ['booking', 'onsite', 'admin'],
    default: 'booking',
    index: true,
  },
  check_in_method: {
    type: String,
    // scan=扫码签到（开课前）/ scan_ongoing=现场签到（进行中）/ scan_after=课后补签（已结束）
    // manual=人工签到（管理端手动选人，吸收历史 admin/onsite）；admin/onsite 仅历史兼容
    enum: ['scan', 'scan_ongoing', 'scan_after', 'manual', 'auto', 'onsite', 'admin', 'exempt_cancel', 'cancelled_after_checkin'],
    default: 'scan',
  },
  // 空降标记（签到时刻现场新建预约 = 无预约到店），罚课按钮仅对空降课显示
  is_walk_in: {
    type: Boolean,
    default: false,
  },
  credits_cost: {
    type: Number,
    default: 0,
  },
  date: {
    type: String,
    index: true,
  },
  course_name: {
    type: String,
    default: '',
  },
  remark: {
    type: String,
    default: '',
  },
  // === 课程快照字段（课程删除后仍可独立溯源）===
  start_time: {
    type: String,
    default: '',
  },
  end_time: {
    type: String,
    default: '',
  },
  duration: {
    type: Number,
    default: 0,
  },
  coach_name: {
    type: String,
    default: '',
  },
  store_name: {
    type: String,
    default: '',
  },
  // === 罚课（随关联 Booking 同步的罚课快照，会员端"我的记录"展示用）===
  penalty_credits: { type: Number, default: 0 },
  penalty_reason:  { type: String, default: '' },
  penalty_at:      { type: Date, default: null },
  penalty_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

AttendanceSchema.index({ schedule_id: 1, user_id: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);