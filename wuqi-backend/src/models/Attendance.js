const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  schedule_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    required: true,
    index: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  booking_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null,
  },
  store_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    index: true,
  },
  coach_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coach',
  },
  dance_style_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DanceStyle',
  },
  check_in_time: {
    type: Date,
    default: Date.now,
  },
  check_in_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  source: {
    type: String,
    enum: ['booking', 'onsite', 'admin'],
    default: 'booking',
    index: true,
  },
  check_in_method: {
    type: String,
    enum: ['scan', 'auto', 'exempt_cancel'],
    default: 'scan',
  },
  credits_cost: {
    type: Number,
    default: 0,
  },
  date: {
    type: String,
    index: true,
  },
  course_name: {
    type: String,
    default: '',
  },
  remark: {
    type: String,
    default: '',
  },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

AttendanceSchema.index({ schedule_id: 1, user_id: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);