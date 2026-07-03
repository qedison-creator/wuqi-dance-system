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
  // @deprecated 已迁移至 Image 模型，请使用 /images 接口管理图片
  gallery: {
    type: [{ type: String }],
    validate: [arrayLimit, '相册最多9张照片']
  },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
  sort_order: { type: Number, default: 0 },
  show_on_home: { type: Boolean, default: true },
  // 软删除标记：true 表示已删除，不再在教练列表中显示
  // 但历史关联数据（课程/预约/签到/取消记录）通过 populate 仍能获取教练信息
  is_deleted: { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

coachSchema.index({ name: 1 });
coachSchema.index({ status: 1 });
coachSchema.index({ store_id: 1 });

module.exports = mongoose.model('Coach', coachSchema);
