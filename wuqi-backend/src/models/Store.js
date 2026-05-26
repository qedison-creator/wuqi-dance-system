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
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

storeSchema.index({ name: 1 });
storeSchema.index({ status: 1 });

module.exports = mongoose.model('Store', storeSchema);