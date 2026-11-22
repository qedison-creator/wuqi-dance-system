const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const BEIJING_TZ = 'Asia/Shanghai';
const Message = require('../models/Message');
const Announcement = require('../models/Announcement');
const { sendToUser } = require('./websocket.service');

// 六类消息显示名与主题色（与会员端列表/弹窗配色一一对应）
const TYPE_META = {
  package_expire: { name: '套餐即将到期', color: '#E8985E', category: 'reminder' },
  count_low: { name: '次卡即将耗尽', color: '#D4786E', category: 'reminder' },
  inactive: { name: '上课关怀提醒', color: '#8B7EC8', category: 'reminder' },
  waitlist: { name: '候补排队结果', color: '#4DB8A0', category: 'notice' },
  audit: { name: '资料审核通知', color: '#6B8FD4', category: 'notice' },
  announcement: { name: '公告通知', color: '#8A8578', category: 'announcement' }
};

// 提醒类消息保留天数（列表归档口径：超过 90 天的提醒类不再展示，并由每日任务物理清理）
const REMINDER_ARCHIVE_DAYS = 90;

// ========== 公告弱引用有效性 ==========
// 公告被管理端删除/停用后，其站内信在列表与弹窗中即时消失。
// 弹窗公告（popup_type ≠ none）由公告弹窗串行负责展示，站内信弹窗不重复弹，
// 仅 none 型公告的站内信进入弹窗候选。
async function getValidAnnouncementFilter() {
  const activeAnnouncements = await Announcement.find(
    { status: 'active' },
    '_id popup_type'
  ).lean();
  const validIds = activeAnnouncements.map(a => a._id);
  const nonePopupIds = activeAnnouncements
    .filter(a => !a.popup_type || a.popup_type === 'none')
    .map(a => a._id);
  return { validIds, nonePopupIds };
}

// 列表/计数通用过滤器：公告类消息要求公告仍存在且生效中；提醒类按 90 天归档
function buildArchiveFilter() {
  const archiveStart = dayjs().tz(BEIJING_TZ)
    .subtract(REMINDER_ARCHIVE_DAYS, 'day')
    .startOf('day')
    .toDate();
  return {
    $nor: [
      // 提醒类超过 90 天 → 归档不展示
      { type: { $in: ['package_expire', 'count_low', 'inactive'] }, created_at: { $lt: archiveStart } }
    ]
  };
}

async function appendAnnouncementValidity(filter) {
  const { validIds } = await getValidAnnouncementFilter();
  filter.$and = (filter.$and || []).concat([{
    $or: [
      { type: { $ne: 'announcement' } },
      { announcement_id: { $in: validIds } }
    ]
  }]);
  return filter;
}

// ========== 消息创建 ==========
exports.createMessage = async ({ user_id, type, title, content = '', ref_id = null, announcement_id = null, importance = 'normal' }) => {
  if (!user_id || !TYPE_META[type]) return null;
  try {
    return await Message.create({
      user_id,
      type,
      title,
      content,
      ref_id: ref_id || null,
      announcement_id: announcement_id || null,
      importance
    });
  } catch (err) {
    console.error('[Message] 创建站内信失败:', err.message, { user_id, type });
    return null;
  }
};

// 提醒类消息（带间隔去重）：同一 type + ref_id 在 intervalDays 内只生成一条
// 与订阅消息互不影响：订阅消息发送结果不决定站内信是否生成
exports.createReminderMessage = async (userId, type, title, content, refId, intervalDays) => {
  if (!TYPE_META[type] || TYPE_META[type].category !== 'reminder') return null;
  try {
    const last = await Message.findOne({
      user_id: userId,
      type,
      ref_id: refId || null
    }).sort({ created_at: -1 }).lean();
    if (last && intervalDays > 0) {
      const diffDays = dayjs().tz(BEIJING_TZ).diff(dayjs(last.created_at).tz(BEIJING_TZ), 'day');
      if (diffDays < intervalDays) return null;
    }
    const doc = await exports.createMessage({ user_id: userId, type, title, content, ref_id: refId });
    // WS 实时推送：通知会员端刷新未读角标/弹窗/列表
    if (doc) sendToUser(String(userId), 'message_update', { type });
    return doc;
  } catch (err) {
    console.error('[Message] 生成提醒类站内信失败:', err.message, { userId, type });
    return null;
  }
};

// 候补排队结果消息 kind: promoted=转正成功 / closed=临近开课排队结束 / expired=候补过期
exports.createWaitlistMessage = async (user, schedule, kind) => {
  if (!user || !user._id || !schedule) return null;
  const courseName = schedule.course_name || '课程';
  const when = schedule.date && schedule.start_time ? `${schedule.date} ${schedule.start_time}` : schedule.date || '';
  const storeName = schedule.store_id && schedule.store_id.name ? schedule.store_id.name : '';
  let title = '候补排队结果';
  let content = '';
  if (kind === 'promoted') {
    title = '候补转正成功';
    content = `您在《${courseName}》(${when}${storeName ? ' · ' + storeName : ''}) 的候补已转正，预约成功，请按时到课。`;
  } else if (kind === 'closed') {
    title = '候补排队结束';
    content = `《${courseName}》(${when}${storeName ? ' · ' + storeName : ''}) 即将开课，您的候补排队已结束，本次未候补成功。`;
  } else {
    title = '候补排队结束';
    content = `《${courseName}》(${when}${storeName ? ' · ' + storeName : ''}) 的候补确认时间已过，本次未候补成功。`;
  }
  const doc = await exports.createMessage({
    user_id: user._id || user,
    type: 'waitlist',
    title,
    content,
    ref_id: schedule._id || null
  });
  // WS 实时推送：候补结果通常用户在线等待，即时弹出
  if (doc) sendToUser(String(user._id || user), 'message_update', { type: 'waitlist' });
  return doc;
};

// 资料审核通知 kind: member_review=入会申请审核 / info_change=资料修改审核
exports.createAuditMessage = async (userId, kind, approved, reason = '') => {
  let title = '资料审核通知';
  let content = '';
  if (kind === 'member_review') {
    content = approved
      ? '您的会员申请已审核通过，欢迎加入舞栖，快去预约喜欢的课程吧。'
      : `您的会员申请未通过审核${reason ? '：' + reason : ''}，可联系门店咨询详情。`;
  } else {
    content = approved
      ? '您的资料修改申请已审核通过，已同步更新为您提交的新资料。'
      : `您的资料修改申请未通过审核${reason ? '：' + reason : ''}，资料保持原样。`;
  }
  const doc = await exports.createMessage({
    user_id: userId,
    type: 'audit',
    title,
    content
  });
  // WS 实时推送：审核结果即时送达
  if (doc) sendToUser(String(userId), 'message_update', { type: 'audit' });
  return doc;
};

// 公告发布联动：为可见范围内的正式会员批量生成公告站内信
// 全平台公告(store_id=null) → 全部在卡正式会员；门店公告 → 该门店在卡正式会员
// 排除：被限制账号/已注销/停卡会员（无任何未停卡活跃套餐视为停卡中）
exports.createAnnouncementMessages = async (announcement) => {
  if (!announcement || !announcement._id) return 0;
  const User = require('../models/User');
  const filter = {
    user_type: 'member',
    member_status: 'official',
    is_deleted: { $ne: true },
    status: { $ne: 'disabled' }
  };
  if (announcement.store_id) filter.store_id = announcement.store_id;

  try {
    const users = await User.find(filter).select('_id').lean();

    // 停卡会员不收公告：拥有任一未停卡活跃套餐的会员才收（与关怀提醒"有效在卡"口径一致）
    const UserPackage = require('../models/UserPackage');
    const activePkgUserIds = await UserPackage.find({
      status: 'active',
      is_suspended: { $ne: true }
    }).distinct('user_id');
    const activeIdSet = new Set(activePkgUserIds.map(String));
    const targets = users.filter(u => activeIdSet.has(String(u._id)));

    if (!targets.length) return 0;
    const docs = targets.map(u => ({
      user_id: u._id,
      type: 'announcement',
      title: announcement.title,
      content: announcement.content || '',
      announcement_id: announcement._id,
      importance: ['important', 'always'].includes(announcement.popup_type) ? announcement.popup_type : 'normal',
      read: false,
      created_at: new Date()
    }));
    await Message.insertMany(docs, { ordered: false });
    console.log(`[Message] 公告站内信已生成: ${docs.length}条, 公告=${announcement.title}`);
    return docs.length;
  } catch (err) {
    console.error('[Message] 公告站内信生成失败:', err.message);
    return 0;
  }
};

// ========== 查询 ==========
const PAGE_SIZE = 20;

exports.getMessages = async (userId, { page = 1, pageSize = PAGE_SIZE, category = 'all' } = {}) => {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(50, Math.max(1, Number(pageSize) || PAGE_SIZE));

  const filter = { user_id: userId };
  if (category === 'reminder') filter.type = { $in: ['package_expire', 'count_low', 'inactive'] };
  else if (category === 'notice') filter.type = { $in: ['waitlist', 'audit'] };
  else if (category === 'announcement') filter.type = 'announcement';

  if (category === 'all' || category === 'reminder') {
    Object.assign(filter, buildArchiveFilter());
  }
  if (category === 'all' || category === 'announcement') {
    await appendAnnouncementValidity(filter);
  }

  const [list, total, unreadCount] = await Promise.all([
    Message.find(filter).sort({ created_at: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Message.countDocuments(filter),
    exports.unreadCount(userId)
  ]);

  const items = list.map(m => {
    const meta = TYPE_META[m.type] || { name: '站内信', color: '#8A8578' };
    return {
      _id: m._id,
      type: m.type,
      type_name: meta.name,
      color: meta.color,
      category: meta.category,
      title: m.title,
      content: m.content,
      importance: m.importance,
      read: m.read,
      created_at: m.created_at
    };
  });

  return { list: items, total, page, pageSize, unreadCount };
};

exports.unreadCount = async (userId) => {
  const filter = { user_id: userId, read: false };
  await appendAnnouncementValidity(filter);
  Object.assign(filter, buildArchiveFilter());
  return Message.countDocuments(filter);
};

// 弹窗摘要：上次访问（after 时间戳）之后的新未读，最多 3 条，按时间倒序
// 公告弹窗（popup_type ≠ none）走公告弹窗串行队列，此处仅返回 none 型公告
exports.popupSummary = async (userId, after = 0) => {
  const filter = { user_id: userId, read: false };
  const afterDate = new Date(Number(after) || 0);
  if (afterDate.getTime() > 0) filter.created_at = { $gt: afterDate };
  Object.assign(filter, buildArchiveFilter());

  const { nonePopupIds } = await getValidAnnouncementFilter();
  filter.$and = (filter.$and || []).concat([{
    $or: [
      { type: { $ne: 'announcement' } },
      { announcement_id: { $in: nonePopupIds.length ? nonePopupIds : [null] } }
    ]
  }]);

  const list = await Message.find(filter)
    .sort({ created_at: -1 })
    .limit(3)
    .lean();

  const items = list.map(m => {
    const meta = TYPE_META[m.type] || { name: '站内信', color: '#8A8578' };
    return {
      _id: m._id,
      type: m.type,
      type_name: meta.name,
      color: meta.color,
      title: m.title,
      content: m.content,
      importance: m.importance,
      created_at: m.created_at
    };
  });

  return { list: items };
};

// ========== 已读 ==========
exports.markRead = async (userId, messageId) => {
  const msg = await Message.findOne({ _id: messageId, user_id: userId });
  if (!msg) throw new Error('消息不存在');
  if (!msg.read) {
    msg.read = true;
    msg.read_at = new Date();
    await msg.save();
  }
  return msg;
};

exports.markAllRead = async (userId) => {
  const filter = { user_id: userId, read: false };
  Object.assign(filter, buildArchiveFilter());
  const { validIds } = await getValidAnnouncementFilter();
  filter.$and = (filter.$and || []).concat([{
    $or: [
      { type: { $ne: 'announcement' } },
      { announcement_id: { $in: validIds } }
    ]
  }]);
  const result = await Message.updateMany(filter, { $set: { read: true, read_at: new Date() } });
  return { updated: result.modifiedCount || 0 };
};

// ========== 归档清理 ==========
// 每日任务：物理删除超过 90 天的提醒类消息
exports.archiveOldReminderMessages = async () => {
  const archiveStart = dayjs().tz(BEIJING_TZ)
    .subtract(REMINDER_ARCHIVE_DAYS, 'day')
    .startOf('day')
    .toDate();
  const result = await Message.deleteMany({
    type: { $in: ['package_expire', 'count_low', 'inactive'] },
    created_at: { $lt: archiveStart }
  });
  if (result.deletedCount > 0) {
    console.log(`[Message] 提醒类站内信归档清理: 删除${result.deletedCount}条(>${REMINDER_ARCHIVE_DAYS}天)`);
  }
  return result.deletedCount || 0;
};

exports.TYPE_META = TYPE_META;
