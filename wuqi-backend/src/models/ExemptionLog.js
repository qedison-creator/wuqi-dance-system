const mongoose = require('mongoose');

const exemptionLogSchema = new mongoose.Schema({
  // 会员ID
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // 关联的预约ID
  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  // 变更类型: 'use' 使用, 'add' 增加, 'deduct' 扣除, 'reset' 重置
  type: { type: String, enum: ['use', 'add', 'deduct', 'reset'], required: true },
  // 变更数量（正数为增加，负数为减少）
  delta: { type: Number, required: true },
  // 变更前数量
  before_count: { type: Number, required: true },
  // 变更后数量
  after_count: { type: Number, required: true },
  // 原因说明
  reason: { type: String, default: '' },
  // 操作人ID
  operator_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // 操作人名称（冗余存储，方便查询）
  operator_name: { type: String, default: '' }
}, { 
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// 索引优化查询
exemptionLogSchema.index({ user_id: 1, created_at: -1 });
exemptionLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('ExemptionLog', exemptionLogSchema);
