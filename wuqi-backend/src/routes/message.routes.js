const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const messageService = require('../services/message.service');
const { success, error: errorResp } = require('../utils/response');

// 站内信仅会员端使用
router.use(auth, checkPermission(['member']));

// GET /api/v1/messages - 消息列表（分页 + 分类筛选）
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, category = 'all' } = req.query;
    const data = await messageService.getMessages(req.user.id, { page, pageSize, category });
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/messages/unread-count - 未读数（角标）
router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await messageService.unreadCount(req.user.id);
    res.json(success({ count }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/messages/popup - 弹窗摘要（上次访问后的新未读，最多3条）
router.get('/popup', async (req, res, next) => {
  try {
    const data = await messageService.popupSummary(req.user.id, req.query.after || 0);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/messages/read-all - 一键已读
router.post('/read-all', async (req, res, next) => {
  try {
    const data = await messageService.markAllRead(req.user.id);
    res.json(success(data, '已全部标记为已读'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/messages/:id/read - 单条已读
router.post('/:id/read', async (req, res, next) => {
  try {
    await messageService.markRead(req.user.id, req.params.id);
    res.json(success({ success: true }));
  } catch (err) {
    // 消息不存在按 200 返回幂等成功，避免弹窗跳转链路报错
    if (err.message === '消息不存在') {
      return res.status(200).json(errorResp(404, '消息不存在'));
    }
    next(err);
  }
});

module.exports = router;
