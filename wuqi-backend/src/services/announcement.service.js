const Announcement = require('../models/Announcement');
const logService = require('./log.service');
const { getAllowedStoreIds } = require('../utils/storeOwnership');

// 校验公告的门店归属（用于更新/删除/启用操作）
// - 超管/审核员（allowedStoreIds 为 null）：通过
// - 全局公告（store_id 为空）：仅超管/审核员可操作
// - 门店专属：必须在允许门店范围内
function assertCanManageAnnouncement(announcement, reqUser, action = '操作') {
  if (!announcement) return;
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds === null) return; // 超管/审核员
  // 全局公告（store_id 为空，全部门店可见）：仅超管可操作
  if (!announcement.store_id) {
    throw new Error(`全部门店公告仅超级管理员可${action}`);
  }
  if (!allowedStoreIds.includes(String(announcement.store_id))) {
    throw new Error(`无权${action}非所属门店的公告`);
  }
}

exports.getAnnouncements = async (query, reqUser) => {
  const { store_id, status, page = 1, pageSize = 20 } = query;
  const filter = {};

  // 门店隔离：
  // - 超管/审核员：可看所有公告（含全局 store_id=null 和所有门店专属）
  // - 单门店角色：可看所属门店的公告 + 全局公告（store_id=null，只读展示）
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      // 没有任何门店权限：仅看全局公告
      filter.store_id = null;
    } else if (allowedStoreIds.length === 1) {
      filter.$or = [
        { store_id: null },
        { store_id: allowedStoreIds[0] }
      ];
    } else {
      filter.$or = [
        { store_id: null },
        { store_id: { $in: allowedStoreIds } }
      ];
    }
  }

  // 显式 store_id 查询参数（前端筛选时使用）：在允许范围内进一步过滤
  if (store_id) {
    // 单门店角色不能查询非所属门店
    if (allowedStoreIds !== null && !allowedStoreIds.includes(String(store_id))) {
      return { list: [], total: 0, page: Number(page), pageSize: Number(pageSize) };
    }
    delete filter.$or;
    filter.store_id = store_id;
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

exports.createAnnouncement = async (data, operatorId, operatorName, reqUser) => {
  const { title, content, store_id, status } = data;

  if (!title) throw new Error('公告标题不能为空');
  if (!content) throw new Error('公告内容不能为空');

  // 单门店角色只能创建所属门店的公告，不能创建全部门店公告
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  let finalStoreId = store_id || null;
  if (allowedStoreIds !== null) {
    if (finalStoreId === null) {
      throw new Error('单门店账号不能创建全部门店公告');
    }
    if (!allowedStoreIds.includes(String(finalStoreId))) {
      throw new Error('无权为非所属门店创建公告');
    }
  }

  try {
    const announcement = await Announcement.create({
      title,
      content,
      store_id: finalStoreId,
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

exports.updateAnnouncement = async (id, data, operatorId, operatorName, reqUser) => {
  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error('公告不存在');

  // 归属校验：单门店角色不能编辑全局公告或非所属门店公告
  assertCanManageAnnouncement(announcement, reqUser, '编辑');

  const { title, content, store_id, status } = data;
  const changes = [];

  if (title !== undefined) { announcement.title = title; changes.push(`标题: ${title}`); }
  if (content !== undefined) { announcement.content = content; changes.push('内容已更新'); }
  if (store_id !== undefined) {
    // 单门店角色不能修改 store_id（防止越权改为全局或其他门店）
    const allowedStoreIds = getAllowedStoreIds(reqUser);
    if (allowedStoreIds !== null) {
      // 保持原 store_id 不变
    } else {
      announcement.store_id = store_id || null;
      changes.push('门店已更新');
    }
  }
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

exports.deleteAnnouncement = async (id, operatorId, operatorName, reqUser) => {
  const announcement = await Announcement.findById(id);
  if (!announcement) throw new Error('公告不存在');

  // 归属校验：单门店角色不能删除全局公告或非所属门店公告
  assertCanManageAnnouncement(announcement, reqUser, '删除');

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
