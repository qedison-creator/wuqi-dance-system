const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  image_url: {
    type: String,
    required: true
  },
  thumbnail_url: {
    type: String,
    default: ''
  },
  coach_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coach'
  }],
  width: {
    type: Number,
    default: 0
  },
  height: {
    type: Number,
    default: 0
  },
  orientation: {
    type: String,
    enum: ['landscape', 'portrait', 'square'],
    default: 'landscape'
  },
  show_on_home: {
    type: Boolean,
    default: true
  },
  sort_order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// 索引
imageSchema.index({ coach_ids: 1 });
imageSchema.index({ show_on_home: 1, sort_order: -1 });
imageSchema.index({ created_at: -1 });

module.exports = mongoose.model('Image', imageSchema);