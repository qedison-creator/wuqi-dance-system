const mongoose = require('mongoose');

const transferRequestSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  from_store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  to_store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  reason: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], required: true, default: 'pending' },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewed_at: { type: Date },
  reject_reason: { type: String },
  remark: { type: String }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

transferRequestSchema.index({ user_id: 1, status: 1 });
transferRequestSchema.index({ status: 1 });
transferRequestSchema.index({ from_store_id: 1, to_store_id: 1 });

module.exports = mongoose.model('TransferRequest', transferRequestSchema);