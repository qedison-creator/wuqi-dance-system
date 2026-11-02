const mongoose = require('mongoose');

const waitlistSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  schedule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  // closed = 临近开课统一结束排队（未候补成功），区别于 expired（课程取消/人数不足解散）
  status: { type: String, enum: ['waiting', 'notified', 'booked', 'expired', 'cancelled', 'closed'], required: true, default: 'waiting' },
  position: { type: Number, default: 1 },
  notified_at: { type: Date },
  expire_at: { type: Date },
  remark: { type: String },
  // === 课程快照字段（课程删除后仍可独立溯源）===
  course_name:   { type: String, default: '' },
  schedule_date: { type: String, default: '' },
  start_time:    { type: String, default: '' },
  end_time:      { type: String, default: '' },
  coach_name:    { type: String, default: '' },
  store_name:    { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

waitlistSchema.index({ user_id: 1, schedule_id: 1 }, { unique: true });
waitlistSchema.index({ schedule_id: 1, status: 1 });
waitlistSchema.index({ status: 1, created_at: 1 });

module.exports = mongoose.model('Waitlist', waitlistSchema);
