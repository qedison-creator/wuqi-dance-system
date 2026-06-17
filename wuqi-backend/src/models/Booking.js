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
  cancel_type: { type: String, enum: ['normal', 'timeout', 'exempt', 'admin_cancel', 'min_bookings_not_met', 'holiday'] },
  cancel_time: { type: Date },
  credits_deducted: { type: Number, default: 1 },
  credits_refunded: { type: Number, default: 0 },
  exemption_used: { type: Boolean, default: false },
  checked_in: { type: Boolean, default: false },
  check_in_time: { type: Date },
  checked_in_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // 关联套餐
  user_package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPackage' },
  source: { type: String, enum: ['member', 'onsite', 'admin'], default: 'member' },
  // 上课提醒发送状态
  reminder_1h_sent: { type: Boolean, default: false },
  reminder_30m_sent: { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

bookingSchema.index({ user_id: 1, booking_date: 1 });
bookingSchema.index({ user_id: 1, schedule_id: 1 });
bookingSchema.index({ schedule_id: 1 });
bookingSchema.index({ schedule_id: 1, status: 1 });
bookingSchema.index({ coach_id: 1, booking_date: 1 });
bookingSchema.index({ store_id: 1, booking_date: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ created_at: -1 });

module.exports = mongoose.model('Booking', bookingSchema);
