const Video = require('../models/Video');
const fs = require('fs');
const path = require('path');

// 会员端获取视频列表(仅online/active状态, 支持store_id/coach_id筛选, 分页)
exports.getVideos = async (query) => {
  const { store_id, coach_id, dance_style_id, page = 1, pageSize = 20 } = query;
  const filter = { status: 'active' };

  if (store_id) filter.store_id = store_id;
  if (coach_id) filter.coach_id = coach_id;
  if (dance_style_id) filter.dance_style_id = dance_style_id;

  const list = await Video.find(filter)
    .populate('dance_style_id', 'name icon_url')
    .populate('coach_id', 'name avatar_url')
    .sort({ sort_order: 1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Video.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 管理端获取视频列表(所有状态, 支持status筛选)
exports.getVideosAdmin = async (query) => {
  const { status, coach_id, dance_style_id, keyword, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (status) filter.status = status;
  if (coach_id) filter.coach_id = coach_id;
  if (dance_style_id) filter.dance_style_id = dance_style_id;
  if (keyword) {
    filter.$or = [
      { title: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } },
    ];
  }

  const list = await Video.find(filter)
    .populate('dance_style_id', 'name icon_url')
    .populate('coach_id', 'name avatar_url')
    .sort({ sort_order: 1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Video.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取视频详情
exports.getVideoById = async (id) => {
  const video = await Video.findById(id)
    .populate('dance_style_id', 'name icon_url')
    .populate('coach_id', 'name avatar_url');
  if (!video) throw new Error('视频不存在');
  return video;
};

// 上传视频
exports.createVideo = async (data) => {
  const { title, video_url, cover_url, coach_id, dance_style_id, description, duration, is_free } = data;

  if (!title) throw new Error('视频标题不能为空');
  if (!video_url) throw new Error('视频地址不能为空');

  const video = await Video.create({
    title,
    video_url,
    cover_url: cover_url || '',
    coach_id: coach_id || null,
    dance_style_id: dance_style_id || null,
    description: description || '',
    duration: duration || 0,
    is_free: is_free !== undefined ? is_free : true,
    status: 'active',
    sort_order: 0,
  });

  return video;
};

// 编辑视频
exports.updateVideo = async (id, data) => {
  const video = await Video.findById(id);
  if (!video) throw new Error('视频不存在');

  const allowedFields = ['title', 'description', 'cover_url', 'video_url', 'duration', 'dance_style_id', 'coach_id', 'is_free', 'sort_order'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      video[key] = data[key];
    }
  }

  await video.save();
  return video;
};

// 删除视频
exports.deleteVideo = async (id) => {
  const video = await Video.findById(id);
  if (!video) throw new Error('视频不存在');

  const filesToDelete = [];
  if (video.video_url) filesToDelete.push(video.video_url);
  if (video.cover_url) filesToDelete.push(video.cover_url);
  for (const fileUrl of filesToDelete) {
    const filePath = path.join(__dirname, '../../uploads', path.basename(fileUrl));
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error('删除视频文件失败:', fileUrl, err.message);
      }
    });
  }

  await Video.findByIdAndDelete(id);
  return { success: true };
};

// 上下架切换
exports.toggleVideoStatus = async (id, status) => {
  const video = await Video.findById(id);
  if (!video) throw new Error('视频不存在');

  if (!['active', 'disabled'].includes(status)) {
    throw new Error('无效的状态值，必须为active或disabled');
  }

  video.status = status;
  await video.save();
  return video;
};

// 批量排序
exports.sortVideos = async (sortList) => {
  if (!Array.isArray(sortList) || sortList.length === 0) {
    throw new Error('排序列表不能为空');
  }

  const updates = [];
  for (const item of sortList) {
    if (!item.id || item.sort_order === undefined) continue;
    const video = await Video.findById(item.id);
    if (video) {
      video.sort_order = item.sort_order;
      await video.save();
      updates.push(video);
    }
  }

  return updates;
};

// 增加播放量
exports.incrementViewCount = async (id) => {
  const video = await Video.findByIdAndUpdate(id, { $inc: { view_count: 1 } }, { new: true });
  if (!video) throw new Error('视频不存在');
  return video;
};
