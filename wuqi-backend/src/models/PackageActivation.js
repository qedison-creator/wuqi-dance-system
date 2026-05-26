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
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

packageActivationSchema.index({ user_package_id: 1 });
packageActivationSchema.index({ user_id: 1 });
packageActivationSchema.index({ package_id: 1 });
packageActivationSchema.index({ store_id: 1 });
packageActivationSchema.index({ activated_at: -1 });

module.exports = mongoose.model('PackageActivation', packageActivationSchema);
