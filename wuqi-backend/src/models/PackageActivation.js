const mongoose = require('mongoose');

const packageActivationSchema = new mongoose.Schema({
  user_package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPackage', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  package_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  activation_type: { type: String, enum: ['first_booking', 'manual_force'], required: true },
  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  activated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  activated_at: { type: Date, required: true, default: Date.now },
  remark: { type: String },
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
    package_type: { type: String, default: '' },
    total_credits: { type: Number, default: 0 },
    duration_value: { type: Number, default: 0 },
    duration_unit: { type: String, default: '' },
    start_date: { type: Date },
    end_date: { type: Date },
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

packageActivationSchema.index({ user_package_id: 1 });
packageActivationSchema.index({ user_id: 1 });
packageActivationSchema.index({ package_id: 1 });
packageActivationSchema.index({ store_id: 1 });
packageActivationSchema.index({ activated_at: -1 });

module.exports = mongoose.model('PackageActivation', packageActivationSchema);
