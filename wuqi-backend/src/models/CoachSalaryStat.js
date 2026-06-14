const mongoose = require('mongoose');

const coachSalaryStatSchema = new mongoose.Schema({
  coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  schedule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: true },
  class_date: { type: Date, required: true },
  duration: { type: Number, required: true },
  attendance_count: { type: Number, default: 0 },
  salary_rate: { type: Number, required: true },
  total_salary: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'settled', 'cancelled'], default: 'pending' },
  settled_at: { type: Date },
  settled_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  remark: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

coachSalaryStatSchema.index({ coach_id: 1, store_id: 1 });
coachSalaryStatSchema.index({ coach_id: 1 });
coachSalaryStatSchema.index({ store_id: 1 });
coachSalaryStatSchema.index({ booking_id: 1 });
coachSalaryStatSchema.index({ schedule_id: 1 });
coachSalaryStatSchema.index({ class_date: -1 });
coachSalaryStatSchema.index({ status: 1 });

module.exports = mongoose.model('CoachSalaryStat', coachSalaryStatSchema);
