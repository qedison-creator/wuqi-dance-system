const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  description: { type: String },
  group: { type: String, default: 'general' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

systemConfigSchema.index({ key: 1 }, { unique: true });
systemConfigSchema.index({ group: 1 });

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
