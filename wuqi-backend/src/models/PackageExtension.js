const mongoose = require('mongoose');

const packageExtensionSchema = new mongoose.Schema({
  user_package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPackage', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  operation_type: { type: String, enum: ['extend', 'revoke'], required: true },
  extend_days: { type: Number },
  original_expire_at: { type: Date, required: true },
  new_expire_at: { type: Date, required: true },
  holiday_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Holiday' },
  operated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revoked_extension_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PackageExtension' },
  reason: { type: String },
  remark: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

packageExtensionSchema.index({ user_package_id: 1 });
packageExtensionSchema.index({ user_id: 1 });
packageExtensionSchema.index({ package_id: 1 });
packageExtensionSchema.index({ store_id: 1 });
packageExtensionSchema.index({ created_at: -1 });

module.exports = mongoose.model('PackageExtension', packageExtensionSchema);
