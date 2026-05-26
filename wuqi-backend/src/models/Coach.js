const mongoose = require('mongoose');

// 数组长度验证函数
function arrayLimit(val) {
  return val && val.length <= 9;
}

const coachSchema = new mongoose.Schema({
  name: { type: String, required: true },
  avatar_url: { type: String },
  gender: { type: Number, default: 0 },
  phone: { type: String },
  introduction: { type: String },
  dance_styles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DanceStyle' }],
  gallery: {
    type: [{ type: String }],
    validate: [arrayLimit, '相册最多9张照片']
  },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

coachSchema.index({ name: 1 });
coachSchema.index({ status: 1 });
coachSchema.index({ store_id: 1 });

module.exports = mongoose.model('Coach', coachSchema);
