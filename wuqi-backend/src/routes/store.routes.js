const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const Store = require('../models/Store');
const { success } = require('../utils/response');

// GET /api/v1/stores - 获取门店列表(公开)
router.get('/', async (req, res, next) => {
  try {
    const stores = await Store.find({ status: 'active' }).sort({ created_at: -1 });
    res.json(success(stores));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stores/nearest - 根据经纬度匹配最近门店(公开)
router.get('/nearest', async (req, res, next) => {
  try {
    const { latitude, longitude } = req.query;
    if (!latitude || !longitude) {
      return res.status(400).json({ code: 400, message: '缺少经纬度参数', data: null });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    // 查询所有有坐标的活跃门店
    const stores = await Store.find({
      status: 'active',
      'location.latitude': { $exists: true, $ne: null },
      'location.longitude': { $exists: true, $ne: null },
    });

    if (stores.length === 0) {
      // 没有带坐标的门店，返回所有活跃门店让用户手动选
      const allStores = await Store.find({ status: 'active' });
      return res.json(success({ nearest: null, stores: allStores }));
    }

    // 计算距离（Haversine公式简化版）
    const toRad = (deg) => deg * (Math.PI / 180);
    const storesWithDist = stores.map(store => {
      const dLat = toRad(store.location.latitude - lat);
      const dLng = toRad(store.location.longitude - lng);
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(lat)) * Math.cos(toRad(store.location.latitude)) *
                Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = 6371 * c; // 单位：公里
      return { ...store.toObject(), distance: Math.round(distance * 100) / 100 };
    });

    // 按距离排序
    storesWithDist.sort((a, b) => a.distance - b.distance);

    res.json(success({
      nearest: storesWithDist[0],
      stores: storesWithDist
    }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stores/:id - 获取单个门店详情(公开)
router.get('/:id', async (req, res, next) => {
  try {
    const store = await Store.findById(req.params.id);
    if (!store) {
      return res.status(404).json({ code: 404, message: '门店不存在', data: null });
    }
    res.json(success(store));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/stores - 新增门店
router.post('/', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { name, address, phone, business_hours, location } = req.body;
    if (!name) {
      return res.status(400).json({ code: 400, message: '门店名称不能为空', data: null });
    }
    const store = await Store.create({ name, address, phone, business_hours, location });
    res.json(success(store, '创建门店成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/stores/:id - 编辑门店
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(success(store, '编辑门店成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/stores/:id - 删除门店
router.delete('/:id', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    await Store.findByIdAndDelete(req.params.id);
    res.json(success(null, '删除门店成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
