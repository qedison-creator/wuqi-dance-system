const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  schedule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: true },
  coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
  dance_style_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DanceStyle', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  booking_date: { type: String, required: true },
  booking_time: { type: String, required: true },
  status: { type: String, enum: ['booked', 'cancelled', 'completed'], required: true, default: 'booked' },
  cancel_reason: { type: String },
  cancelled_at: { type: Date },
  is_exempt: { type: Boolean, default: false },
  remark: { type: String },
  cancel_type: { type: String, enum: ['normal', 'exempt', 'quick', 'admin_cancel', 'min_bookings_not_met', 'holiday', 'after_checkin_cancel'] },
  cancel_time: { type: Date },
  credits_deducted: { type: Number, default: 1 },
  credits_refunded: { type: Number, default: 0 },
  exemption_used: { type: Boolean, default: false },
  checked_in: { type: Boolean, default: false },
  check_in_time: { type: Date },
  check_in_method: { type: String, enum: ['scan', 'auto', 'onsite', 'admin'], default: null },
  checked_in_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // 关联套餐
  user_package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPackage' },
  source: { type: String, enum: ['member', 'onsite', 'admin'], default: 'member' },
  // 是否为截止预约时间后的补约（true 时适用5分钟快速取消规则）
  is_late_booking: { type: Boolean, default: false },
  // 上课提醒发送状态
  reminder_1h_sent: { type: Boolean, default: false },
  reminder_30m_sent: { type: Boolean, default: false },
  // === 课程快照字段（课程删除后仍可独立溯源）===
  course_name:         { type: String, default: '' },
  schedule_date:       { type: String, default: '' },
  schedule_start_time: { type: String, default: '' },
  schedule_end_time:   { type: String, default: '' },
  schedule_duration:   { type: Number, default: 0 },
  coach_name:          { type: String, default: '' },
  store_name:          { type: String, default: '' },
  dance_style_name:    { type: String, default: '' },
  classroom:           { type: String, default: '' },
  credits_cost:        { type: Number, default: 0 },
  max_bookings:        { type: Number, default: 0 },
  // === 按天口径缩短有效期的天数（时间卡：不限次卡/每天1节卡扣N(N≥2)课时的课）===
  // 预约创建时套餐 end_date 已同步缩短 N 天；取消/退还时按此值加回。展示层据此显示"缩短有效期N天"
  shrink_days:         { type: Number },
  // === 会员快照（数据中心课时账单溯源）===
  // 会员被删除后，账单仍完整显示姓名/编号/手机号
  member_snapshot: {
    real_name:  { type: String, default: '' },
    nick_name:  { type: String, default: '' },
    member_code: { type: String, default: '' },
    phone:      { type: String, default: '' },
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

bookingSchema.index({ user_id: 1, booking_date: 1 });
bookingSchema.index({ user_id: 1, schedule_id: 1 });
bookingSchema.index({ schedule_id: 1 });
bookingSchema.index({ schedule_id: 1, status: 1 });
bookingSchema.index({ coach_id: 1, booking_date: 1 });
bookingSchema.index({ store_id: 1, booking_date: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ created_at: -1 });

// 会员快照构造：数据中心课时账单溯源用（会员删除后账单仍完整）
bookingSchema.statics.buildMemberSnapshot = function (user) {
  if (!user) return undefined;
  return {
    real_name: user.real_name || '',
    nick_name: user.nick_name || '',
    member_code: user.member_code || '',
    phone: user.phone || '',
  };
};
// 独立索引：管理端按日期查询预约记录（无 user_id/store_id 前缀时使用）
bookingSchema.index({ booking_date: -1, created_at: -1 });

module.exports = mongoose.model('Booking', bookingSchema);
