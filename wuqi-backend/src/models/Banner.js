const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  image_url: { type: String, required: true },
  link_type: { type: String, enum: ['none', 'page', 'url', 'mini_program'], default: 'none' },
  link_value: { type: String },
  sort_order: { type: Number, default: 0 },
  start_date: { type: String },
  end_date: { type: String },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

bannerSchema.index({ sort_order: 1 });
bannerSchema.index({ status: 1 });
bannerSchema.index({ created_at: -1 });

module.exports = mongoose.model('Banner', bannerSchema);
