const mongoose = require('mongoose');

const packageExtensionSchema = new mongoose.Schema({
  user_package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPackage', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  operation_type: { type: String, enum: ['extend', 'revoke'], required: true },
  extend_days: { type: Number },
  // 延长原始输入值与单位（day/month），便于前端准确还原显示
  extend_value: { type: Number, default: 0 },
  extend_unit: { type: String, enum: ['day', 'month'], default: 'day' },
  original_expire_at: { type: Date, required: true },
  new_expire_at: { type: Date, required: true },
  holiday_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Holiday' },
  operated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revoked_extension_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PackageExtension' },
  reason: { type: String },
  remark: { type: String },
  // 快照字段：即使会员/套餐被删除，记录信息也不丢失
  member_snapshot: {
    real_name: { type: String, default: '' },
    nick_name: { type: String, default: '' },
    phone: { type: String, default: '' },
    member_code: { type: String, default: '' },
  },
  package_snapshot: {
    name: { type: String, default: '' },
    package_type: { type: String, default: '' },
    total_credits: { type: Number, default: 0 },
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

packageExtensionSchema.index({ user_package_id: 1 });
packageExtensionSchema.index({ user_id: 1 });
packageExtensionSchema.index({ package_id: 1 });
packageExtensionSchema.index({ store_id: 1 });
packageExtensionSchema.index({ created_at: -1 });

module.exports = mongoose.model('PackageExtension', packageExtensionSchema);
