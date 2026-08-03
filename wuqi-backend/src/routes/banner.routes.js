const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const Banner = require('../models/Banner');
const { success, paginate } = require('../utils/response');
const { getAllowedStoreIds } = require('../utils/storeOwnership');

// 把图片URL升级为 HTTPS（修复存量 HTTP 图片在小程序端无法显示的问题）
function upgradeImageUrl(url, req) {
  if (!url) return '';
  // 已是完整 http(s) URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // 将 http 升级为 https（小程序不再支持 HTTP）
    return url.replace(/^http:\/\//i, 'https://');
  }
  // 相对路径，拼接当前请求协议+host
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}${url.startsWith('/') ? '' : '/'}${url}`;
}

// 判断当前用户是否可操作指定 banner（多门店展示仅超管/审核员可操作；门店专属仅同门店可操作）
function canOperateBanner(banner, reqUser) {
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds === null) return true; // 超管/审核员
  // 多门店展示（store_id 为空）：仅超管可操作
  if (!banner.store_id) return false;
  // 门店专属：必须在允许门店范围内
  return allowedStoreIds.includes(String(banner.store_id));
}

// GET /api/v1/banners - 获取轮播图列表(公开)
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const list = await Banner.find(filter)
      .populate('store_id', 'name')
      .sort({ sort_order: 1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));

    const total = await Banner.countDocuments(filter);

    // 处理图片 URL，确保返回完整 HTTPS 路径
    const processedList = list.map(banner => {
      const bannerObj = banner.toObject();
      bannerObj.image_url = upgradeImageUrl(bannerObj.image_url, req);
      return bannerObj;
    });

    res.json(success(paginate(processedList, total, page, pageSize)));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/banners - 新增轮播图
router.post('/', auth, checkModulePermission('banner'), storeFilter(), async (req, res, next) => {
  try {
    const allowedStoreIds = getAllowedStoreIds(req.user);
    // 单门店角色只能创建所属门店的轮播图；超管/审核员可创建多门店展示(store_id=null)或指定门店
    let storeId = req.body.store_id;
    if (storeId === undefined || storeId === '') storeId = null;
    if (allowedStoreIds !== null) {
      // 单门店角色：强制设置为所属门店（不能创建多门店展示）
      if (storeId === null) {
        if (allowedStoreIds.length === 1) {
          storeId = allowedStoreIds[0];
        } else {
          return res.status(403).json({ code: 403, message: '请选择所属门店', data: null });
        }
      } else if (!allowedStoreIds.includes(String(storeId))) {
        return res.status(403).json({ code: 403, message: '无权为非所属门店创建轮播图', data: null });
      }
    }
    const banner = await Banner.create({ ...req.body, store_id: storeId });
    res.json(success(banner, '创建轮播图成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/banners/:id - 编辑轮播图
router.put('/:id', auth, checkModulePermission('banner'), storeFilter(), async (req, res, next) => {
  try {
    const existing = await Banner.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '轮播图不存在', data: null });
    }
    if (!canOperateBanner(existing, req.user)) {
      return res.status(403).json({ code: 403, message: '无权编辑此轮播图（多门店展示仅超级管理员可编辑）', data: null });
    }
    // 单门店角色编辑时不能修改 store_id（防止越权改为多门店或其他门店）
    const allowedStoreIds = getAllowedStoreIds(req.user);
    let updateData = { ...req.body };
    if (allowedStoreIds !== null) {
      // 强制保留原 store_id
      updateData.store_id = existing.store_id;
    }
    const banner = await Banner.findByIdAndUpdate(req.params.id, updateData, { returnDocument: 'after' });
    res.json(success(banner, '编辑轮播图成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/banners/:id/status - 启用/禁用轮播图
router.put('/:id/status', auth, checkModulePermission('banner'), storeFilter(), async (req, res, next) => {
  try {
    const existing = await Banner.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '轮播图不存在', data: null });
    }
    if (!canOperateBanner(existing, req.user)) {
      return res.status(403).json({ code: 403, message: '无权操作此轮播图（多门店展示仅超级管理员可操作）', data: null });
    }
    const { status } = req.body;
    const banner = await Banner.findByIdAndUpdate(req.params.id, { status }, { returnDocument: 'after' });
    res.json(success(banner, status === 'active' ? '启用成功' : '禁用成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/banners/:id - 删除轮播图
router.delete('/:id', auth, checkModulePermission('banner'), storeFilter(), async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ code: 404, message: '轮播图不存在', data: null });
    }
    if (!canOperateBanner(banner, req.user)) {
      return res.status(403).json({ code: 403, message: '无权删除此轮播图（多门店展示仅超级管理员可删除）', data: null });
    }
    if (banner.image_url) {
      const filePath = path.join(__dirname, '../../uploads', path.basename(banner.image_url));
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('删除轮播图文件失败:', err.message);
        }
      });
    }
    await Banner.findByIdAndDelete(req.params.id);
    res.json(success(null, '删除轮播图成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
