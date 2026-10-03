const mongoose = require('mongoose');

/**
 * 数据中心提醒"已联系"标记
 * 一条提醒（会员 × 类型 × 周期键）只标记一次，重复标记幂等覆盖。
 * period_key 示例：'2026-10-05_30d'（沉睡/到期的快照周期）、'2026-10'（当月高频取消）
 */
const dcAlertFollowupSchema = new mongoose.Schema({
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true },
  member_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  alert_type: { type: String, enum: ['expiring', 'low_credits', 'dormant', 'expired_not_renewed', 'high_cancel', 'first_class'], required: true },
  period_key: { type: String, default: '' },
  operator_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  operator_name: { type: String, default: '' },
  remark: { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: true } });

dcAlertFollowupSchema.index({ member_id: 1, alert_type: 1, period_key: 1 }, { unique: true });

module.exports = mongoose.model('DcAlertFollowup', dcAlertFollowupSchema);
