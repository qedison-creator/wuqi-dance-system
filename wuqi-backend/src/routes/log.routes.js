const router = require('express').Router();
const auth = require('../middleware/auth');
const { checkModulePermission } = require('../middleware/permission');
const Log = require('../models/OperationLog');
const { success, paginate } = require('../utils/response');

// GET /api/v1/logs - 获取操作日志
router.get('/', auth, checkModulePermission('log'), async (req, res, next) => {
  try {
    const { action, user_id, startDate, endDate, page = 1, pageSize = 20 } = req.query;
    const filter = {};

    if (action) filter.action = action;
    if (user_id) filter.operator_id = user_id;
    if (startDate || endDate) {
      filter.created_at = {};
      if (startDate) filter.created_at.$gte = new Date(startDate);
      if (endDate) filter.created_at.$lte = new Date(endDate + 'T23:59:59');
    }

    const list = await Log.find(filter)
      .populate('operator_id', 'nick_name username')
      .sort({ created_at: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));

    const total = await Log.countDocuments(filter);
    res.json(success(paginate(list, total, page, pageSize)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
