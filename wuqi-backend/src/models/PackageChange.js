/**
 * 套餐变更记录模型
 * 记录管理员修改会员套餐字段（如总次数、剩余次数、限制次数、有效期等）的历史
 * 用于"店务管理 → 套餐记录查询 → 套餐录入记录"TAB 中展示套餐变更明细
 */
const mongoose = require('mongoose');

const PackageChangeSchema = new mongoose.Schema({
  // 关联套餐
  user_package_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserPackage',
    index: true
  },
  // 会员
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  // 门店（用于单门店角色过滤）
  store_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    index: true
  },
  // 操作人
  operator_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  operator_name: {
    type: String,
    default: '系统'
  },
  // 变更明细列表：每个字段一条
  changes: [{
    field: { type: String, required: true },        // 字段名（英文 key，如 total_credits）
    field_label: { type: String, required: true },  // 字段中文名（如 总次数）
    old_value: { type: String, default: '' },        // 修改前的值（字符串）
    new_value: { type: String, default: '' }        // 修改后的值（字符串）
  }],
  remark: {
    type: String,
    default: ''
  },
  // 会员快照（防止会员删除后记录信息丢失）
  member_snapshot: {
    real_name: { type: String, default: '' },
    nick_name: { type: String, default: '' },
    phone: { type: String, default: '' },
    member_code: { type: String, default: '' }
  },
  // 套餐快照
  package_snapshot: {
    package_type: { type: String, default: '' },
    total_credits: { type: Number, default: 0 },
    duration_value: { type: Number, default: 0 },
    duration_unit: { type: String, default: '' }
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// 索引：按门店+创建时间倒序查询（套餐录入记录列表主要查询路径）
PackageChangeSchema.index({ store_id: 1, created_at: -1 });
// 索引：按会员查询
PackageChangeSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('PackageChange', PackageChangeSchema);
