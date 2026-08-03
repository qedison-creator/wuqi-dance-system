const mongoose = require('mongoose');

const operationLogSchema = new mongoose.Schema({
  operator_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  operator_name: { type: String },
  action: { type: String, required: true },
  module: { type: String, required: true },
  target_id: { type: mongoose.Schema.Types.ObjectId },
  target_type: { type: String },
  detail: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  result: { type: String, enum: ['success', 'failure'], default: 'success' },
  ip: { type: String },
  user_agent: { type: String },
  // 操作所属门店（用于门店数据隔离，存量日志无此字段仅超管可见）
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

operationLogSchema.index({ operator_id: 1 });
operationLogSchema.index({ module: 1 });
operationLogSchema.index({ action: 1 });
operationLogSchema.index({ created_at: -1 });
operationLogSchema.index({ store_id: 1 });

module.exports = mongoose.model('OperationLog', operationLogSchema);
