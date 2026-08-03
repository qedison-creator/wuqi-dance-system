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
  // 门店归属：null=多门店展示（存量默认值，仅超管可操作）；ObjectId=指定门店展示
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

bannerSchema.index({ sort_order: 1 });
bannerSchema.index({ status: 1 });
bannerSchema.index({ created_at: -1 });
bannerSchema.index({ store_id: 1 });

module.exports = mongoose.model('Banner', bannerSchema);
