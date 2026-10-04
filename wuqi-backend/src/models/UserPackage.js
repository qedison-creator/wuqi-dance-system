const mongoose = require('mongoose');

const userPackageSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  extra_store_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
  package_type: { type: String, enum: ['count_card', 'time_card'], required: true, default: 'count_card' },
  total_credits: { type: Number, required: true },
  // 原始录入总次数（创建时设置，修改 total_credits 时不变）
  // 用于"套餐录入记录"中显示原始录入值，而非修改后的值
  original_total_credits: { type: Number },
  remaining_credits: { type: Number, required: true },
  duration_value: { type: Number },
  duration_unit: { type: String, enum: ['month', 'day'], default: 'month' },
  start_date: { type: Date },
  end_date: { type: Date },
  original_end_date: { type: Date },
  // 按天口径（不限次/每天1节时间卡）历史缩期追溯迁移标记：
  // 非空 = 该套餐已按历史预约 shrink_days 之和追溯缩短过 end_date，天数记录于此（迁移脚本幂等依据）
  retro_shrink_applied_days: { type: Number },
  daily_limit: { type: Number },
  weekly_limit: { type: Number },
  monthly_limit: { type: Number },
  // 舞种限制：空数组=不限舞种；非空=仅限这些舞种的课程可预约
  dance_style_limit: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DanceStyle' }],
  // 可用星期限制：空数组/缺省=整周可用；非空=仅可在这些星期使用（0=周日，1=周一…6=周六，与 Date.getDay 一致）
  weekday_limit: [{ type: Number, min: 0, max: 6 }],
  // 可用时段限制（双边界独立开关，均可空=不限；同开时 before 必须 < after）：
  //   usable_before 非空 = 仅开课时间 < 该时刻的课可用（「20:30前可用」）
  //   usable_after  非空 = 仅开课时间 > 该时刻的课可用（「18:00后可用」）
  //   两者同开 = 时段前之前 或 时段后之后 可用，介于两者之间禁用（前须早于后）
  usable_before: { type: String, default: '' },
  usable_after: { type: String, default: '' },
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
  // 快照字段：即使会员/套餐被删除，记录信息也不丢失
  member_snapshot: {
    real_name: { type: String, default: '' },
    nick_name: { type: String, default: '' },
    phone: { type: String, default: '' },
    wechat_phone: { type: String, default: '' },
    member_code: { type: String, default: '' },
  },
  package_snapshot: {
    name: { type: String, default: '' },
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, strictPopulate: false });

userPackageSchema.index({ user_id: 1, status: 1 });
userPackageSchema.index({ user_id: 1, store_id: 1, status: 1 });
userPackageSchema.index({ status: 1 });
userPackageSchema.index({ end_date: 1 });
userPackageSchema.index({ auto_activate_at: 1 });

module.exports = mongoose.model('UserPackage', userPackageSchema);
