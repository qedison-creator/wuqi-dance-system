const mongoose = require('mongoose');

/**
 * 课薪台账（settlement ledger）
 * 生成账单时逐课写入，作为"这节课已入账"的唯一事实来源：
 * - salary_rate / total_salary 为入账时按上课日期解析的费率快照，此后改配置不影响已入账记录
 * - salary_config_id 引用当时的费率版本行，用于版本锁定判断（已入账的版本不可原地改价）
 * - 账单删除时 status 置为 voided，对应课程回到"未入账"状态，可重新生成
 */
const coachSalaryStatSchema = new mongoose.Schema({
  coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  schedule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: true },
  bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SalaryBill' },
  class_date: { type: Date, required: true },
  duration: { type: Number, required: true },
  attendance_count: { type: Number, default: 0 },
  salary_rate: { type: Number, required: true },
  total_salary: { type: Number, required: true },
  salary_config_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CoachSalary' },
  status: { type: String, enum: ['active', 'voided'], default: 'active' },
  remark: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

coachSalaryStatSchema.index({ schedule_id: 1, status: 1 });
coachSalaryStatSchema.index({ salary_config_id: 1, status: 1 });
coachSalaryStatSchema.index({ bill_id: 1 });
coachSalaryStatSchema.index({ coach_id: 1, store_id: 1 });
coachSalaryStatSchema.index({ class_date: -1 });

module.exports = mongoose.model('CoachSalaryStat', coachSalaryStatSchema);
