const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
  dance_style_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DanceStyle', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  date: { type: String, required: true },
  start_time: { type: String, required: true },
  end_time: { type: String, required: true },
  max_bookings: { type: Number, default: 20 },
  min_bookings: { type: Number, default: 5 },
  current_bookings: { type: Number, default: 0 },
  status: { type: String, enum: ['available', 'full', 'cancelled', 'offline', 'not_open', 'completed'], required: true, default: 'available' },
  cancel_reason: { type: String },
  cancel_type: { type: String },
  note: { type: String },
  schedule_type: { type: String, enum: ['group', 'private', 'trial'], default: 'group' },
  course_name: { type: String },
  classroom: { type: String },
  duration: { type: Number, default: 75 },
  booking_deadline: { type: Number, default: 120 },
  cancel_deadline: { type: Number, default: 60 },
  credits_cost: { type: Number, default: 1 },
  from_template: { type: Boolean, default: false },
  remark: { type: String },
  cover: { type: String },
  cycle_config: { type: mongoose.Schema.Types.Mixed },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

scheduleSchema.index({ coach_id: 1, date: 1 });
scheduleSchema.index({ store_id: 1, date: 1 });
scheduleSchema.index({ store_id: 1, weekday: 1 });
scheduleSchema.index({ dance_style_id: 1 });
scheduleSchema.index({ date: 1, start_time: 1 });
scheduleSchema.index({ status: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);
