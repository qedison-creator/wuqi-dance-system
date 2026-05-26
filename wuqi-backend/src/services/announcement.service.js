const Announcement = require('../models/Announcement');
const logService = require('./log.service');

exports.getAnnouncements = async (query) => {
  const { store_id, status, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (store_id) {
    filter.$or = [
      { store_id: null },
      { store_id: store_id }
    ];
  }
  if (status) filter.status = status;

  const list = await Announcement.find(filter)
    .populate('store_id', 'name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Announcement.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

exports.getAnnouncementById = async (id) => {
  const announcement = await Announcement.findById(id).populate('store_id', 'name');
  if (!announcement) throw new Error('公告不存在');
  return announcement;
};

exports.createAnnouncement = async (data, operatorId, operatorName) => {
  const { title, content, store_id, status } = data;

  if (!title) throw new Error('公告标题不能为空');
  if (!content) throw new Error('公告内容不能为空');

  try {
    const announcement = await Announcement.create({
      title,
      content,
      store_id: store_id || null,
      status: status || 'active'
    });

    console.log('[公告服务] 公告创建成功, id:', announcement._id);

    try {
      await logService.createLog({
        operator_id: operatorId,
        operator_name: operatorName,
        action: 'create',
        module: 'announcement',
        target_id: announcement._id,
        detail: `新增公告: ${title}`
      });
    } catch (logErr) {
      console.error('[公告服务] 日志写入失败(公告已创建):', logErr.message);
    }

    return announcement;
  } catch (err) {
    console.error('[公告服务] createAnnouncement 失败:', err.message, 'data:', { title, content, store_id, status });
    throw err;
  }
};

exports.updateAnnouncement = async (id, data, operatorId, operatorName) => {
  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error('公告不存在');

  const { title, content, store_id, status } = data;
  const changes = [];

  if (title !== undefined) { announcement.title = title; changes.push(`标题: ${title}`); }
  if (content !== undefined) { announcement.content = content; changes.push('内容已更新'); }
  if (store_id !== undefined) { announcement.store_id = store_id || null; changes.push('门店已更新'); }
  if (status !== undefined) { announcement.status = status; changes.push(`状态: ${status}`); }

  await announcement.save();

  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'update',
    module: 'announcement',
    target_id: announcement._id,
    detail: `编辑公告: ${changes.join(', ')}`
  });

  return announcement;
};

exports.deleteAnnouncement = async (id, operatorId, operatorName) => {
  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error('公告不存在');

  await Announcement.findByIdAndDelete(id);

  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'delete',
    module: 'announcement',
    target_id: id,
    detail: `删除公告: ${announcement.title}`
  });

  return { success: true };
};