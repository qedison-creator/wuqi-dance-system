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
 */
exports.getList = async (query = {}) => {
  const { page = 1, pageSize = 20, coach_id, show_on_home } = query;
  const filter = {};
  if (coach_id) filter.coach_ids = coach_id;
  if (show_on_home !== undefined && show_on_home !== '') {
    filter.show_on_home = show_on_home === 'true' || show_on_home === true;
  }

  const total = await Image.countDocuments(filter);
  const list = await Image.find(filter)
    .populate('coach_ids', 'name avatar_url')
    .sort({ sort_order: -1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize);

  return { list, total, page, pageSize };
};

/**
 * 获取首页图片
 */
exports.getHomeImages = async (limit = 10) => {
  return Image.find({ show_on_home: true })
    .populate('coach_ids', 'name avatar_url')
    .sort({ sort_order: -1, created_at: -1 })
    .limit(limit);
};

/**
 * 上传图片
 */
exports.create = async (file, data) => {
  const { title, coach_ids, show_on_home } = data;

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

  const image = new Image({
    title,
    image_url: compressed.image_url,
    thumbnail_url: compressed.thumbnail_url,
    coach_ids: coachIdArr,
    width: compressed.width,
    height: compressed.height,
    orientation: compressed.orientation,
    show_on_home: show_on_home !== 'false' && show_on_home !== false
  });

  return image.save();
};

/**
 * 更新图片信息
 */
exports.update = async (id, data) => {
  const allowedFields = ['title', 'coach_ids', 'show_on_home', 'sort_order'];
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
  return Image.findByIdAndUpdate(id, updateData, { new: true });
};

/**
 * 删除图片
 */
exports.remove = async (id) => {
  const image = await Image.findById(id);
  if (!image) throw new Error('图片不存在');

  // 删除图片文件
  const imagePath = path.join(__dirname, '../../', image.image_url);
  const thumbPath = path.join(__dirname, '../../', image.thumbnail_url);
  try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) { /* ignore */ }
  try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }

  return Image.findByIdAndDelete(id);
};