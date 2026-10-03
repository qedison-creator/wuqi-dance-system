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

// 费率版本化：改价 = 关闭当前行（is_active=false, effective_to=新生效日）+ 新开一行
// 唯一约束只对启用中的版本生效（部分唯一索引），历史版本行永久保留，
// 供"按上课日期匹配当时费率"使用（教练删除后历史统计不受影响的关键）。
coachSalarySchema.index(
  { coach_id: 1, store_id: 1, duration: 1 },
  {
    unique: true,
    partialFilterExpression: { is_active: true },
    name: 'uniq_active_coach_store_duration',
  }
);
coachSalarySchema.index({ coach_id: 1 });
coachSalarySchema.index({ store_id: 1 });
coachSalarySchema.index({ is_active: 1 });

const CoachSalary = mongoose.model('CoachSalary', coachSalarySchema);

// 同步索引：旧的全局唯一索引（含软删行，阻止版本化）由 syncIndexes 自动删除，
// 新的部分唯一索引按显式名创建，幂等操作
CoachSalary.syncIndexes().catch(err => {
  console.error('[CoachSalary] syncIndexes failed:', err.message);
});

module.exports = CoachSalary;
