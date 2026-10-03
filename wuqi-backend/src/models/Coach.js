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
  // 教练执教门店列表（多门店执教模型）：
  // [] 空数组 = 多门店执教（全门店共用，存量教练默认值，仅超管可编辑/删除/配置薪酬）
  // [storeA] = storeA 独占（该门店店长/员工可管理）
  // [storeA, storeB] = 多门店执教（storeA 和 storeB 可见可用）
  store_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
  // 按门店展示配置（各门店管理员在「门店教练」页统一维护，含多门店执教教练）：
  // 某门店无配置元素 = 回退全局值（sort_order / is_teaching 默认 true）
  // is_teaching=false 表示该教练不在该门店任教，会员端首页/教练列表不再展示
  store_configs: [{
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    sort_order: { type: Number, default: 0 },
    is_teaching: { type: Boolean, default: true },
    updated_at: { type: Date, default: Date.now },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

coachSchema.index({ name: 1 });
coachSchema.index({ status: 1 });
coachSchema.index({ store_id: 1 });
coachSchema.index({ store_ids: 1 });

module.exports = mongoose.model('Coach', coachSchema);
