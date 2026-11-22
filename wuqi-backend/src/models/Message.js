const mongoose = require('mongoose');

// 会员端站内信
// 六类消息 type：
//   package_expire 套餐即将到期 / count_low 次卡即将耗尽 / inactive 上课关怀提醒 → 提醒类
//   waitlist 候补排队结果 / audit 资料审核通知 → 通知类
//   announcement 公告通知 → 公告类
// announcement_id 为弱引用：不设 ref 级联，公告被删除后由查询侧过滤（列表/弹窗即时消失）
const messageSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['package_expire', 'count_low', 'inactive', 'waitlist', 'audit', 'announcement'],
    required: true
  },
  title: { type: String, required: true },
  content: { type: String, default: '' },
  // 业务弱引用：提醒类=套餐_id，候补类=课程_id，关怀类=会员_id（仅用于去重与跳转，不级联）
  ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  // 公告类消息挂公告 _id；公告删除/停用后查询侧即时过滤
  announcement_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  // 公告重要性（仅 announcement 类型使用）：normal 一般 / important 重要 / always 永久
  importance: { type: String, enum: ['normal', 'important', 'always'], default: 'normal' },
  read: { type: Boolean, default: false },
  read_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

messageSchema.index({ user_id: 1, read: 1, created_at: -1 });
messageSchema.index({ user_id: 1, type: 1, ref_id: 1, created_at: -1 });
messageSchema.index({ type: 1, created_at: -1 });

module.exports = mongoose.model('Message', messageSchema);
