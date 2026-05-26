const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  cover_url: { type: String },
  video_url: { type: String, required: true },
  duration: { type: Number },
  dance_style_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DanceStyle' },
  coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach' },
  is_free: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 },
  view_count: { type: Number, default: 0 },
  like_count: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

videoSchema.index({ title: 1 });
videoSchema.index({ dance_style_id: 1 });
videoSchema.index({ coach_id: 1 });
videoSchema.index({ status: 1 });
videoSchema.index({ sort_order: 1 });
videoSchema.index({ created_at: -1 });

module.exports = mongoose.model('Video', videoSchema);
