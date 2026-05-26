const mongoose = require('mongoose');

const coachSalarySchema = new mongoose.Schema({
  coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  duration: { type: Number, required: true },
  salary_rate: { type: Number, required: true },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  is_active: { type: Boolean, default: true },
  effective_from: { type: Date, default: Date.now },
  effective_to: { type: Date },
  remark: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

coachSalarySchema.index({ coach_id: 1, duration: 1 }, { unique: true });
coachSalarySchema.index({ coach_id: 1 });
coachSalarySchema.index({ store_id: 1 });
coachSalarySchema.index({ is_active: 1 });

module.exports = mongoose.model('CoachSalary', coachSalarySchema);
