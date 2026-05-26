const express = require('express');
const router = express.Router();
const announcementService = require('../services/announcement.service');

const getOperator = (req) => {
  const userId = req.user ? (req.user._id || req.user.id) : null;
  const userName = req.user ? (req.user.nick_name || req.user.name || '未知') : '未知';
  return { operatorId: userId, operatorName: userName };
};

router.get('/', async (req, res) => {
  try {
    const result = await announcementService.getAnnouncements(req.query);
    res.json({ code: 200, data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const announcement = await announcementService.getAnnouncementById(req.params.id);
    res.json({ code: 200, data: announcement });
  } catch (err) {
    const status = err.message === '公告不存在' ? 404 : 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/', async (req, res) => {
  console.log('[公告] POST 请求到达, body:', JSON.stringify(req.body), 'user:', req.user ? '已登录' : '未登录');
  try {
    const { operatorId, operatorName } = getOperator(req);
    const announcement = await announcementService.createAnnouncement(req.body, operatorId, operatorName);
    res.json({ code: 200, data: announcement });
  } catch (err) {
    console.error('[公告] 创建失败:', err.message, '请求体:', req.body);
    res.status(400).json({ code: 400, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { operatorId, operatorName } = getOperator(req);
    const announcement = await announcementService.updateAnnouncement(req.params.id, req.body, operatorId, operatorName);
    res.json({ code: 200, data: announcement });
  } catch (err) {
    console.error('[公告] 更新失败:', err.message);
    const status = err.message === '公告不存在' ? 404 : 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { operatorId, operatorName } = getOperator(req);
    const result = await announcementService.deleteAnnouncement(req.params.id, operatorId, operatorName);
    res.json({ code: 200, data: result });
  } catch (err) {
    const status = err.message === '公告不存在' ? 404 : 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

module.exports = router;