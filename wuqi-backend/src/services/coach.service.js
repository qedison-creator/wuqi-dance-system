const Coach = require('../models/Coach');
const Schedule = require('../models/Schedule');
const WeekTemplate = require('../models/WeekTemplate');
const { getAllowedStoreIds } = require('../utils/storeOwnership');

/**
 * 构建教练门店过滤条件（基于 store_ids 多门店执教模型）
 *
 * 规则：
 * - reqUser 为空（会员端公开访问）：返回 null（不过滤，由外层按 query.store_id 处理）
 * - 超管/审核员：返回 null（不过滤）
 * - 单/多门店角色：返回 store_ids 与 allowedStoreIds 有交集，或 store_ids 为空/不存在（多门店执教教练）
 * - 无门店权限：返回强制空结果条件
 *
 * @param {Object|undefined} reqUser - req.user 对象
 * @returns {Object|null} MongoDB 过滤条件，null 表示不过滤
 */
function buildCoachStoreFilter(reqUser) {
  // 会员端公开访问：不过滤（外层按 query.store_id 处理）
  if (!reqUser) return null;

  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管/审核员：不限门店
  if (allowedStoreIds === null) return null;

  // 无门店权限：强制返回空结果
  if (!allowedStoreIds || allowedStoreIds.length === 0) {
    return { _id: { $exists: false } };
  }

  // 单/多门店角色：所属门店教练 + 多门店执教教练（store_ids 为空或不存在）
  return {
    $or: [
      { store_ids: { $in: allowedStoreIds } },
      { store_ids: { $size: 0 } },
      { store_ids: { $exists: false } },
    ],
  };
}

/**
 * 合并过滤条件，处理 $or 冲突
 * 当 filter 已有 $or（如 keyword 搜索）时，将 storeFilter 用 $and 包裹
 */
function mergeFilter(filter, storeFilter) {
  if (!storeFilter) return filter;
  if (filter.$or) {
    filter.$and = [{ $or: filter.$or }, storeFilter];
    delete filter.$or;
  } else {
    Object.assign(filter, storeFilter);
  }
  return filter;
}

/**
 * 判断教练是否为多门店执教（store_ids 为空或不存在）
 */
function isMultiStoreCoach(coach) {
  if (!coach) return false;
  const storeIds = coach.store_ids;
  if (!storeIds || !Array.isArray(storeIds)) return true;
  return storeIds.length === 0;
}

/**
 * 校验当前用户是否可操作目标教练
 * - 超管/审核员：通过
 * - 店长/员工：
 *   - 多门店执教教练（store_ids 为空）：仅超管可操作，拒绝
 *   - 教练 store_ids 与 allowedStoreIds 无交集：拒绝
 *   - 教练 store_ids 包含 allowedStoreIds 之外的门店：拒绝（多门店执教教练，仅超管可操作）
 *
 * @param {Object} coach - 教练记录（必须已查询出来）
 * @param {Object} reqUser - req.user 对象
 * @param {string} [action='操作'] - 操作描述（用于错误提示）
 * @throws {Error} 校验失败抛出业务错误
 */
function assertCanManageCoach(coach, reqUser, action = '操作') {
  if (!coach) return;
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管/审核员：通过
  if (allowedStoreIds === null) return;

  // 多门店执教教练：仅超管可操作
  if (isMultiStoreCoach(coach)) {
    throw new Error(`多门店执教教练仅超级管理员可${action}`);
  }

  // 教练 store_ids 必须是 allowedStoreIds 的子集（即该教练完全归属当前用户所辖门店）
  const coachStoreIds = (coach.store_ids || []).map(s => String(s));
  const isSubset = coachStoreIds.every(id => allowedStoreIds.includes(id));
  if (!isSubset) {
    throw new Error(`无权${action}非所属门店的教练`);
  }
}

// 获取教练列表
exports.getCoachList = async (query, reqUser) => {
  const { status, keyword, include_disabled, page = 1, pageSize = 20 } = query;
  const filter = {};

  // 默认排除已软删除的教练
  filter.is_deleted = { $ne: true };

  // 默认只返回active状态的教练，除非include_disabled为true
  if (!include_disabled) {
    filter.status = 'active';
  } else if (status) {
    filter.status = status;
  }

  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: 'i' } },
      { phone: { $regex: keyword, $options: 'i' } },
    ];
  }

  // 门店过滤（管理端按 req.user 角色过滤；会员端公开访问按 query.store_id 过滤）
  if (reqUser) {
    const storeFilter = buildCoachStoreFilter(reqUser);
    mergeFilter(filter, storeFilter);
  } else if (query.store_id) {
    // 会员端按 query.store_id 过滤：该门店独占教练 + 多门店执教教练
    const sid = String(query.store_id);
    mergeFilter(filter, {
      $or: [
        { store_ids: { $in: [sid] } },
        { store_ids: { $size: 0 } },
        { store_ids: { $exists: false } },
      ],
    });
  }

  const list = await Coach.find(filter)
    .populate('dance_styles', 'name icon_url')
    .sort({ sort_order: 1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  // 转换 dance_styles 数组为 dance_style_ids 和 dance_style_names
  const transformedList = list.map(coach => {
    const coachObj = coach.toObject();
    coachObj.dance_style_ids = coach.dance_styles.map(ds => ds._id);
    coachObj.dance_style_names = coach.dance_styles.map(ds => ds.name).join('、');
    return coachObj;
  });

  const total = await Coach.countDocuments(filter);
  return { list: transformedList, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取教练详情
exports.getCoachById = async (id, reqUser) => {
  const coach = await Coach.findById(id)
    .populate('dance_styles', 'name icon_url');
  if (!coach) {
    throw new Error('教练不存在');
  }

  // 管理端调用时校验归属
  if (reqUser) {
    assertCanManageCoach(coach, reqUser, '查看');
  }

  const coachObj = coach.toObject();
  coachObj.dance_style_ids = coach.dance_styles ? coach.dance_styles.map(ds => ds._id) : [];
  coachObj.dance_style_names = coach.dance_styles ? coach.dance_styles.map(ds => ds.name).join('、') : '';

  return coachObj;
};

// 新增教练
exports.createCoach = async (data, reqUser) => {
  if (!data.name) {
    throw new Error('教练姓名不能为空');
  }

  const allowedStoreIds = getAllowedStoreIds(reqUser);

  // 超管/审核员：可自由设置 store_ids（包括空数组=多门店执教）
  // 注：审核员在 auth 中间件已被拦截非 GET 请求，此处不会进入
  if (allowedStoreIds === null) {
    // 超管：直接使用 data.store_ids，未传则默认空数组（多门店执教）
    if (!data.store_ids) data.store_ids = [];
  } else if (allowedStoreIds.length === 0) {
    throw new Error('您的账号未分配门店，无法创建教练');
  } else {
    // 店长/员工：store_ids 必须是 allowedStoreIds 的非空子集
    const requested = Array.isArray(data.store_ids) ? data.store_ids.map(String) : null;

    if (!requested || requested.length === 0) {
      // 未传 store_ids：单门店角色默认为 [所属门店]；多门店店长必须明确指定
      if (allowedStoreIds.length === 1) {
        data.store_ids = [allowedStoreIds[0]];
      } else {
        throw new Error('请选择教练所属门店');
      }
    } else {
      // 校验 requested 是否为 allowedStoreIds 的子集
      const isSubset = requested.every(id => allowedStoreIds.includes(id));
      if (!isSubset) {
        throw new Error('无权为非所属门店创建教练');
      }
      data.store_ids = requested;
    }
  }

  const coach = await Coach.create(data);
  return coach;
};

// 编辑教练
exports.updateCoach = async (id, data, reqUser) => {
  const coach = await Coach.findById(id);
  if (!coach) {
    throw new Error('教练不存在');
  }

  // 校验归属
  assertCanManageCoach(coach, reqUser, '编辑');

  // 允许更新的字段（store_ids 仅超管可改，下方单独处理）
  const allowedFields = ['name', 'avatar_url', 'gender', 'phone', 'introduction', 'dance_styles', 'status', 'sort_order', 'show_on_home'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      coach[key] = data[key];
    }
  }

  // store_ids 字段：仅超管可修改
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds === null && Object.prototype.hasOwnProperty.call(data, 'store_ids')) {
    // 超管修改 store_ids（可设为空数组=多门店执教）
    const newStoreIds = Array.isArray(data.store_ids) ? data.store_ids : [];
    coach.store_ids = newStoreIds;
  }
  // 店长/员工试图修改 store_ids：忽略（assertCanManageCoach 已保证只能编辑所属门店独占教练）

  await coach.save();
  return coach.toObject();
};

// 启用/禁用教练
exports.toggleCoachStatus = async (id, status, reqUser) => {
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('状态值无效');
  }

  const coach = await Coach.findById(id);
  if (!coach) {
    throw new Error('教练不存在');
  }

  // 校验归属
  assertCanManageCoach(coach, reqUser, '操作');

  coach.status = status;
  await coach.save();
  return coach.toObject();
};

// 删除教练（软删除：保留记录，标记为已删除，不影响历史关联数据）
exports.deleteCoach = async (id, reqUser) => {
  const coach = await Coach.findById(id);
  if (!coach) {
    throw new Error('教练不存在');
  }

  // 校验归属
  assertCanManageCoach(coach, reqUser, '删除');

  // 检查关联的排课（仅检查未来课程，已完成的课程不受影响）
  const Schedule = require('../models/Schedule');
  const hasUpcomingSchedules = await Schedule.countDocuments({
    coach_id: id,
    status: { $in: ['available', 'full'] }
  });
  if (hasUpcomingSchedules > 0) throw new Error('该教练有未开始的排课记录，无法删除');

  // 清理星期模板中的教练引用
  const templates = await WeekTemplate.find({});
  const affectedStores = [];
  for (const wt of templates) {
    let modified = false;
    for (const weekday of Object.keys(wt.template || {})) {
      const items = wt.template[weekday];
      if (Array.isArray(items)) {
        const before = items.length;
        wt.template[weekday] = items.filter(item => {
          const itemCoachId = item.coach_id || (item.coach && item.coach._id);
          return String(itemCoachId) !== String(id);
        });
        if (wt.template[weekday].length < before) modified = true;
      }
    }
    if (modified) {
      wt.markModified('template');
      await wt.save();
      affectedStores.push(wt.store_id);
    }
  }
  if (affectedStores.length > 0) {
    console.log(`[Coach] 删除教练时清理了${affectedStores.length}个门店的星期模板`);
  }

  // 软删除：标记为已删除，不真正删除记录
  // 历史关联数据（课程/预约/签到/取消记录）通过 populate 仍能获取教练信息
  coach.is_deleted = true;
  coach.status = 'disabled';
  await coach.save();

  return { success: true };
};

// 添加相册照片
exports.addGalleryPhoto = async (id, url, reqUser) => {
  const coach = await Coach.findById(id);
  if (!coach) throw new Error('教练不存在');

  // 校验归属
  assertCanManageCoach(coach, reqUser, '操作');

  if (!coach.gallery) coach.gallery = [];
  if (coach.gallery.length >= 9) {
    throw new Error('相册最多9张照片');
  }
  coach.gallery.push(url);
  await coach.save();
  return coach.toObject();
};

// 删除相册照片（按URL删除）
exports.removeGalleryPhotoByUrl = async (id, url, reqUser) => {
  const coach = await Coach.findById(id);
  if (!coach) throw new Error('教练不存在');

  // 校验归属
  assertCanManageCoach(coach, reqUser, '操作');

  if (!coach.gallery || !coach.gallery.includes(url)) {
    throw new Error('照片不存在');
  }
  coach.gallery = coach.gallery.filter(item => item !== url);
  await coach.save();
  return coach.toObject();
};

// 删除相册照片（按索引删除，保留兼容）
exports.removeGalleryPhoto = async (id, index, reqUser) => {
  const coach = await Coach.findById(id);
  if (!coach) throw new Error('教练不存在');

  // 校验归属
  assertCanManageCoach(coach, reqUser, '操作');

  if (!coach.gallery || index < 0 || index >= coach.gallery.length) {
    throw new Error('照片不存在');
  }
  coach.gallery.splice(index, 1);
  await coach.save();
  return coach.toObject();
};
