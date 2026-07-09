const User = require('../models/User');
const UserPackage = require('../models/UserPackage');
const Booking = require('../models/Booking');
const ExemptionLog = require('../models/ExemptionLog');
const logService = require('./log.service');
const dayjs = require('dayjs');

// 获取会员列表(支持status/keyword/store_id/package_active/package_suspended/package_expired/package_pending/package_exhausted筛选)
exports.getMemberList = async (query) => {
  const { status, keyword, store_id, member_status, package_active, package_suspended, package_expired, package_pending, package_exhausted, no_package, no_store, page = 1, pageSize = 20 } = query;
  const filter = { user_type: 'member' };

  if (status) filter.status = status;
  if (member_status) filter.member_status = member_status;
  if (store_id) filter.store_id = store_id;
  if (no_store === 'true' || no_store === true) {
    // ObjectId 类型字段，只需检查 null 和不存在
    filter.store_id = { $in: [null, undefined] };
  }
  if (keyword) {
    filter.$or = [
      { nick_name: { $regex: keyword, $options: 'i' } },
      { real_name: { $regex: keyword, $options: 'i' } },
      { phone: { $regex: keyword, $options: 'i' } },
      { wechat_phone: { $regex: keyword, $options: 'i' } },
      { reserve_phone: { $regex: keyword, $options: 'i' } },
      { member_code: { $regex: keyword, $options: 'i' } },
    ];
  }

  // 根据套餐状态筛选会员
  if (package_active === 'true' || package_active === true) {
    // 使用中：有 active 且未停卡的套餐
    const activePkgs = await UserPackage.find({
      status: 'active',
      is_suspended: { $ne: true },
    }).distinct('user_id');
    const targetIds = activePkgs.map(id => id.toString());
    if (targetIds.length > 0) {
      filter._id = { $in: targetIds };
    } else {
      return { list: [], total: 0, pendingCount: 0, page: Number(page), pageSize: Number(pageSize) };
    }
  } else if (package_suspended === 'true' || package_suspended === true) {
    // 已停卡：有 active 且 is_suspended 的套餐
    const suspendedPkgs = await UserPackage.find({
      status: 'active',
      is_suspended: true,
    }).distinct('user_id');
    const targetIds = suspendedPkgs.map(id => id.toString());
    if (targetIds.length > 0) {
      filter._id = { $in: targetIds };
    } else {
      return { list: [], total: 0, pendingCount: 0, page: Number(page), pageSize: Number(pageSize) };
    }
  } else if (package_expired === 'true' || package_expired === true) {
    // 已过期：有 expired 状态的套餐，且没有 active 套餐
    const now = new Date();
    const expiredPkgs = await UserPackage.find({
      $or: [{ status: 'expired' }, { end_date: { $lt: now } }],
    }).distinct('user_id');
    const activePkgs = await UserPackage.find({
      status: 'active',
      $or: [{ end_date: { $gte: now } }, { end_date: null }],
    }).distinct('user_id');
    const expiredUserIds = expiredPkgs.map(id => id.toString());
    const activeUserIds = activePkgs.map(id => id.toString());
    const targetIds = expiredUserIds.filter(id => !activeUserIds.includes(id));
    if (targetIds.length > 0) {
      filter._id = { $in: targetIds };
    } else {
      return { list: [], total: 0, pendingCount: 0, page: Number(page), pageSize: Number(pageSize) };
    }
  } else if (package_pending === 'true' || package_pending === true) {
    // 未激活：有 pending 状态的套餐，且没有 active 套餐
    const pendingPkgs = await UserPackage.find({ status: 'pending' }).distinct('user_id');
    const activePkgs = await UserPackage.find({ status: 'active' }).distinct('user_id');
    const pendingUserIds = pendingPkgs.map(id => id.toString());
    const activeUserIds = activePkgs.map(id => id.toString());
    const targetIds = pendingUserIds.filter(id => !activeUserIds.includes(id));
    if (targetIds.length > 0) {
      filter._id = { $in: targetIds };
    } else {
      return { list: [], total: 0, pendingCount: 0, page: Number(page), pageSize: Number(pageSize) };
    }
  } else if (package_exhausted === 'true' || package_exhausted === true) {
    // 次数耗尽：有 exhausted 状态的套餐（仅次卡），且没有 active 套餐
    const exhaustedPkgs = await UserPackage.find({
      status: 'exhausted',
      package_type: 'count_card',
    }).distinct('user_id');
    const activePkgs = await UserPackage.find({ status: 'active' }).distinct('user_id');
    const exhaustedUserIds = exhaustedPkgs.map(id => id.toString());
    const activeUserIds = activePkgs.map(id => id.toString());
    const targetIds = exhaustedUserIds.filter(id => !activeUserIds.includes(id));
    if (targetIds.length > 0) {
      filter._id = { $in: targetIds };
    } else {
      return { list: [], total: 0, pendingCount: 0, page: Number(page), pageSize: Number(pageSize) };
    }
  } else if (no_package === 'true' || no_package === true) {
    // 未录套餐：正式会员且没有任何套餐记录
    filter.member_status = 'official';
    // 使用聚合查询：查找没有套餐的会员
    const mongoose = require('mongoose');
    const pipeline = [
      { $match: filter },
      { $lookup: { from: 'userpackages', localField: '_id', foreignField: 'user_id', as: 'pkg_count' } },
      { $match: { pkg_count: { $size: 0 } } },
      { $project: { pkg_count: 0 } }
    ];
    const aggregateResult = await User.aggregate(pipeline);
    const targetIds = aggregateResult.map(u => u._id);
    if (targetIds.length > 0) {
      filter._id = { $in: targetIds };
    } else {
      return { list: [], total: 0, pendingCount: await User.countDocuments({ user_type: 'member', member_status: 'registered', ...(store_id ? { store_id } : {}) }), page: Number(page), pageSize: Number(pageSize) };
    }
  }

  const list = await User.find(filter)
    .select('-password -__v')
    .populate('store_id', 'name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await User.countDocuments(filter);

  // 统计待审核数量
  const pendingFilter = { user_type: 'member', member_status: 'registered' };
  if (store_id) pendingFilter.store_id = store_id;
  const pendingCount = await User.countDocuments(pendingFilter);

  // 为每个会员附加套餐信息
  const listWithPackages = await Promise.all(list.map(async (user) => {
    const packages = await UserPackage.find({ user_id: user._id })
      .populate('store_id', 'name')
      .sort({ created_at: -1 });
    const userObj = user.toObject();
    userObj.packages = packages;
    // 别名：前端统一使用 avatar / nickname
    userObj.avatar = userObj.avatar_url;
    userObj.nickname = userObj.nick_name;
    return userObj;
  }));

  return { list: listWithPackages, total, pendingCount, page: Number(page), pageSize: Number(pageSize) };
};

// 获取会员详情(含套餐+统计)
exports.getMemberById = async (id) => {
  const user = await User.findById(id).select('-password -__v').populate('store_id', 'name');
  if (!user) throw new Error('会员不存在');

  // 先刷新套餐状态（将已过期的 active 标记为 expired）
  const packageService = require('./package.service');
  await packageService.refreshPackageStatus(id);

  // 获取会员套餐
  const packages = await UserPackage.find({ user_id: id })
    .populate('store_id', 'name')
    .sort({ created_at: -1 });

  // 获取预约记录
  const bookings = await Booking.find({ user_id: id })
    .populate({
      path: 'schedule_id',
      populate: { path: 'coach_id' }
    })
    .sort({ created_at: -1 });

  // 统计数据
  const totalBookings = await Booking.countDocuments({
    user_id: id,
    status: 'booked',
  });
  const completedBookings = await Booking.countDocuments({
    user_id: id,
    status: 'completed',
  });
  const cancelledBookings = await Booking.countDocuments({
    user_id: id,
    status: 'cancelled',
  });

  return {
    ...user.toObject(),
    packages,
    bookings,
    stats: {
      total_bookings: totalBookings,
      completed_bookings: completedBookings,
      cancelled_bookings: cancelledBookings,
    },
    // 别名：前端统一使用 avatar / nickname
    avatar: user.avatar_url,
    nickname: user.nick_name,
  };
};

// 审核会员(通过/拒绝)
exports.reviewMember = async (id, action, reason, operatorId, storeId) => {
  const user = await User.findById(id);
  if (!user) throw new Error('会员不存在');
  if (user.user_type !== 'member') throw new Error('该用户非会员');
  if (user.member_status !== 'registered') throw new Error('该会员状态不可审核');

  if (action === 'approve') {
    user.member_status = 'official';
    // 审核通过时可指定门店
    if (storeId) user.store_id = storeId;
    
    // 审核通过时自动生成会员编码
    if (!user.member_code) {
      const targetStoreId = user.store_id || storeId;
      user.member_code = await exports.generateMemberCode(targetStoreId);
    }
  } else if (action === 'reject') {
    user.member_status = 'guest';
  } else {
    throw new Error('无效的审核操作，必须为approve或reject');
  }

  await user.save();

  // 记录操作日志
  await logService.createLog({
    operator_id: operatorId,
    action: action === 'approve' ? 'approve' : 'reject',
    module: 'member',
    target_id: id,
    detail: `审核会员: ${user.nick_name || user.phone || id}, 操作: ${action === 'approve' ? '通过' : '拒绝'}${reason ? ', 原因: ' + reason : ''}${user.member_code ? ', 会员编码: ' + user.member_code : ''}`,
  });

  return user;
};

// 设置豁免次数
exports.setExemption = async (id, count, operatorId, operatorName) => {
  const user = await User.findById(id);
  if (!user) throw new Error('会员不存在');
  if (user.user_type !== 'member') throw new Error('该用户非会员');

  if (count === undefined || count === null || count < 0) {
    throw new Error('豁免次数不能为负数');
  }

  const oldCount = user.exemption_count || 0;
  const delta = count - oldCount;

  // 只有数量变化时才记录
  if (delta !== 0) {
    user.exemption_count = count;
    await user.save();

    // 记录豁免次数变更日志
    await ExemptionLog.create({
      user_id: id,
      type: delta > 0 ? 'add' : 'deduct',
      delta: delta,
      before_count: oldCount,
      after_count: count,
      reason: '管理员手动调整',
      operator_id: operatorId,
      operator_name: operatorName || ''
    });

    // 记录操作日志
    await logService.createLog({
      operator_id: operatorId,
      action: 'update',
      module: 'member',
      target_id: id,
      detail: `修改会员豁免次数: ${user.nick_name || user.phone || id}, 从 ${oldCount} 次改为 ${count} 次`
    });
  }

  return user;
};

// 获取豁免次数使用记录
exports.getExemptionLogs = async (userId, page = 1, pageSize = 20) => {
  const list = await ExemptionLog.find({ user_id: userId })
    .populate('operator_id', 'nick_name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await ExemptionLog.countDocuments({ user_id: userId });

  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 更新会员信息
exports.updateMember = async (id, data) => {
  const user = await User.findById(id);
  if (!user) throw new Error('会员不存在');

  const allowedFields = ['nick_name', 'real_name', 'avatar_url', 'phone', 'gender', 'store_id', 'member_status', 'status'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      user[key] = data[key];
    }
  }

  await user.save();
  return user;
};

// 获取会员统计
exports.getMemberStats = async (storeId) => {
  const filter = { user_type: 'member' };
  if (storeId) filter.store_id = storeId;

  const total = await User.countDocuments(filter);
  const official = await User.countDocuments({ ...filter, member_status: 'official' });
  const registered = await User.countDocuments({ ...filter, member_status: 'registered' });
  const active = await User.countDocuments({ ...filter, status: 'active' });

  return { total, official, registered, active };
};

// 停卡：暂停预约，冻结服务有效期和剩余时长（批量停当前会员所有活跃套餐）
exports.suspendMember = async (userId, suspendDays, operatorId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('会员不存在');
  
  // 找到所有有效且未停卡的套餐
  const activePackages = await UserPackage.find({ user_id: userId, status: 'active', is_suspended: false });
  if (!activePackages || activePackages.length === 0) throw new Error('没有可停卡的有效套餐');
  
  const now = new Date();
  const suspendEndDate = new Date(now.getTime() + suspendDays * 24 * 60 * 60 * 1000);
  let suspendedCount = 0;
  
  for (const pkg of activePackages) {
    // 冻结当前数据
    pkg.is_suspended = true;
    pkg.suspended_at = now;
    pkg.suspend_end_date = suspendEndDate;
    pkg.frozen_remaining_credits = pkg.remaining_credits;
    pkg.frozen_end_date = pkg.end_date;
    
    // 延长到期时间（停卡期间不算）
    if (pkg.end_date) {
      const extendedEnd = new Date(pkg.end_date.getTime() + suspendDays * 24 * 60 * 60 * 1000);
      pkg.end_date = extendedEnd;
    }
    
    await pkg.save();
    suspendedCount++;
  }
  
  // 记录日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'suspend',
    module: 'member',
    target_id: userId,
    detail: `会员(${userId})停卡${suspendDays}天(${suspendedCount}个套餐), 预计${suspendEndDate.toISOString().split('T')[0]}自动复卡`,
  });
  
  return user;
};

// 复卡：恢复服务有效期和剩余时长（批量恢复该会员所有已停套餐）
exports.unsuspendMember = async (userId, operatorId) => {
  const suspendedPackages = await UserPackage.find({ user_id: userId, status: 'active', is_suspended: true });
  if (!suspendedPackages || suspendedPackages.length === 0) throw new Error('没有停卡中的套餐');
  
  const now = new Date();
  let unsuspendedCount = 0;
  let totalDays = 0;
  
  for (const pkg of suspendedPackages) {
    const suspendedAt = pkg.suspended_at;
    
    // 计算实际停卡天数（按自然天计算，向上取整）
    let actualSuspendDays = 0;
    if (suspendedAt) {
      const diffMs = now.getTime() - suspendedAt.getTime();
      actualSuspendDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (actualSuspendDays < 1) actualSuspendDays = 1; // 至少计1天
    }
    
    // 校准 end_date：frozen_end_date + 实际停卡天数
    if (pkg.frozen_end_date && actualSuspendDays > 0) {
      const correctedEndDate = new Date(pkg.frozen_end_date.getTime() + actualSuspendDays * 24 * 60 * 60 * 1000);
      pkg.end_date = correctedEndDate;
    }
    
    pkg.is_suspended = false;
    pkg.suspended_at = null;
    pkg.suspend_end_date = null;
    pkg.frozen_remaining_credits = null;
    pkg.frozen_end_date = null;
    
    await pkg.save();
    unsuspendedCount++;
    totalDays = actualSuspendDays; // 所有套餐停卡天数相同，取最后一个即可
  }
  
  await logService.createLog({
    operator_id: operatorId,
    action: 'unsuspend',
    module: 'member',
    target_id: userId,
    detail: `会员(${userId})已复卡（实际停卡${totalDays}天，${unsuspendedCount}个套餐恢复）`,
  });
  
  const user = await User.findById(userId);
  return user;
};

// ========== 会员编码生成 ==========

// 生成会员编码（格式：FY20260510001）
// 福永店FY, 固戍店GS + 日期8位 + 序号3位
exports.generateMemberCode = async (storeId) => {
  const Store = require('../models/Store');
  const dateStr = dayjs().format('YYYYMMDD');
  
  let prefix = 'FY'; // 默认福永店
  
  if (storeId) {
    const store = await Store.findById(storeId);
    if (store) {
      const storeName = store.name || '';
      if (storeName.includes('福永')) {
        prefix = 'FY';
      } else if (storeName.includes('固戍')) {
        prefix = 'GS';
      }
    }
  }
  
  // 查询今日已生成的编码数量（该前缀的）
  const todayStart = dayjs().startOf('day').toDate();
  const todayEnd = dayjs().endOf('day').toDate();
  
  const count = await User.countDocuments({
    member_code: { $regex: new RegExp(`^${prefix}${dateStr}`) },
    created_at: { $gte: todayStart, $lte: todayEnd }
  });
  
  // 生成3位序号，不足补0，单日可支持最多999个新编号
  const sequence = String(count + 1).padStart(3, '0');
  const memberCode = `${prefix}${dateStr}${sequence}`;
  
  // 验证编码是否已存在（防止并发问题）
  const existing = await User.findOne({ member_code: memberCode });
  if (existing) {
    // 如果已存在，递归调用生成下一个
    return exports.generateMemberCode(storeId);
  }
  
  return memberCode;
};

// 分配会员编码给用户
exports.assignMemberCode = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('会员不存在');
  
  if (user.member_code) {
    return user.member_code; // 已有编码直接返回
  }
  
  const memberCode = await exports.generateMemberCode(user.store_id);
  user.member_code = memberCode;
  await user.save();
  
  return memberCode;
};

// ========== 会员信息强制校验 ==========

// 检查会员信息是否完整
exports.checkMemberInfoComplete = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('会员不存在');

  // 预建档会员（pending_claim 或已认领的 official）核心信息已齐全，
  // 不再强制要求 phone 字段（reserve_phone 已作为联系方式），跳过完善信息拦截
  // 用 claimed_at 识别已认领的预建档会员（仅预建档认领流程会写入该字段，自主注册不会）
  const isPreRegistered = user.member_status === 'pending_claim' || !!user.claimed_at;

  if (isPreRegistered) {
    if (!user.info_completed) {
      user.info_completed = true;
      await user.save();
    }
    return { isComplete: true, missingFields: [], user };
  }

  // 检查必填字段
  const requiredFields = [
    { key: 'real_name', name: '真实姓名' },
    { key: 'phone', name: '手机号码' },
    { key: 'gender', name: '性别' }
  ];

  const missingFields = [];
  for (const field of requiredFields) {
    if (!user[field.key]) {
      missingFields.push(field.name);
    }
  }

  // 验证手机号格式
  if (user.phone && !/^1[3-9]\d{9}$/.test(user.phone)) {
    missingFields.push('正确格式的手机号码');
  }

  const isComplete = missingFields.length === 0;

  // 更新用户状态
  if (user.info_completed !== isComplete) {
    user.info_completed = isComplete;
    await user.save();
  }

  return {
    isComplete,
    missingFields,
    user
  };
};

// 会员更新个人信息（带强制校验）
exports.updateMemberInfo = async (userId, data) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('会员不存在');
  
  const allowedFields = ['nick_name', 'real_name', 'avatar_url', 'phone', 'gender', 'reserve_phone'];
  
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      user[key] = data[key];
    }
  }

  // 自主注册会员首次填写手机号时，同步到 reserve_phone
  if (data.phone !== undefined && !user.claimed_at && !user.reserve_phone) {
    user.reserve_phone = data.phone;
  }
  
  await user.save();
  
  // 重新检查信息完整度
  const checkResult = await exports.checkMemberInfoComplete(userId);
  
  return { user, ...checkResult };
};

// ========== 预留手机号审核流程 ==========

// 会员申请修改预留手机号
exports.requestReservePhoneChange = async (userId, newPhone) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('会员不存在');
  
  // 验证手机号格式
  if (!/^1[3-9]\d{9}$/.test(newPhone)) {
    throw new Error('手机号格式不正确');
  }
  
  // 检查是否已有待审核的申请
  if (user.phone_audit_status === 'pending') {
    throw new Error('您已有一个待审核的手机号修改申请');
  }
  
  user.phone_audit_pending = newPhone;
  user.phone_audit_status = 'pending';
  user.phone_audit_requested_at = new Date();
  
  await user.save();
  
  // 记录操作日志
  await logService.createLog({
    operator_id: userId,
    action: 'request',
    module: 'member',
    target_id: userId,
    detail: `会员申请修改预留手机号为 ${newPhone}`,
  });
  
  return user;
};

// 获取待审核的手机号修改申请列表
exports.getPhoneAuditList = async (query = {}) => {
  const { store_id, page = 1, pageSize = 20 } = query;
  
  const filter = {
    phone_audit_status: 'pending',
    user_type: 'member'
  };
  
  if (store_id) {
    filter.store_id = store_id;
  }
  
  const list = await User.find(filter)
    .select('nick_name real_name phone phone_audit_pending phone_audit_requested_at store_id')
    .populate('store_id', 'name')
    .sort({ phone_audit_requested_at: 1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));
  
  const total = await User.countDocuments(filter);
  
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 审核预留手机号修改
exports.auditReservePhone = async (userId, action, operatorId, operatorName, reason = '') => {
  const user = await User.findById(userId);
  if (!user) throw new Error('会员不存在');
  
  if (user.phone_audit_status !== 'pending') {
    throw new Error('该会员没有待审核的手机号修改申请');
  }
  
  const wechatMessageService = require('./wechat-message.service');
  
  if (action === 'approve') {
    // 审核通过
    const newPhone = user.phone_audit_pending;
    user.reserve_phone = newPhone;
    user.phone_audit_status = 'approved';
    
    await logService.createLog({
      operator_id: operatorId,
      operator_name: operatorName,
      action: 'approve',
      module: 'member',
      target_id: userId,
      detail: `审核通过会员预留手机号修改为 ${newPhone}`,
    });
    
    // 发送审核通过通知
    if (user.openid) {
      try {
        await wechatMessageService.sendPhoneAuditResult(user, 'approved', '您的预留手机号修改申请已审核通过');
      } catch (notifyErr) {
        console.error('发送审核通知失败:', notifyErr.message);
      }
    }
  } else if (action === 'reject') {
    // 审核拒绝
    user.phone_audit_status = 'rejected';
    
    await logService.createLog({
      operator_id: operatorId,
      operator_name: operatorName,
      action: 'reject',
      module: 'member',
      target_id: userId,
      detail: `审核拒绝会员预留手机号修改，原因：${reason || '未说明'}`,
    });
    
    // 发送审核拒绝通知
    if (user.openid) {
      try {
        await wechatMessageService.sendPhoneAuditResult(user, 'rejected', reason || '您的预留手机号修改申请未通过审核');
      } catch (notifyErr) {
        console.error('发送审核通知失败:', notifyErr.message);
      }
    }
  } else {
    throw new Error('无效的审核操作');
  }
  
  // 清空待审核字段
  user.phone_audit_pending = null;
  user.phone_audit_requested_at = null;
  
  await user.save();
  
  return user;
};

// 导出会员列表为CSV
exports.exportMembers = async (store_id) => {
  const User = require('../models/User');
  const Store = require('../models/Store');
  
  let query = { member_status: 'approved' };
  if (store_id) {
    query.store_id = store_id;
  }
  
  const members = await User.find(query)
    .populate('store_id', 'name')
    .sort({ created_at: -1 });
  
  let csv = '\uFEFF会员编码,昵称,真实姓名,手机号,预留手机号,性别,出生日期,门店,注册时间,状态\n';
  
  members.forEach(member => {
    const storeName = member.store_id && member.store_id.name ? member.store_id.name : '';
    const row = [
      member.member_code || '',
      `"${member.nick_name || ''}"`,
      `"${member.real_name || ''}"`,
      member.phone || '',
      member.reserve_phone || '',
      member.gender === 'male' ? '男' : member.gender === 'female' ? '女' : '',
      member.birth_date ? member.birth_date.split('T')[0] : '',
      `"${storeName}"`,
      member.created_at ? member.created_at.toLocaleString('zh-CN') : '',
      member.status === 'active' ? '正常' : member.status === 'disabled' ? '停卡' : '其他'
    ].join(',');
    csv += row + '\n';
  });
  
  return csv;
};

exports.requestInfoChange = async (userId, changeData) => {
  const User = require('../models/User');
  const user = await User.findById(userId);
  if (!user) throw new Error('用户不存在');
  if (user.member_status !== 'official') throw new Error('仅正式会员可修改个人信息');

  const allowedFields = ['real_name', 'phone', 'gender', 'store_id'];
  const pendingData = {};
  for (const field of allowedFields) {
    if (changeData[field] !== undefined) {
      pendingData[field] = changeData[field];
    }
  }
  if (Object.keys(pendingData).length === 0) throw new Error('没有需要修改的字段');

  user.info_change_request = {
    status: 'pending',
    pending_data: pendingData,
    requested_at: new Date(),
    reviewed_by: null,
    reviewed_at: null,
    reject_reason: null
  };

  await user.save();
  return user;
};

exports.getInfoChangeList = async (query = {}) => {
  const User = require('../models/User');
  const filter = { 'info_change_request.status': 'pending' };
  if (query.store_id) filter.store_id = query.store_id;

  const list = await User.find(filter)
    .populate('store_id', 'name')
    .select('nick_name real_name phone gender store_id info_change_request')
    .sort({ 'info_change_request.requested_at': 1 });

  return list;
};

exports.auditInfoChange = async (userId, action, operatorId, reason = '') => {
  const User = require('../models/User');
  const user = await User.findById(userId);
  if (!user) throw new Error('用户不存在');
  if (!user.info_change_request || user.info_change_request.status !== 'pending') {
    throw new Error('没有待审核的信息修改请求');
  }

  if (action === 'approve') {
    const pendingData = user.info_change_request.pending_data || {};
    const allowedFields = ['real_name', 'phone', 'gender', 'store_id'];
    for (const field of allowedFields) {
      if (pendingData[field] !== undefined) {
        user[field] = pendingData[field];
      }
    }
    user.info_change_request.status = 'approved';
  } else if (action === 'reject') {
    user.info_change_request.status = 'rejected';
    user.info_change_request.reject_reason = reason;
  } else {
    throw new Error('无效的审核操作');
  }

  user.info_change_request.reviewed_by = operatorId;
  user.info_change_request.reviewed_at = new Date();
  await user.save();
  return user;
};
