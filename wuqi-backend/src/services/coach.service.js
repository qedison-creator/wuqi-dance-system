const Coach = require('../models/Coach');
const Schedule = require('../models/Schedule');
const WeekTemplate = require('../models/WeekTemplate');

// 获取教练列表
exports.getCoachList = async (query) => {
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
exports.getCoachById = async (id) => {
  const coach = await Coach.findById(id)
    .populate('dance_styles', 'name icon_url');
  if (!coach) {
    throw new Error('教练不存在');
  }

  const coachObj = coach.toObject();
  coachObj.dance_style_ids = coach.dance_styles ? coach.dance_styles.map(ds => ds._id) : [];
  coachObj.dance_style_names = coach.dance_styles ? coach.dance_styles.map(ds => ds.name).join('、') : '';

  return coachObj;
};

// 新增教练
exports.createCoach = async (data) => {
  if (!data.name) {
    throw new Error('教练姓名不能为空');
  }
  const coach = await Coach.create(data);
  return coach;
};

// 编辑教练
exports.updateCoach = async (id, data) => {
  const coach = await Coach.findById(id);
  if (!coach) {
    throw new Error('教练不存在');
  }

  const allowedFields = ['name', 'avatar_url', 'gender', 'phone', 'introduction', 'dance_styles', 'status', 'sort_order', 'show_on_home'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      coach[key] = data[key];
    }
  }

  await coach.save();
  return coach.toObject();
};

// 启用/禁用教练
exports.toggleCoachStatus = async (id, status) => {
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('状态值无效');
  }

  const coach = await Coach.findById(id);
  if (!coach) {
    throw new Error('教练不存在');
  }

  coach.status = status;
  await coach.save();
  return coach.toObject();
};

// 删除教练（软删除：保留记录，标记为已删除，不影响历史关联数据）
exports.deleteCoach = async (id) => {
  const coach = await Coach.findById(id);
  if (!coach) {
    throw new Error('教练不存在');
  }

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
exports.addGalleryPhoto = async (id, url) => {
  const coach = await Coach.findById(id);
  if (!coach) throw new Error('教练不存在');
  if (!coach.gallery) coach.gallery = [];
  if (coach.gallery.length >= 9) {
    throw new Error('相册最多9张照片');
  }
  coach.gallery.push(url);
  await coach.save();
  return coach.toObject();
};

// 删除相册照片（按URL删除）
exports.removeGalleryPhotoByUrl = async (id, url) => {
  const coach = await Coach.findById(id);
  if (!coach) throw new Error('教练不存在');
  if (!coach.gallery || !coach.gallery.includes(url)) {
    throw new Error('照片不存在');
  }
  coach.gallery = coach.gallery.filter(item => item !== url);
  await coach.save();
  return coach.toObject();
};

// 删除相册照片（按索引删除，保留兼容）
exports.removeGalleryPhoto = async (id, index) => {
  const coach = await Coach.findById(id);
  if (!coach) throw new Error('教练不存在');
  if (!coach.gallery || index < 0 || index >= coach.gallery.length) {
    throw new Error('照片不存在');
  }
  coach.gallery.splice(index, 1);
  await coach.save();
  return coach.toObject();
};
