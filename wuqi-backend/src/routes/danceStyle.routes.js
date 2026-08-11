const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const DanceStyle = require('../models/DanceStyle');
const { success } = require('../utils/response');
const contentSecurityService = require('../services/content-security.service');

// GET /api/v1/dance-styles - 获取舞种列表(公开)
router.get('/', async (req, res, next) => {
  try {
    const styles = await DanceStyle.find().sort({ sort_order: 1, created_at: -1 });
    res.json(success(styles));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/dance-styles - 新增舞种
router.post('/', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { name, description, icon, color, sort_order } = req.body;
    if (!name) {
      return res.status(400).json({ code: 400, message: '舞种名称不能为空', data: null });
    }

    // 文本内容安全检测（微信审核强制要求）
    const textResult = await contentSecurityService.checkTextFields({
      name: name,
      description: description,
    }, 'member');
    if (!textResult.safe) {
      return res.status(200).json({
        code: 'CONTENT_UNSAFE',
        message: '舞种信息含违规内容，请修改后重新提交',
        data: null
      });
    }

    const style = await DanceStyle.create({ name, description, icon, color, sort_order });
    res.json(success(style, '创建舞种成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/dance-styles/:id - 编辑舞种
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    // 文本内容安全检测（微信审核强制要求）
    const textResult = await contentSecurityService.checkTextFields({
      name: req.body.name,
      description: req.body.description,
    }, 'member');
    if (!textResult.safe) {
      return res.status(200).json({
        code: 'CONTENT_UNSAFE',
        message: '舞种信息含违规内容，请修改后重新提交',
        data: null
      });
    }

    const style = await DanceStyle.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    res.json(success(style, '编辑舞种成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/dance-styles/:id - 删除舞种
router.delete('/:id', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    await DanceStyle.findByIdAndDelete(req.params.id);
    res.json(success(null, '删除舞种成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
