const mongoose = require('mongoose');

const PendingTaskSchema = new mongoose.Schema({
  schedule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: true },
  user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  trigger_at: { type: Date, required: true },
  type:       { type: String, enum: ['class_reminder_1h', 'class_reminder_30m', 'min_bookings_check', 'auto_check_in', 'class_complete'], required: true },
  processed:  { type: String, enum: ['pending', 'sending', 'done'], default: 'pending' },
  updated_at: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now }
});

PendingTaskSchema.index({ trigger_at: 1, processed: 1 });
PendingTaskSchema.index({ schedule_id: 1, type: 1 });

module.exports = mongoose.model('PendingTask', PendingTaskSchema);