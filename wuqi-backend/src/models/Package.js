const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  class_count: { type: Number, required: true },
  price: { type: Number, required: true },
  original_price: { type: Number },
  duration_days: { type: Number, required: true },
  dance_styles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DanceStyle' }],
  is_popular: { type: Boolean, default: false },
  sort_order: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

packageSchema.index({ name: 1 });
packageSchema.index({ status: 1 });
packageSchema.index({ sort_order: 1 });

module.exports = mongoose.model('Package', packageSchema);
