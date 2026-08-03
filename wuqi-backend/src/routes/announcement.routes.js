const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const checkRecordOwnership = require('../middleware/checkRecordOwnership');
const Announcement = require('../models/Announcement');
const announcementService = require('../services/announcement.service');

// 公告归属校验中间件实例
const checkAnnouncementOwnership = checkRecordOwnership(Announcement, {
  recordName: '公告',
});

const getOperator = (req) => {
  const userId = req.user ? (req.user._id || req.user.id) : null;
  const userName = req.user ? (req.user.nick_name || req.user.name || '未知') : '未知';
  return { operatorId: userId, operatorName: userName };
};

// GET / - 公开接口（前端展示需要）+ 管理端带 token 时按门店过滤
router.get('/', async (req, res) => {
  try {
    // 管理端请求带 token 时按用户门店权限过滤
    let reqUser = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const config = require('../config');
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, config.jwtSecret);
        reqUser = decoded;
      } catch (e) {
        // token 无效：按公开接口处理
      }
    }
    const result = await announcementService.getAnnouncements(req.query, reqUser);
    res.json({ code: 200, data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// GET /:id - 公开接口（前端展示需要）
router.get('/:id', async (req, res) => {
  try {
    const announcement = await announcementService.getAnnouncementById(req.params.id);
    res.json({ code: 200, data: announcement });
  } catch (err) {
    const status = err.message === '公告不存在' ? 404 : 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

// POST / - 创建公告（需登录 + 管理端角色）
router.post('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res) => {
  try {
    const { operatorId, operatorName } = getOperator(req);
    const announcement = await announcementService.createAnnouncement(req.body, operatorId, operatorName, req.user);
    res.json({ code: 200, data: announcement });
  } catch (err) {
    console.error('[公告] 创建失败:', err.message, '请求体:', req.body);
    res.status(400).json({ code: 400, message: err.message });
  }
});

// PUT /:id - 更新公告（需登录 + 管理端角色）
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res) => {
  try {
    const { operatorId, operatorName } = getOperator(req);
    const announcement = await announcementService.updateAnnouncement(req.params.id, req.body, operatorId, operatorName, req.user);
    res.json({ code: 200, data: announcement });
  } catch (err) {
    console.error('[公告] 更新失败:', err.message);
    const status = err.message === '公告不存在' ? 404 : (err.message.indexOf('无权') === 0 || err.message.indexOf('全部门店') === 0 ? 403 : 400);
    res.status(status).json({ code: status, message: err.message });
  }
});

// DELETE /:id - 删除公告（需登录 + 管理端角色）
router.delete('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res) => {
  try {
    const { operatorId, operatorName } = getOperator(req);
    const result = await announcementService.deleteAnnouncement(req.params.id, operatorId, operatorName, req.user);
    res.json({ code: 200, data: result });
  } catch (err) {
    const status = err.message === '公告不存在' ? 404 : (err.message.indexOf('无权') === 0 || err.message.indexOf('全部门店') === 0 ? 403 : 400);
    res.status(status).json({ code: status, message: err.message });
  }
});

module.exports = router;
