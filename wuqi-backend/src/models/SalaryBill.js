const mongoose = require('mongoose');

/**
 * 薪酬账单（结算凭证）
 * 生成时按当时的费率解析结果快照汇总；删除账单会作废其名下全部课薪台账。
 * warnings 记录生成时未匹配到费率配置的项（按 ¥0 计），提示补配置后重新生成。
 */
const salaryBillSchema = new mongoose.Schema({
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  coaches: [{
    coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
    coach_name: { type: String },
    items: [{
      duration: { type: Number },
      store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
      store_name: { type: String },
      count: { type: Number },
      rate: { type: Number },
      amount: { type: Number },
    }],
    total_amount: { type: Number },
  }],
  warnings: [{ type: String }],
  // 未入账课程按 教练+时长+门店 归并的结构化记录（生成时快照）
  unresolved_groups: { type: Array, default: [] },
  skipped_count: { type: Number, default: 0 },
  total_amount: { type: Number, default: 0 },
  coach_count: { type: Number, default: 0 },
  generated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  created_at: { type: Date, default: Date.now },
});

salaryBillSchema.index({ created_at: -1 });
salaryBillSchema.index({ store_id: 1, start_date: 1, end_date: 1 });

module.exports = mongoose.model('SalaryBill', salaryBillSchema);
