const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String },
  phone: { type: String },
  description: { type: String },
  images: [{ type: String }],
  nav_name: { type: String },
  location: {
    latitude: { type: Number },
    longitude: { type: Number }
  },
  business_hours: {
    start: { type: String, default: '09:00' },
    end: { type: String, default: '22:00' },
  },
  // 门店级默认豁免次数（为空时使用全局默认配置 default_exemption_count）
  default_exemption_count: { type: Number, default: null },
  // 门店级预约开放窗口天数（为空时使用全局默认配置 booking_window_days）
  booking_window_days: { type: Number, default: null },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

storeSchema.index({ name: 1 });
storeSchema.index({ status: 1 });

module.exports = mongoose.model('Store', storeSchema);