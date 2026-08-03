const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const checkRecordOwnership = require('../middleware/checkRecordOwnership');
const User = require('../models/User');
const memberService = require('../services/member.service');
const { success, paginate, error } = require('../utils/response');
const { assertMemberAccessibleForCheckin } = require('../utils/storeOwnership');
const { broadcastMemberCountUpdate, sendToUser, broadcastToAdmins } = require('../services/websocket.service');

// 会员归属校验中间件实例（复用 User 模型，校验 :id 对应会员的 store_id 归属）
const checkMemberOwnership = checkRecordOwnership(User, {
  recordName: '会员',
  storeIdField: 'store_id',
});

// 审核专用归属校验：允许 store_id 为 null 的待审核会员通过（管理员审核时分配门店）
const checkMemberOwnershipForReview = checkRecordOwnership(User, {
  recordName: '会员',
  storeIdField: 'store_id',
  allowNullStoreId: true,
});

// ========== 具体命名路由（必须在 /:id 参数化路由之前） ==========

// GET /api/v1/members - 获取会员列表
router.get('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
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
router.get('/stats/overview', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
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

// GET /api/v1/members/info-change/history - 获取信息修改审核记录
router.get('/info-change/history', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const result = await memberService.getInfoChangeHistory({ ...req.query, ...(req.storeFilter || {}) });
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/audit-history - 获取会员审核历史记录
router.get('/audit-history', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const result = await memberService.getMemberAuditHistory(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
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
    // 通知管理端有新的信息修改审核
    broadcastToAdmins('info_change_request', { memberId: req.user.id });
    broadcastMemberCountUpdate();
    res.json(success(member, '修改申请已提交，等待审核'));
  } catch (err) {
    next(err);
  }
});

// ========== 参数化路由（必须放在最后，避免拦截具体命名路由） ==========

// GET /api/v1/members/:id - 获取会员详情
router.get('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
  try {
    const member = await memberService.getMemberById(req.params.id);
    res.json(success(member));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id - 更新会员信息
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
  try {
    const member = await memberService.updateMember(req.params.id, req.body);
    res.json(success(member, '更新会员信息成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/status - 启用/禁用会员（黑名单管控）
router.put('/:id/status', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
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
router.put('/:id/review', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), checkMemberOwnershipForReview, async (req, res, next) => {
  try {
    const { action, reason, store_id } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action必须为approve或reject', data: null });
    }
    const member = await memberService.reviewMember(req.params.id, action, reason, req.user.id, store_id);
    // 会员审核后通知管理端刷新待审核计数
    broadcastMemberCountUpdate();
    // WebSocket 推送审核结果给会员端，触发个人中心页面即时更新
    sendToUser(String(member._id), 'member_review_result', {
      action,
      member_status: member.member_status,
      store_id: member.store_id ? String(member.store_id) : null,
      member_code: member.member_code || '',
      reason: reason || '',
      auditTime: new Date().toISOString()
    });
    res.json(success(member, action === 'approve' ? '审核通过' : '已拒绝'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/store - 修改会员门店（管理员）
router.put('/:id/store', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
  try {
    const { store_id } = req.body;
    if (!store_id) {
      return res.status(400).json({ code: 400, message: '请提供门店ID', data: null });
    }
    const User = require('../models/User');
    const user = await User.findByIdAndUpdate(req.params.id, { store_id }, { returnDocument: 'after' });
    if (!user) return res.status(404).json({ code: 404, message: '会员不存在', data: null });
    res.json(success(user, '修改门店成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/exemption - 设置豁免次数
router.put('/:id/exemption', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
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
router.get('/:id/exemption-logs', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const result = await memberService.getExemptionLogs(req.params.id, page, pageSize);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/suspend - 停卡
router.put('/:id/suspend', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
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
router.put('/:id/unsuspend', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
  try {
    const member = await memberService.unsuspendMember(req.params.id, req.user.id);
    res.json(success(member, '复卡成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/assign-code - 分配会员编码
router.put('/:id/assign-code', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
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
router.put('/:id/phone-audit', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
  try {
    const { action, reason } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action必须为approve或reject', data: null });
    }
    const member = await memberService.auditReservePhone(req.params.id, action, req.user.id, req.user.nick_name || req.user.username, reason);
    // 手机号审核后通知管理端刷新计数
    broadcastMemberCountUpdate();
    // 通过 WebSocket 实时推送审核结果给会员端
    sendToUser(req.params.id, 'phone_audit_result', {
      status: action === 'approve' ? 'approved' : 'rejected',
      auditTime: new Date().toISOString()
    });
    res.json(success(member, action === 'approve' ? '审核通过' : '已拒绝'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/members/:id/info-change-audit - 审核信息修改请求
router.put('/:id/info-change-audit', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), checkMemberOwnership, async (req, res, next) => {
  try {
    const { action, reason } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action必须为approve或reject', data: null });
    }
    const member = await memberService.auditInfoChange(req.params.id, action, req.user.id, reason);
    // 信息修改审核后通知管理端刷新计数
    broadcastMemberCountUpdate();
    // 通过 WebSocket 实时推送审核结果给会员端
    sendToUser(req.params.id, 'info_change_result', {
      status: action === 'approve' ? 'approved' : 'rejected',
      auditTime: new Date().toISOString()
    });
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

    // 删除会员的预约记录（套餐记录保留，仅回填快照，确保套餐录入/激活/延长记录不丢失）
    await Booking.deleteMany({ user_id: req.params.id });

    // 会员快照：删除会员前回填到所有关联记录，确保 populate 失败时仍可显示会员信息
    const memberSnapshot = {
      real_name: member.real_name || '',
      nick_name: member.nick_name || '',
      phone: member.phone || '',
      wechat_phone: member.wechat_phone || '',
      member_code: member.member_code || ''
    };

    // 回填 UserPackage.member_snapshot（仅更新快照为空或不存在的记录）
    const UserPackage = require('../models/UserPackage');
    await UserPackage.updateMany(
      { user_id: member._id, $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' }
      ]},
      { $set: { member_snapshot: memberSnapshot } }
    );

    // 将该会员的所有 active UserPackage 标记为 expired，避免悬空记录被提醒服务误用
    // 会员被删除后，旧套餐不再参与任何提醒推送（到期/低次数/不活跃）
    await UserPackage.updateMany(
      { user_id: member._id, status: 'active' },
      { $set: { status: 'expired' } }
    );

    // 为所有 UserPackage 设置包含会员名的 remark（包括 pending/expired/exhausted），
    // 确保套餐录入记录中已删除会员的姓名可以从 remark 中提取
    const deleteRemark = (memberSnapshot.real_name || memberSnapshot.nick_name || '已删除会员') + ' 的套餐（会员已删除）';
    await UserPackage.updateMany(
      { user_id: member._id, remark: { $in: [null, '', undefined] } },
      { $set: { remark: deleteRemark } }
    );

    // 回填 PackageActivation.member_snapshot
    const PackageActivation = require('../models/PackageActivation');
    await PackageActivation.updateMany(
      { user_id: member._id, $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' }
      ]},
      { $set: { member_snapshot: memberSnapshot } }
    );

    // 回填 PackageExtension.member_snapshot
    const PackageExtension = require('../models/PackageExtension');
    await PackageExtension.updateMany(
      { user_id: member._id, $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' }
      ]},
      { $set: { member_snapshot: memberSnapshot } }
    );

    // 将快照信息冗余到 OperationLog.metadata，
    // 避免 populate target_id 为 null 时审核记录显示"未知"
    const OperationLog = require('../models/OperationLog');
    await OperationLog.updateMany(
      { target_id: member._id, module: 'member' },
      {
        $set: {
          metadata: {
            member_snapshot: {
              real_name: member.real_name || '',
              nick_name: member.nick_name || '',
              phone: member.phone || '',
              wechat_phone: member.wechat_phone || '',
              reserve_phone: member.reserve_phone || '',
              member_code: member.member_code || ''
            }
          }
        }
      }
    );

    await User.findByIdAndDelete(req.params.id);

    res.json(success(null, '会员已删除'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/:id/checkin-profile - 获取会员签到档案
// 门店隔离：单门店角色仅可查看所属门店会员，跨门店套餐会员除外
router.get('/:id/checkin-profile', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const access = await assertMemberAccessibleForCheckin(req.params.id, req.user);
    if (!access.ok) {
      return res.status(403).json(error(403, access.reason));
    }
    const attendanceService = require('../services/attendance.service');
    const profile = await attendanceService.getMemberCheckinProfile(req.params.id);
    res.json(success(profile));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
