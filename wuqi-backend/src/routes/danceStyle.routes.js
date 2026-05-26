const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const DanceStyle = require('../models/DanceStyle');
const { success } = require('../utils/response');

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
    const style = await DanceStyle.create({ name, description, icon, color, sort_order });
    res.json(success(style, '创建舞种成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/dance-styles/:id - 编辑舞种
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const style = await DanceStyle.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
