const mongoose = require('mongoose');

const operationLogSchema = new mongoose.Schema({
  operator_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  operator_name: { type: String },
  action: { type: String, required: true },
  module: { type: String, required: true },
  target_id: { type: mongoose.Schema.Types.ObjectId },
  target_type: { type: String },
  detail: { type: String },
  result: { type: String, enum: ['success', 'failure'], default: 'success' },
  ip: { type: String },
  user_agent: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

operationLogSchema.index({ operator_id: 1 });
operationLogSchema.index({ module: 1 });
operationLogSchema.index({ action: 1 });
operationLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('OperationLog', operationLogSchema);
