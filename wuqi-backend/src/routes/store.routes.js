const router = require('express').Router();
const auth = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const Store = require('../models/Store');
const { success, error } = require('../utils/response');
const contentSecurityService = require('../services/content-security.service');
const { getAllowedStoreIds } = require('../utils/storeOwnership');
const { broadcastStoreUpdate } = require('../services/websocket.service');

// GET /api/v1/stores - 获取门店列表
// 公开访问（会员端也调用），管理端请求带 Authorization 时按角色过滤门店
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const stores = await Store.find({ status: 'active' }).sort({ created_at: -1 });

    // 展示排序：福永店在前、固戍店在后，其余门店按创建时间倒序排在已知门店之后
    const STORE_DISPLAY_ORDER = ['福永', '固戍'];
    const displayOrder = (name) => {
      const idx = STORE_DISPLAY_ORDER.findIndex(k => name && name.includes(k));
      return idx === -1 ? STORE_DISPLAY_ORDER.length : idx;
    };
    stores.sort((a, b) => displayOrder(a.name) - displayOrder(b.name));

    // 门店隔离：管理端请求（带认证）且为单门店角色时，仅返回所属门店
    if (req.user) {
      const allowedStoreIds = getAllowedStoreIds(req.user);
      if (allowedStoreIds !== null) {
        // 单门店角色：仅返回所辖门店
        if (!allowedStoreIds || allowedStoreIds.length === 0) {
          return res.json(success([]));
        }
        const filtered = stores.filter(s => allowedStoreIds.includes(String(s._id)));
        return res.json(success(filtered));
      }
    }

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
      const allActiveStores = await Store.find({ status: 'active' });
      return res.json(success({ nearest: null, stores: allActiveStores }));
    }

    // 计算距离（Haversine公式）
    const toRad = (deg) => deg * (Math.PI / 180);
    const storesWithDist = stores.map(store => {
      const storeLat = store.location.latitude;
      const storeLng = store.location.longitude;
      
      const dLat = toRad(storeLat - lat);
      const dLng = toRad(storeLng - lng);
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(lat)) * Math.cos(toRad(storeLat)) *
                Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = 6371 * c; // 单位：公里
      
      return { 
        ...store.toObject(), 
        distance: Math.round(distance * 100) / 100 
      };
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

// POST /api/v1/stores - 新增门店（仅超管）
router.post('/', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const { name, address, phone, business_hours, location } = req.body;
    if (!name) {
      return res.status(400).json({ code: 400, message: '门店名称不能为空', data: null });
    }

    // 文本内容安全检测（微信审核强制要求）
    const textResult = await contentSecurityService.checkTextFields({
      name: name,
      address: address,
      phone: phone,
      business_hours: business_hours,
    }, 'member');
    if (!textResult.safe) {
      return res.status(200).json({
        code: 'CONTENT_UNSAFE',
        message: '门店信息含违规内容，请修改后重新提交',
        data: null
      });
    }

    const store = await Store.create({ name, address, phone, business_hours, location });
    res.json(success(store, '创建门店成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/stores/:id - 编辑门店
// 超管可编辑任意门店；单门店角色只能编辑所属门店
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    // 文本内容安全检测（微信审核强制要求）
    const textResult = await contentSecurityService.checkTextFields({
      name: req.body.name,
      address: req.body.address,
      phone: req.body.phone,
      business_hours: req.body.business_hours,
    }, 'member');
    if (!textResult.safe) {
      return res.status(200).json({
        code: 'CONTENT_UNSAFE',
        message: '门店信息含违规内容，请修改后重新提交',
        data: null
      });
    }

    // 门店归属校验：单门店角色只能编辑所属门店
    const allowedStoreIds = getAllowedStoreIds(req.user);
    if (allowedStoreIds !== null) {
      if (!allowedStoreIds || allowedStoreIds.length === 0 || !allowedStoreIds.includes(String(req.params.id))) {
        return res.status(403).json(error(403, '无权编辑非所属门店'));
      }
    }

    const store = await Store.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    if (!store) {
      return res.status(404).json({ code: 404, message: '门店不存在', data: null });
    }
    // 广播门店更新事件，通知管理端首页刷新门店相关数据
    broadcastStoreUpdate({ storeId: String(store._id), storeName: store.name, action: 'update' });
    res.json(success(store, '编辑门店成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/stores/:id - 删除门店（仅超管）
router.delete('/:id', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    await Store.findByIdAndDelete(req.params.id);
    res.json(success(null, '删除门店成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
