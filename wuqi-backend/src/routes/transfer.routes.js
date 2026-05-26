const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const TransferRequest = require('../models/TransferRequest');
const User = require('../models/User');
const Store = require('../models/Store');
const UserPackage = require('../models/UserPackage');
const { success, paginate } = require('../utils/response');

// POST /api/v1/transfers - 会员提交转卡申请
router.post('/', auth, async (req, res, next) => {
  try {
    const { to_store_id, reason } = req.body;
    if (!to_store_id) {
      return res.status(400).json({ code: 400, message: '请选择目标门店', data: null });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.member_status !== 'official') {
      return res.status(403).json({ code: 403, message: '仅正式会员可提交转卡申请', data: null });
    }

    const activePackage = await UserPackage.findOne({
      user_id: req.user.id,
      status: { $in: ['active', 'pending'] }
    });
    if (!activePackage) {
      return res.status(400).json({ code: 400, message: '您没有有效的套餐，无法转卡', data: null });
    }

    const fromStoreId = activePackage.store_id;
    if (!fromStoreId) {
      return res.status(400).json({ code: 400, message: '当前套餐未关联门店，无法转卡', data: null });
    }
    if (String(fromStoreId) === String(to_store_id)) {
      return res.status(400).json({ code: 400, message: '目标门店与当前门店相同', data: null });
    }

    const pendingRequest = await TransferRequest.findOne({
      user_id: req.user.id,
      status: 'pending'
    });
    if (pendingRequest) {
      return res.status(400).json({ code: 400, message: '您已有待处理的转卡申请，请等待审核结果', data: null });
    }

    const request = await TransferRequest.create({
      user_id: req.user.id,
      from_store_id: fromStoreId,
      to_store_id,
      reason,
      status: 'pending'
    });

    await request.populate(['from_store_id', 'to_store_id']);
    res.json(success(request, '转卡申请已提交'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/transfers/my - 会员查看自己的转卡申请
router.get('/my', auth, async (req, res, next) => {
  try {
    const requests = await TransferRequest.find({ user_id: req.user.id })
      .populate('from_store_id', 'name')
      .populate('to_store_id', 'name')
      .sort({ created_at: -1 });
    res.json(success(requests));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/transfers - 管理端获取转卡申请列表
router.get('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const total = await TransferRequest.countDocuments(filter);
    const list = await TransferRequest.find(filter)
      .populate('user_id', 'nick_name real_name phone')
      .populate('from_store_id', 'name')
      .populate('to_store_id', 'name')
      .populate('reviewed_by', 'nick_name')
      .sort({ created_at: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    res.json(success(paginate(list, total, page, pageSize)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/transfers/:id/review - 审核转卡申请
router.put('/:id/review', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { action, reject_reason, remark } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action必须为approve或reject', data: null });
    }

    const transfer = await TransferRequest.findById(req.params.id);
    if (!transfer) {
      return res.status(404).json({ code: 404, message: '转卡申请不存在', data: null });
    }
    if (transfer.status !== 'pending') {
      return res.status(400).json({ code: 400, message: '该申请已处理', data: null });
    }

    transfer.status = action === 'approve' ? 'approved' : 'rejected';
    transfer.reviewed_by = req.user.id;
    transfer.reviewed_at = new Date();
    if (reject_reason) transfer.reject_reason = reject_reason;
    if (remark) transfer.remark = remark;

    if (action === 'approve') {
      const packages = await UserPackage.find({
        user_id: transfer.user_id,
        store_id: transfer.from_store_id
      });
      for (const pkg of packages) {
        pkg.store_id = transfer.to_store_id;
        await pkg.save();
      }
    }

    await transfer.save();
    await transfer.populate(['user_id', 'from_store_id', 'to_store_id', 'reviewed_by']);
    res.json(success(transfer, action === 'approve' ? '转卡申请已批准，套餐已转移' : '转卡申请已拒绝'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;