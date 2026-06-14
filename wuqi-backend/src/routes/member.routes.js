const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const memberService = require('../services/member.service');
const { success, paginate } = require('../utils/response');

// ========== 具体命名路由（必须在 /:id 参数化路由之前） ==========

// GET /api/v1/members - 获取会员列表
router.get('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const result = await memberService.getMemberList(req.query);
    const paginatedData = paginate(result.list, result.total, result.page, result.pageSize);
    paginatedData.pendingCount = result.pendingCount;
    res.json(success(paginatedData));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/stats/overview - 获取会员统计
router.get('/stats/overview', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const stats = await memberService.getMemberStats(store_id);
    res.json(success(stats));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/export - 导出会员列表
router.get('/export', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const data = await memberService.exportMembers(store_id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=members_${Date.now()}.csv`);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/phone-audit/list - 获取待审核手机号修改列表
router.get('/phone-audit/list', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const result = await memberService.getPhoneAuditList(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/info-change/list - 获取待审核信息修改列表
router.get('/info-change/list', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const list = await memberService.getInfoChangeList(req.storeFilter || {});
    res.json(success(list));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/profile/update - 会员更新个人信息
router.put('/profile/update', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const result = await memberService.updateMemberInfo(req.user.id, req.body);
    res.json(success(result, '更新信息成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/members/reserve-phone/request - 会员申请修改预留手机号
router.post('/reserve-phone/request', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { new_phone } = req.body;
    if (!new_phone) {
      return res.status(400).json({ code: 400, message: '请提供新手机号new_phone', data: null });
    }
    const member = await memberService.requestReservePhoneChange(req.user.id, new_phone);
    res.json(success(member, '申请已提交，请等待审核'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/members/info-change/request - 会员申请修改个人信息
router.post('/info-change/request', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const member = await memberService.requestInfoChange(req.user.id, req.body);
    res.json(success(member, '修改申请已提交，等待审核'));
  } catch (err) {
    next(err);
  }
});

// ========== 参数化路由（必须放在最后，避免拦截具体命名路由） ==========

// GET /api/v1/members/:id - 获取会员详情
router.get('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const member = await memberService.getMemberById(req.params.id);
    res.json(success(member));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id - 更新会员信息
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const member = await memberService.updateMember(req.params.id, req.body);
    res.json(success(member, '更新会员信息成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/status - 启用/禁用会员（黑名单管控）
router.put('/:id/status', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status || !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ code: 400, message: 'status必须为active或disabled', data: null });
    }
    const member = await memberService.updateMember(req.params.id, { status });
    res.json(success(member, status === 'disabled' ? '会员已被限制使用' : '会员已恢复正常使用'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/review - 审核会员
router.put('/:id/review', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { action, reason, store_id } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action必须为approve或reject', data: null });
    }
    const member = await memberService.reviewMember(req.params.id, action, reason, req.user.id, store_id);
    res.json(success(member, action === 'approve' ? '审核通过' : '已拒绝'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/store - 修改会员门店（管理员）
router.put('/:id/store', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { store_id } = req.body;
    if (!store_id) {
      return res.status(400).json({ code: 400, message: '请提供门店ID', data: null });
    }
    const User = require('../models/User');
    const user = await User.findByIdAndUpdate(req.params.id, { store_id }, { new: true });
    if (!user) return res.status(404).json({ code: 404, message: '会员不存在', data: null });
    res.json(success(user, '修改门店成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/exemption - 设置豁免次数
router.put('/:id/exemption', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { exemption_count } = req.body;
    if (exemption_count === undefined || exemption_count === null) {
      return res.status(400).json({ code: 400, message: '请提供豁免次数exemption_count', data: null });
    }
    const member = await memberService.setExemption(req.params.id, exemption_count, req.user.id, req.user.nick_name || req.user.username);
    res.json(success(member, '设置豁免次数成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/:id/exemption-logs - 获取豁免次数使用记录
router.get('/:id/exemption-logs', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const result = await memberService.getExemptionLogs(req.params.id, page, pageSize);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/suspend - 停卡
router.put('/:id/suspend', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { suspend_days } = req.body;
    if (!suspend_days || suspend_days <= 0) {
      return res.status(400).json({ code: 400, message: '请提供停卡天数', data: null });
    }
    const member = await memberService.suspendMember(req.params.id, suspend_days, req.user.id);
    res.json(success(member, '停卡成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/unsuspend - 复卡
router.put('/:id/unsuspend', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const member = await memberService.unsuspendMember(req.params.id, req.user.id);
    res.json(success(member, '复卡成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/assign-code - 分配会员编码
router.put('/:id/assign-code', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const memberCode = await memberService.assignMemberCode(req.params.id);
    res.json(success({ member_code: memberCode }, '会员编码分配成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/:id/info-status - 检查会员信息完整度
router.get('/:id/info-status', auth, checkPermission(['super_admin', 'store_manager', 'staff', 'member']), async (req, res, next) => {
  try {
    let userId = req.params.id;
    if (req.user.member_status && req.user._id.toString() !== userId && !['super_admin', 'store_manager', 'staff'].includes(req.user.role)) {
      userId = req.user._id;
    }
    const status = await memberService.checkMemberInfoComplete(userId);
    res.json(success(status));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/phone-audit - 审核预留手机号修改
router.put('/:id/phone-audit', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { action, reason } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action必须为approve或reject', data: null });
    }
    const member = await memberService.auditReservePhone(req.params.id, action, req.user.id, req.user.nick_name || req.user.username, reason);
    res.json(success(member, action === 'approve' ? '审核通过' : '已拒绝'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/info-change-audit - 审核信息修改请求
router.put('/:id/info-change-audit', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { action, reason } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action必须为approve或reject', data: null });
    }
    const member = await memberService.auditInfoChange(req.params.id, action, req.user.id, reason);
    res.json(success(member, action === 'approve' ? '审核通过，信息已更新' : '已拒绝'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/members/:id - 删除会员（仅超级管理员）
router.delete('/:id', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const User = require('../models/User');
    const Booking = require('../models/Booking');

    const member = await User.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ code: 404, message: '会员不存在', data: null });
    }
    if (member.user_type !== 'member') {
      return res.status(400).json({ code: 400, message: '仅可删除会员类型账号', data: null });
    }

    // 检查是否有进行中的预约
    const activeBookings = await Booking.countDocuments({
      user_id: req.params.id,
      status: 'booked'
    });
    if (activeBookings > 0) {
      // 自动取消所有未完成预约
      await Booking.updateMany(
        { user_id: req.params.id, status: 'booked' },
        { $set: { status: 'cancelled', cancel_type: 'admin_cancel', cancel_time: new Date() } }
      );
      // 释放排课名额
      const cancelledBookings = await Booking.find({ user_id: req.params.id, cancel_type: 'admin_cancel' });
      for (const cb of cancelledBookings) {
        if (cb.schedule_id) {
          await require('../models/Schedule').updateOne(
            { _id: cb.schedule_id },
            { $inc: { current_bookings: -1 } }
          );
        }
      }
    }

    // 删除会员的预约记录、套餐记录，再删除会员
    await Booking.deleteMany({ user_id: req.params.id });
    const UserPackage = require('../models/UserPackage');
    await UserPackage.deleteMany({ user_id: req.params.id });
    await User.findByIdAndDelete(req.params.id);

    res.json(success(null, '会员已删除'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/:id/checkin-profile - 获取会员签到档案
router.get('/:id/checkin-profile', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const attendanceService = require('../services/attendance.service');
    const profile = await attendanceService.getMemberCheckinProfile(req.params.id);
    res.json(success(profile));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
