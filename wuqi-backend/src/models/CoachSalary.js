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

// 唯一索引：同一教练在同一门店（含null=多门店执教）的同一时长只能有一条配置
// 支持同一教练在不同门店设置不同薪酬
coachSalarySchema.index({ coach_id: 1, store_id: 1, duration: 1 }, { unique: true });
coachSalarySchema.index({ coach_id: 1 });
coachSalarySchema.index({ store_id: 1 });
coachSalarySchema.index({ is_active: 1 });

const CoachSalary = mongoose.model('CoachSalary', coachSalarySchema);

// 同步索引：删除旧的 { coach_id: 1, duration: 1 } 唯一索引，创建新的复合唯一索引
// 在连接建立后自动执行，幂等操作
CoachSalary.syncIndexes().catch(err => {
  console.error('[CoachSalary] syncIndexes failed:', err.message);
});

module.exports = CoachSalary;
