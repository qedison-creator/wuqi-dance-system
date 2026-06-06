const mongoose = require('mongoose');

const userPackageSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  package_type: { type: String, enum: ['count_card', 'time_card'], required: true, default: 'count_card' },
  total_credits: { type: Number, required: true },
  remaining_credits: { type: Number, required: true },
  duration_value: { type: Number },
  duration_unit: { type: String, enum: ['month', 'day'], default: 'month' },
  start_date: { type: Date },
  end_date: { type: Date },
  original_end_date: { type: Date },
  daily_limit: { type: Number },
  weekly_limit: { type: Number },
  used_count_current_period: { type: Number, default: 0 },
  period_start_date: { type: Date },
  // 激活相关
  is_activated: { type: Boolean, default: false },
  activated_at: { type: Date },
  auto_activate_at: { type: Date },
  // 停卡相关
  is_suspended: { type: Boolean, default: false },
  suspended_at: { type: Date },
  suspend_end_date: { type: Date },
  frozen_remaining_credits: { type: Number },
  frozen_end_date: { type: Date },
  // 状态：pending(待激活) / active(使用中) / exhausted(已用完) / expired(已过期)
  status: { type: String, enum: ['pending', 'active', 'expired', 'exhausted'], required: true, default: 'pending' },
  extension_days: { type: Number, default: 0 },
  extension_reason: { type: String },
  remark: { type: String },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // 提醒相关
  last_expire_reminded_at: { type: Date },
  last_low_count_reminded_at: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

userPackageSchema.index({ user_id: 1, status: 1 });
userPackageSchema.index({ user_id: 1, store_id: 1, status: 1 });
userPackageSchema.index({ status: 1 });
userPackageSchema.index({ end_date: 1 });
userPackageSchema.index({ auto_activate_at: 1 });

module.exports = mongoose.model('UserPackage', userPackageSchema);
