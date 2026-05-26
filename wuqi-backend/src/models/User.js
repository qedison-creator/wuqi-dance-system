const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  openid: { type: String, unique: true, sparse: true },
  unionid: { type: String },
  nick_name: { type: String },
  avatar_url: { type: String },
  phone: { type: String },
  wechat_phone: { type: String },
  reserve_phone: { type: String },
  user_type: { type: String, enum: ['member', 'admin', 'staff'], required: true, default: 'member' },
  member_status: { type: String, enum: ['guest', 'registered', 'official'], required: true, default: 'registered' },
  gender: { type: Number, default: 0 },
  real_name: { type: String },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  role: { type: String, enum: ['super_admin', 'store_manager', 'staff'] },
  permissions: { type: [String], default: [] },
  username: { type: String, unique: true, sparse: true },
  password: { type: String },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
  exemption_count: { type: Number, default: 3 },
  member_code: { type: String, unique: true, sparse: true },
  info_completed: { type: Boolean, default: false },
  phone_audit_status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  phone_audit_pending: { type: String },
  phone_audit_requested_at: { type: Date },
  info_change_request: {
    status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    pending_data: { type: mongoose.Schema.Types.Mixed },
    requested_at: { type: Date },
    reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewed_at: { type: Date },
    reject_reason: { type: String }
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// 索引
userSchema.index({ openid: 1 }, { unique: true, sparse: true });
userSchema.index({ user_type: 1, member_status: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ wechat_phone: 1 });
userSchema.index({ reserve_phone: 1 });
userSchema.index({ member_code: 1 }, { unique: true, sparse: true });
userSchema.index({ username: 1 }, { unique: true, sparse: true });

// 密码加密中间件
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// 密码比较方法
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);
