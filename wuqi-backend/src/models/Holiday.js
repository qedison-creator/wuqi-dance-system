const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: String, required: true },
  end_date: { type: String },
  is_recurring: { type: Boolean, default: false },
  type: { type: String, enum: ['holiday', 'maintenance', 'custom'], default: 'holiday' },
  description: { type: String },
  status: { type: String, enum: ['active', 'disabled', 'cancelled'], required: true, default: 'active' },
  // 扩展字段
  store_scope: { type: String, enum: ['all', 'single'], default: 'all' },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

holidaySchema.index({ date: 1 });
holidaySchema.index({ type: 1 });
holidaySchema.index({ status: 1 });

module.exports = mongoose.model('Holiday', holidaySchema);
