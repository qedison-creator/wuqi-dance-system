const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const Image = require('../models/Image');

const UPLOAD_DIR = path.join(__dirname, '../../uploads/images');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * 压缩并保存图片
 * @param {string} filePath - 原始文件路径
 * @param {string} filename - 文件名
 * @returns {Object} { image_url, thumbnail_url, width, height, orientation }
 */
async function compressAndSave(filePath, filename) {
  const baseName = path.parse(filename).name;
  const outputName = `${baseName}_${Date.now()}`;
  const imagePath = path.join(UPLOAD_DIR, `${outputName}.webp`);
  const thumbPath = path.join(UPLOAD_DIR, `${outputName}_thumb.webp`);

  // 获取原图信息
  const metadata = await sharp(filePath).metadata();

  // 压缩为 WebP 格式（原图质量 90%，最大宽度 1920px，保持清晰度）
  await sharp(filePath)
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toFile(imagePath);

  // 生成缩略图（400px 宽，质量 75%）
  await sharp(filePath)
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(thumbPath);

  // 确定方向
  let orientation = 'landscape';
  if (metadata.width && metadata.height) {
    const ratio = metadata.width / metadata.height;
    if (ratio > 1.1) orientation = 'landscape';
    else if (ratio < 0.9) orientation = 'portrait';
    else orientation = 'square';
  }

  return {
    image_url: `/uploads/images/${outputName}.webp`,
    thumbnail_url: `/uploads/images/${outputName}_thumb.webp`,
    width: metadata.width || 0,
    height: metadata.height || 0,
    orientation
  };
}

/**
 * 获取图片列表（管理端）
 * @param {Object} query - 查询参数 { page, pageSize, coach_id, show_on_home, store_id, gallery_type }
 *   - gallery_type: 'public' 仅公共画册；'store' 仅门店画册；不传按 store_id/storeFilter 处理
 * @param {Object} storeFilter - 门店过滤条件（来自 storeFilter 中间件）
 *   - {}: 超管/审核员，不过滤
 *   - { store_id: 'xxx' }: 单门店角色，查询所属门店画册 + 公共画册
 *   - { store_id: { $in: [...] } }: 多门店店长，查询所辖门店画册 + 公共画册
 */
exports.getList = async (query = {}, storeFilter = {}) => {
  const { page = 1, pageSize = 20, coach_id, show_on_home, store_id, gallery_type } = query;
  const filter = {};
  if (coach_id) filter.coach_ids = coach_id;
  if (show_on_home !== undefined && show_on_home !== '') {
    filter.show_on_home = show_on_home === 'true' || show_on_home === true;
  }

  // 画册类型过滤（优先级最高）
  // - gallery_type=public: 仅公共画册（store_id=null）
  // - gallery_type=store: 仅门店画册（store_id!=null）
  if (gallery_type === 'public') {
    filter.store_id = null;
  } else if (gallery_type === 'store') {
    filter.store_id = { $ne: null };
  } else if (store_id) {
    // 管理端显式按门店筛选：仅显示该门店画册（不含公共画册）
    filter.store_id = store_id;
  } else if (storeFilter.store_id) {
    // storeFilter 中间件注入：单门店角色显示所属门店画册 + 公共画册
    if (typeof storeFilter.store_id === 'object' && storeFilter.store_id.$in) {
      // 多门店店长：所辖门店画册 + 公共画册
      filter.$or = [
        { store_id: { $in: storeFilter.store_id.$in } },
        { store_id: null }
      ];
    } else {
      // 单门店角色：所属门店画册 + 公共画册
      filter.$or = [
        { store_id: storeFilter.store_id },
        { store_id: null }
      ];
    }
  } else if (store_id === undefined && storeFilter.store_id === undefined) {
    // 超管未传 store_id：返回全部（含公共画册和所有门店画册）
  }

  const total = await Image.countDocuments(filter);
  const list = await Image.find(filter)
    .populate('coach_ids', 'name avatar_url')
    .populate('store_id', 'name')
    .sort({ sort_order: -1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize);

  return { list, total, page, pageSize };
};

/**
 * 获取首页图片（会员端）
 * @param {number} limit - 返回数量
 * @param {string} storeId - 当前门店ID（返回公共画册 + 该门店画册）
 */
exports.getHomeImages = async (limit = 10, storeId = null) => {
  const filter = { show_on_home: true };
  if (storeId) {
    // 返回公共画册 + 指定门店画册
    filter.$or = [
      { store_id: null },
      { store_id: storeId }
    ];
  } else {
    // 未指定门店：仅返回公共画册
    filter.store_id = null;
  }
  let query = Image.find(filter)
    .populate('coach_ids', 'name avatar_url')
    .sort({ sort_order: -1, created_at: -1 });
  if (limit && Number(limit) > 0) {
    query = query.limit(Number(limit));
  }
  return query.exec();
};

/**
 * 上传图片
 * @param {Object} file - 文件对象
 * @param {Object} data - 表单数据 { title, coach_ids, show_on_home, store_id }
 *   - store_id: null/未传 = 公共画册；ObjectId = 门店画册
 */
exports.create = async (file, data) => {
  const { title, coach_ids, show_on_home, store_id } = data;

  const compressed = await compressAndSave(file.path, file.filename);

  // 解析 coach_ids（支持逗号分隔字符串或数组）
  let coachIdArr = [];
  if (coach_ids) {
    if (Array.isArray(coach_ids)) {
      coachIdArr = coach_ids;
    } else if (typeof coach_ids === 'string') {
      coachIdArr = coach_ids.split(',').map(id => id.trim()).filter(Boolean);
    }
  }

  // store_id: 空字符串/null/undefined = 公共画册；有值 = 门店画册
  const finalStoreId = store_id && String(store_id).trim() ? String(store_id).trim() : null;

  const image = new Image({
    title,
    image_url: compressed.image_url,
    thumbnail_url: compressed.thumbnail_url,
    coach_ids: coachIdArr,
    width: compressed.width,
    height: compressed.height,
    orientation: compressed.orientation,
    show_on_home: show_on_home !== 'false' && show_on_home !== false,
    store_id: finalStoreId
  });

  return image.save();
};

/**
 * 更新图片信息
 * @param {string} id - 图片ID
 * @param {Object} data - 更新数据
 * @param {Object} reqUser - 当前用户（用于权限校验）
 */
exports.update = async (id, data, reqUser = null) => {
  const allowedFields = ['title', 'coach_ids', 'show_on_home', 'sort_order', 'store_id'];
  const updateData = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }
  if (updateData.show_on_home !== undefined) {
    updateData.show_on_home = updateData.show_on_home === 'true' || updateData.show_on_home === true;
  }
  // 解析 coach_ids
  if (updateData.coach_ids !== undefined) {
    if (typeof updateData.coach_ids === 'string') {
      updateData.coach_ids = updateData.coach_ids.split(',').map(id => id.trim()).filter(Boolean);
    }
  }
  // store_id: 空字符串 = 公共画册
  if (updateData.store_id !== undefined) {
    updateData.store_id = updateData.store_id && String(updateData.store_id).trim() ? updateData.store_id : null;
  }

  // 权限校验：单门店角色不能修改公共画册和非所属门店画册
  if (reqUser && reqUser.role !== 'super_admin' && reqUser.role !== 'reviewer') {
    const image = await Image.findById(id);
    if (!image) throw new Error('图片不存在');
    const imageStoreId = image.store_id ? String(image.store_id) : null;
    // 公共画册仅超管可编辑
    if (!imageStoreId) {
      throw new Error('公共画册仅超级管理员可编辑');
    }
    // 非所属门店画册不可编辑
    const allowed = reqUser.role === 'store_manager'
      ? (reqUser.store_ids || []).map(s => String(s))
      : (reqUser.store_id ? [String(reqUser.store_id)] : []);
    if (!allowed.includes(imageStoreId)) {
      throw new Error('无权编辑非所属门店的画册');
    }
    // 不允许单门店角色将图片转移到公共画册或非所属门店
    if (updateData.store_id !== undefined) {
      const newStoreId = updateData.store_id ? String(updateData.store_id) : null;
      if (!newStoreId || !allowed.includes(newStoreId)) {
        throw new Error('无权将图片转移至公共画册或非所属门店');
      }
    }
  }

  return Image.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
};

/**
 * 删除图片
 * @param {string} id - 图片ID
 * @param {Object} reqUser - 当前用户（用于权限校验）
 */
exports.remove = async (id, reqUser = null) => {
  const image = await Image.findById(id);
  if (!image) throw new Error('图片不存在');

  // 权限校验：单门店角色不能删除公共画册和非所属门店画册
  if (reqUser && reqUser.role !== 'super_admin' && reqUser.role !== 'reviewer') {
    const imageStoreId = image.store_id ? String(image.store_id) : null;
    // 公共画册仅超管可删除
    if (!imageStoreId) {
      throw new Error('公共画册仅超级管理员可删除');
    }
    // 非所属门店画册不可删除
    const allowed = reqUser.role === 'store_manager'
      ? (reqUser.store_ids || []).map(s => String(s))
      : (reqUser.store_id ? [String(reqUser.store_id)] : []);
    if (!allowed.includes(imageStoreId)) {
      throw new Error('无权删除非所属门店的画册');
    }
  }

  // 删除图片文件
  const imagePath = path.join(__dirname, '../../', image.image_url);
  const thumbPath = path.join(__dirname, '../../', image.thumbnail_url);
  try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) { /* ignore */ }
  try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }

  return Image.findByIdAndDelete(id);
};
