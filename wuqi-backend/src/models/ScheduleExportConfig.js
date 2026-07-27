const mongoose = require('mongoose');

const scheduleExportConfigSchema = new mongoose.Schema({
  background_url: { type: String, required: true },
  background_name: { type: String, default: '' },
  is_active: { type: Boolean, default: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

scheduleExportConfigSchema.index({ is_active: 1 });
scheduleExportConfigSchema.index({ store_id: 1 });

module.exports = mongoose.model('ScheduleExportConfig', scheduleExportConfigSchema);
