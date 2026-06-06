const mongoose = require('mongoose');

const danceStyleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  icon_url: { type: String },
  cover_url: { type: String },
  sort_order: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

danceStyleSchema.index({ sort_order: 1 });
danceStyleSchema.index({ status: 1 });

module.exports = mongoose.model('DanceStyle', danceStyleSchema);
