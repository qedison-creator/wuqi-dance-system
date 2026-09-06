/**
 * 会员预建档服务（纯增量模块，零侵入现有注册流程）
 *
 * 核心红线：
 * 1. 不修改现有会员注册审核流程的任何代码
 * 2. 状态隔离：新增 member_status='pending_claim'（前端显示「待认领」）
 * 3. 异常自动降级：所有异常不阻断主流程
 * 4. 数据结构复用：沿用 User 集合，不新建集合
 * 5. 可快速回滚：独立封装，仅登录入口保留一处调用
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const UserPackage = require('../models/UserPackage');
const Store = require('../models/Store');
const DanceStyle = require('../models/DanceStyle');
const memberService = require('./member.service');
const { broadcastToAdmins } = require('./websocket.service');

/**
 * 根据起止日期计算套餐服务有效期时长（用于老会员套餐填充 duration_value/duration_unit）
 * 算法：按 30.44 天/月（一年平均）四舍五入；不足 1 个月按天显示
 * @param {Date|String} startDate
 * @param {Date|String} endDate
 * @returns {{value: Number, unit: 'month'|'day'}}}
 */
function calcDurationFromDates(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!(end > start)) return { value: 0, unit: 'day' };

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const totalDays = Math.round((end - start) / MS_PER_DAY);
  if (totalDays <= 0) return { value: 0, unit: 'day' };

  // 按 30.44 天/月四舍五入
  const months = Math.round(totalDays / 30.44);
  if (months >= 1) {
    return { value: months, unit: 'month' };
  }
  return { value: totalDays, unit: 'day' };
}

/**
 * 预建档数据变更后向管理端广播
 * 采用统一事件 pre_member_change，通过 action 区分变更类型
 * @param {string} action - 变更动作：create/update/delete/claim/import
 * @param {Object} payload - 附加数据
 */
function notifyPreMemberChange(action, payload = {}) {
  try {
    broadcastToAdmins('pre_member_change', {
      action,
      ...payload
    });
  } catch (err) {
    // 异常自动降级：不影响主流程
    console.error('[预建档] WebSocket 广播失败:', err.message);
  }
}

/**
 * 校验手机号全局唯一性（待认领 + 待审核 + 正式会员均不可重复）
 */
async function checkPhoneUnique(reservePhone, excludeUserId = null) {
  if (!reservePhone) return { unique: false, reason: '手机号不能为空' };
  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(reservePhone)) {
    return { unique: false, reason: '手机号格式不正确' };
  }
  const query = {
    // 同时校验预留手机号与微信授权手机号，防止同手机号产生双账号
    $or: [
      { reserve_phone: reservePhone },
      { wechat_phone: reservePhone }
    ],
    member_status: { $in: ['pending_claim', 'registered', 'official'] }
  };
  if (excludeUserId) {
    query._id = { $ne: excludeUserId };
  }
  const existing = await User.findOne(query).select('_id member_status');
  if (existing) {
    const statusMap = {
      'pending_claim': '待认领',
      'registered': '待审核',
      'official': '正式会员'
    };
    return { unique: false, reason: `该手机号已存在${statusMap[existing.member_status] || ''}账号` };
  }
  return { unique: true };
}

/**
 * 获取归属门店的默认豁免次数（与新注册会员同口径）
 * 优先级：门店级 default_exemption_count → 全局配置 default_exemption_count → 默认2
 * @param {Object} storeDoc - 已查询的门店文档（需含 default_exemption_count 字段）
 * @returns {Promise<number>}
 */
async function getStoreDefaultExemptionCount(storeDoc) {
  try {
    if (storeDoc && storeDoc.default_exemption_count !== null && storeDoc.default_exemption_count !== undefined) {
      return storeDoc.default_exemption_count;
    }
    const Config = require('../models/Config');
    const configDoc = await Config.findOne({ key: 'default_exemption_count' });
    if (configDoc && configDoc.value) {
      const parsed = parseInt(configDoc.value);
      if (!isNaN(parsed)) return parsed;
    }
  } catch (err) {
    console.error('[预建档] 读取默认豁免次数配置失败，使用默认值2:', err.message);
  }
  return 2;
}

/**
 * 获取预建档列表（仅查询 member_status='pending_claim'）
 */
async function getPreMemberList(query = {}) {
  const { store_id, keyword, status, page = 1, pageSize = 20 } = query;
  const filter = { member_status: 'pending_claim' };

  if (store_id) {
    try {
      filter.store_id = new mongoose.Types.ObjectId(store_id);
    } catch (e) {
      // store_id 无效时不添加筛选条件
    }
  }

  // status 筛选：pending_claim=待认领，official=已认领
  // 列表页支持查看已认领的记录（从 pending_claim 转为 official 的）
  if (status === 'claimed') {
    // 已认领：member_status 为 official 且 claimed_at 存在（仅预建档认领流程会写入 claimed_at）
    // 注意：必须先删除 filter 顶层的 member_status='pending_claim'，否则条件矛盾查不到数据
    delete filter.member_status;
    filter.member_status = 'official';
    filter.claimed_at = { $exists: true, $ne: null };
  } else if (status === 'all') {
    // 全部：待认领 + 已认领
    delete filter.member_status;
    filter.$or = [
      { member_status: 'pending_claim' },
      {
        $and: [
          { member_status: 'official' },
          { claimed_at: { $exists: true, $ne: null } }
        ]
      }
    ];
  }

  if (keyword) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { real_name: { $regex: escapedKeyword, $options: 'i' } },
        { reserve_phone: { $regex: escapedKeyword, $options: 'i' } }
      ]
    });
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const [list, total] = await Promise.all([
    User.find(filter)
      .populate('store_id', 'name')
      .sort({ created_at: -1, _id: -1 })
      .skip(skip)
      .limit(Number(pageSize))
      .lean(),
    User.countDocuments(filter)
  ]);

  // 为每条记录查询套餐信息
  const userIds = list.map(u => u._id);
  const packages = userIds.length > 0 ? await UserPackage.find({
    user_id: { $in: userIds }
  }).populate('store_id', 'name').populate('extra_store_ids', 'name').populate('dance_style_limit', 'name').lean() : [];

  const packageMap = {};
  packages.forEach(p => {
    const uid = p.user_id.toString();
    if (!packageMap[uid]) packageMap[uid] = [];
    packageMap[uid].push(p);
  });

  const resultList = list.map(user => {
    const userPackages = packageMap[user._id.toString()] || [];
    return {
      ...user,
      store_name: user.store_id && user.store_id.name ? user.store_id.name : '',
      packages: userPackages,
      has_package: userPackages.length > 0,
      status_text: user.member_status === 'pending_claim' ? '待认领' : '已认领'
    };
  });

  return {
    list: resultList,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.ceil(total / pageSize)
  };
}

/**
 * 获取预建档统计数量
 * 返回待认领 / 已认领 / 全部 三种计数
 */
async function getPreMemberStats(storeId = null) {
  const baseFilter = { user_type: 'member', member_status: { $in: ['pending_claim', 'official'] } };
  if (storeId) {
    try {
      baseFilter.store_id = new mongoose.Types.ObjectId(storeId);
    } catch (e) {
      // store_id 无效时不添加筛选条件
    }
  }
  const [pendingCount, claimedCount] = await Promise.all([
    User.countDocuments({ ...baseFilter, member_status: 'pending_claim' }),
    // 已认领口径与列表一致：official 且 claimed_at 存在（认领/合并流程写入），
    // 避免把自主注册后审核通过的普通会员也计入
    User.countDocuments({ ...baseFilter, member_status: 'official', claimed_at: { $exists: true, $ne: null } })
  ]);
  return {
    pending_count: pendingCount,
    claimed_count: claimedCount,
    all_count: pendingCount + claimedCount
  };
}

/**
 * 创建预建档记录
 * 支持多套餐：packages 为数组，每个元素是一个套餐对象
 * 兼容旧版：若传入 package（单对象），内部转为 [package]
 */
async function createPreMember(data, operatorId) {
  const { real_name, gender, reserve_phone, store_id, package: packageData, packages: packagesData, remark, member_identity } = data;

  // 基础校验
  if (!real_name || !real_name.trim()) {
    throw new Error('会员姓名不能为空');
  }
  if (gender !== 1 && gender !== 2) {
    throw new Error('性别必须为男(1)或女(2)');
  }
  if (!store_id) {
    throw new Error('所属门店不能为空');
  }

  // 校验门店存在（同时取默认豁免次数：门店级 → 全局配置 → 模型默认2）
  const store = await Store.findById(store_id).select('_id name default_exemption_count');
  if (!store) {
    throw new Error('门店不存在');
  }

  // 校验手机号全局唯一
  const phoneCheck = await checkPhoneUnique(reserve_phone);
  if (!phoneCheck.unique) {
    throw new Error(phoneCheck.reason);
  }

  // 统一套餐列表：优先 packages（数组），兼容旧版 package（单对象）
  let packages = [];
  if (Array.isArray(packagesData) && packagesData.length > 0) {
    packages = packagesData.filter(p => p && p.package_type);
  } else if (packageData && packageData.package_type) {
    packages = [packageData];
  }

  // 生成会员编号，规则与自主注册会员一致
  const member_code = await memberService.generateMemberCode(store_id);

  // 归属门店的默认豁免次数（与新注册会员同口径：门店级 → 全局配置 → 默认2）
  const exemptionCount = await getStoreDefaultExemptionCount(store);

  // 创建预建档记录
  const user = await User.create({
    user_type: 'member',
    member_status: 'pending_claim',
    member_identity: member_identity === 'old' ? 'old' : 'new',
    member_code,
    real_name: real_name.trim(),
    gender: gender,
    reserve_phone: reserve_phone,
    store_id: store_id,
    exemption_count: exemptionCount,
    info_completed: true,
    remark: remark || '',
    created_by: operatorId
    // openid/wechat_phone 留空，认领时回填
  });

  // 创建多个 UserPackage 记录
  const isOldMember = member_identity === 'old';
  try {
    for (const pkg of packages) {
      await createPackageForUser(user._id, store_id, pkg, operatorId, isOldMember);
    }
  } catch (pkgErr) {
    // 套餐创建失败：回滚已创建的 User 记录，避免产生无套餐的悬空预建档
    try {
      await User.findByIdAndDelete(user._id);
    } catch (delErr) {
      console.error('回滚预建档User记录失败:', delErr);
    }
    throw pkgErr;
  }

  notifyPreMemberChange('create', {
    user_id: user._id,
    store_id: user.store_id ? user.store_id.toString() : null,
    member_status: user.member_status,
    real_name: user.real_name
  });

  return user;
}

/**
 * 为用户创建套餐记录（内部辅助函数）
 * @param {boolean} isOldMember - 是否老会员
 * 套餐级激活方式（packageData.activate_mode，仅老会员生效，新会员恒为待激活）：
 *   'active'（默认）：直接生效，需传 start_date/end_date
 *   'pending'：预约激活，需传 duration_value，认领后首次预约激活或60天自动激活
 */
async function createPackageForUser(userId, storeId, packageData, operatorId, isOldMember = false) {
  const { package_type, total_credits, start_date, end_date, duration_value, duration_unit, weekly_limit, daily_limit, monthly_limit, period_type, dance_style_limit, remark, extra_store_ids, activate_mode } = packageData;

  if (!package_type || !['count_card', 'time_card'].includes(package_type)) {
    throw new Error('套餐类型必须为次卡(count_card)或时间卡(time_card)');
  }

  // 计算该套餐的实际激活模式：新会员恒为待激活；老会员按套餐级 activate_mode（默认直接生效）
  const usePendingMode = isOldMember ? (activate_mode === 'pending') : true;

  // 直接生效必须传 start_date/end_date；预约激活必须传 duration_value
  if (!usePendingMode) {
    if (!start_date || !end_date) {
      throw new Error('直接生效的套餐必须填写有效期起止日期');
    }
  } else {
    if (!duration_value || Number(duration_value) <= 0) {
      throw new Error('预约激活的套餐必须填写有效期时长');
    }
  }

  if (package_type === 'count_card' && (!total_credits || total_credits <= 0)) {
    throw new Error('次卡必须填写总次数');
  }
  // 时间卡周期限制校验：period_type 为 'unlimited' 时不要求 weekly_limit/daily_limit/monthly_limit
  if (package_type === 'time_card' && period_type !== 'unlimited' && !weekly_limit && !daily_limit && !monthly_limit) {
    throw new Error('时间卡必须填写周期限制');
  }

  const now = new Date();
  const packageRecord = {
    user_id: userId,
    store_id: storeId,
    extra_store_ids: extra_store_ids || [],
    package_type: package_type,
    is_activated: !usePendingMode,
    activated_at: !usePendingMode ? now : null,
    status: !usePendingMode ? 'active' : 'pending',
    auto_activate_at: usePendingMode ? new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000) : null,
    created_by: operatorId,
    remark: remark || '',
    dance_style_limit: Array.isArray(dance_style_limit) ? dance_style_limit : []
  };

  if (!usePendingMode) {
    // 老会员：直接用起止日期，并据此计算 duration_value/duration_unit 供前端展示
    const startDateObj = new Date(start_date);
    const endDateObj = new Date(end_date);
    packageRecord.start_date = startDateObj;
    packageRecord.end_date = endDateObj;
    const duration = calcDurationFromDates(startDateObj, endDateObj);
    if (duration.value > 0) {
      packageRecord.duration_value = duration.value;
      packageRecord.duration_unit = duration.unit;
    }
  } else {
    // 预约激活（新会员/老会员待激活套餐）：duration_value/duration_unit 存入记录，激活时由 package.service 计算起止日期
    packageRecord.duration_value = Number(duration_value);
    packageRecord.duration_unit = duration_unit || 'month';
    packageRecord.start_date = null;
    packageRecord.end_date = null;
  }

  if (package_type === 'count_card') {
    packageRecord.total_credits = Number(total_credits);
    packageRecord.original_total_credits = Number(total_credits);  // 原始录入值，修改时不变
    packageRecord.remaining_credits = Number(total_credits);
  } else {
    // 时间卡
    packageRecord.total_credits = 0;
    packageRecord.remaining_credits = 0;
    if (weekly_limit) packageRecord.weekly_limit = Number(weekly_limit);
    if (daily_limit) packageRecord.daily_limit = Number(daily_limit);
    if (monthly_limit) packageRecord.monthly_limit = Number(monthly_limit);
  }

  return await UserPackage.create(packageRecord);
}

/**
 * 更新用户已有套餐记录（内部辅助函数）
 * 直接修改现有套餐字段，保留 _id 不变，避免破坏 Booking/PackageActivation 等引用关系
 * 校验逻辑与 createPackageForUser 保持一致
 * 套餐级激活方式（packageData.activate_mode，仅老会员生效）：
 *   'active'（默认）：直接生效，起止日期模式
 *   'pending'：预约激活，时长模式；支持从"直接生效"切换为"预约激活"（及反向切换），同步转换状态字段
 */
async function updatePackageForUser(packageId, packageData, operatorId, isOldMember = false) {
  const { package_type, total_credits, start_date, end_date, duration_value, duration_unit, weekly_limit, daily_limit, monthly_limit, period_type, dance_style_limit, remark, extra_store_ids, activate_mode } = packageData;

  if (!package_type || !['count_card', 'time_card'].includes(package_type)) {
    throw new Error('套餐类型必须为次卡(count_card)或时间卡(time_card)');
  }

  // 计算该套餐的实际激活模式：新会员恒为待激活；老会员按套餐级 activate_mode（默认直接生效）
  const usePendingMode = isOldMember ? (activate_mode === 'pending') : true;

  // 直接生效必须传 start_date/end_date；预约激活必须传 duration_value
  if (!usePendingMode) {
    if (!start_date || !end_date) {
      throw new Error('直接生效的套餐必须填写有效期起止日期');
    }
  } else {
    if (!duration_value || Number(duration_value) <= 0) {
      throw new Error('预约激活的套餐必须填写有效期时长');
    }
  }

  if (package_type === 'count_card' && (!total_credits || total_credits <= 0)) {
    throw new Error('次卡必须填写总次数');
  }
  // 时间卡周期限制校验：period_type 为 'unlimited' 时不要求 weekly_limit/daily_limit/monthly_limit
  if (package_type === 'time_card' && period_type !== 'unlimited' && !weekly_limit && !daily_limit && !monthly_limit) {
    throw new Error('时间卡必须填写周期限制');
  }

  const existingPkg = await UserPackage.findById(packageId);
  if (!existingPkg) {
    throw new Error('待更新的套餐不存在');
  }

  // 更新字段（保留 _id、user_id、store_id、created_by 等不变）
  existingPkg.package_type = package_type;
  existingPkg.extra_store_ids = extra_store_ids || [];
  existingPkg.remark = remark || '';
  existingPkg.updated_by = operatorId;
  existingPkg.dance_style_limit = Array.isArray(dance_style_limit) ? dance_style_limit : [];

  // 激活状态字段随模式同步（支持双向切换）：
  //   直接生效 → status='active'，写入起止日期，清 auto_activate_at
  //   预约激活 → status='pending'，清起止日期，写 duration 与 auto_activate_at（60天后自动激活）
  const now = new Date();
  if (!usePendingMode) {
    // 直接生效：直接用起止日期，并据此计算 duration_value/duration_unit 供前端展示
    const startDateObj = new Date(start_date);
    const endDateObj = new Date(end_date);
    existingPkg.start_date = startDateObj;
    existingPkg.end_date = endDateObj;
    const duration = calcDurationFromDates(startDateObj, endDateObj);
    if (duration.value > 0) {
      existingPkg.duration_value = duration.value;
      existingPkg.duration_unit = duration.unit;
    }
    existingPkg.is_activated = true;
    existingPkg.activated_at = existingPkg.activated_at || now;
    existingPkg.status = 'active';
    existingPkg.auto_activate_at = null;
  } else {
    // 预约激活：duration_value/duration_unit 存入记录，激活时由 package.service 计算起止日期
    existingPkg.duration_value = Number(duration_value);
    existingPkg.duration_unit = duration_unit || 'month';
    existingPkg.start_date = null;
    existingPkg.end_date = null;
    existingPkg.is_activated = false;
    existingPkg.activated_at = null;
    existingPkg.status = 'pending';
    existingPkg.auto_activate_at = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  }

  if (package_type === 'count_card') {
    existingPkg.total_credits = Number(total_credits);
    existingPkg.remaining_credits = Number(total_credits);
  } else {
    // 时间卡：先清空所有周期限制字段，再按需设置（避免从"限制"切换到"不限"时残留旧值）
    existingPkg.total_credits = 0;
    existingPkg.remaining_credits = 0;
    existingPkg.weekly_limit = weekly_limit ? Number(weekly_limit) : undefined;
    existingPkg.daily_limit = daily_limit ? Number(daily_limit) : undefined;
    existingPkg.monthly_limit = monthly_limit ? Number(monthly_limit) : undefined;
  }

  await existingPkg.save();
  return existingPkg;
}

/**
 * 编辑预建档记录（仅允许编辑 pending_claim 状态）
 */
async function updatePreMember(id, data, operatorId) {
  const user = await User.findById(id);
  if (!user) {
    throw new Error('预建档记录不存在');
  }
  if (user.member_status !== 'pending_claim') {
    throw new Error('仅待认领状态的预建档可编辑');
  }

  const { real_name, gender, reserve_phone, store_id, remark } = data;

  // 如修改了手机号，需重新校验唯一性
  if (reserve_phone && reserve_phone !== user.reserve_phone) {
    const phoneCheck = await checkPhoneUnique(reserve_phone, id);
    if (!phoneCheck.unique) {
      throw new Error(phoneCheck.reason);
    }
    user.reserve_phone = reserve_phone;
  }

  if (real_name !== undefined) user.real_name = real_name.trim();
  if (gender !== undefined) {
    if (gender !== 1 && gender !== 2) throw new Error('性别必须为男(1)或女(2)');
    user.gender = gender;
  }
  if (store_id !== undefined) {
    const store = await Store.findById(store_id).select('_id default_exemption_count');
    if (!store) throw new Error('门店不存在');
    const storeChanged = String(user.store_id) !== String(store_id);
    user.store_id = store_id;
    // 待认领阶段切换归属门店：豁免次数跟随新门店默认值重算（认领后成为正式会员，不再自动变更）
    if (storeChanged) {
      user.exemption_count = await getStoreDefaultExemptionCount(store);
    }
  }
  if (remark !== undefined) user.remark = remark;

  user.updated_by = operatorId;
  await user.save();

  // 如有套餐信息变更，更新套餐
  // 支持多套餐：优先 packages（数组），兼容旧版 package（单对象）
  let packagesToUpdate = [];
  if (Array.isArray(data.packages) && data.packages.length > 0) {
    packagesToUpdate = data.packages.filter(p => p && p.package_type);
  } else if (data.package && data.package.package_type) {
    packagesToUpdate = [data.package];
  }

  if (data.package !== undefined || data.packages !== undefined) {
    // 编辑模式：按 _id 原地更新现有套餐，无 _id 的为新增，前端列表中没有的为删除
    // 顺序：先更新/创建（验证失败时旧套餐仍保留），后删除（确保更新成功后才清理）
    const isOldMember = (data.member_identity || user.member_identity) === 'old';

    // 收集前端提交的已有套餐 _id（用于后续计算需要删除的套餐）
    const submittedExistingIds = packagesToUpdate
      .map(p => p._id)
      .filter(id => id)
      .map(id => String(id));

    // 1. 更新现有套餐 + 创建新套餐
    //    新创建的套餐 _id 需要加入 submittedExistingIds，否则步骤2会误删
    for (const pkg of packagesToUpdate) {
      if (pkg._id) {
        // 原地更新：保留 _id 不变，避免破坏 Booking/PackageActivation 等引用关系
        await updatePackageForUser(pkg._id, pkg, operatorId, isOldMember);
      } else {
        // 新建套餐（用户在UI上新增的）
        const newPkg = await createPackageForUser(id, user.store_id, pkg, operatorId, isOldMember);
        // 将新创建的套餐 _id 加入已提交列表，防止步骤2误删
        if (newPkg && newPkg._id) {
          submittedExistingIds.push(String(newPkg._id));
        }
      }
    }

    // 2. 删除前端列表中没有的套餐（用户在UI上删除的）
    //    放在最后执行：即使前面验证失败抛错，旧套餐也不会丢失
    const existingPackages = await UserPackage.find({ user_id: id }).select('_id').lean();
    const toDelete = existingPackages
      .map(p => String(p._id))
      .filter(id => submittedExistingIds.indexOf(id) === -1);
    if (toDelete.length > 0) {
      await UserPackage.deleteMany({ _id: { $in: toDelete } });
    }
  }

  notifyPreMemberChange('update', {
    user_id: user._id,
    store_id: user.store_id ? user.store_id.toString() : null,
    member_status: user.member_status,
    real_name: user.real_name
  });

  return user;
}

/**
 * 删除预建档记录（仅允许删除 pending_claim 状态）
 */
async function deletePreMember(id) {
  const user = await User.findById(id);
  if (!user) {
    throw new Error('预建档记录不存在');
  }
  if (user.member_status !== 'pending_claim') {
    throw new Error('仅待认领状态的预建档可删除');
  }

  notifyPreMemberChange('delete', {
    user_id: user._id,
    store_id: user.store_id ? user.store_id.toString() : null,
    member_status: user.member_status,
    real_name: user.real_name
  });

  // 删除关联的套餐记录
  await UserPackage.deleteMany({ user_id: id });
  // 删除预建档记录
  await User.findByIdAndDelete(id);
  return true;
}

/**
 * 批量删除预建档记录
 * 仅待认领（pending_claim）状态可删除；非该状态的记录返回到 failed 列表
 * 一次性查询、批量删除、统一广播一次 WS，避免逐条删除产生大量请求与广播
 * @param {string[]} ids - 待删除的预建档 ID 列表
 * @returns {{success: string[], failed: Array<{id:string, reason:string}>, total: number, deleted: number}}
 */
async function batchDeletePreMembers(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('请选择要删除的记录');
  }
  // 过滤无效 ID（类型校验，避免注入异常 ObjectId）
  const validIds = ids.filter(id => {
    try {
      return id && mongoose.isValidObjectId(id);
    } catch (e) {
      return false;
    }
  });
  if (validIds.length === 0) {
    throw new Error('请选择要删除的记录');
  }

  // 一次性查询所有符合条件的预建档（pending_claim 状态）
  const users = await User.find({
    _id: { $in: validIds },
    member_status: 'pending_claim'
  }).select('_id store_id real_name');

  const deletableIds = users.map(u => u._id);
  const deletableIdStrings = deletableIds.map(id => id.toString());
  // 找出失败项（不在 deletableIds 中的）
  const failed = validIds
    .filter(id => deletableIdStrings.indexOf(id.toString()) === -1)
    .map(id => ({ id: id.toString(), reason: '记录不存在或非待认领状态' }));

  if (deletableIds.length > 0) {
    // 一次性删除关联的套餐记录
    await UserPackage.deleteMany({ user_id: { $in: deletableIds } });
    // 一次性删除预建档记录
    await User.deleteMany({ _id: { $in: deletableIds } });

    // 统一广播一次（避免逐条广播）
    const storeIds = [...new Set(
      users.map(u => u.store_id ? u.store_id.toString() : null).filter(Boolean)
    )];
    notifyPreMemberChange('delete_batch', {
      count: deletableIds.length,
      user_ids: deletableIdStrings,
      store_ids: storeIds
    });
  }

  return {
    success: deletableIdStrings,
    failed,
    total: validIds.length,
    deleted: deletableIds.length
  };
}

/**
 * 认领匹配逻辑（原子操作，防并发）
 * 在微信登录时调用，匹配成功则将预建档转为正式会员
 *
 * @param {string} wechatPhone - 微信授权手机号
 * @param {string} openid - 微信 openid
 * @returns {Object|null} 匹配成功返回用户对象，失败返回 null
 */
async function claimByPhone(wechatPhone, openid) {
  if (!wechatPhone || !openid) return null;

  // 原子更新：member_status='pending_claim' 作为乐观锁条件，防止并发重复认领
  const result = await User.findOneAndUpdate(
    {
      reserve_phone: wechatPhone,
      member_status: 'pending_claim'  // 乐观锁条件
    },
    {
      $set: {
        member_status: 'official',
        wechat_phone: wechatPhone,
        openid: openid,
        info_completed: true,
        claimed_at: new Date()
      }
    },
    { returnDocument: 'after' }
  );

  // 豁免次数已在创建预建档时按归属门店写入（见 createPreMember / 批量导入），认领时不再改动

  if (result) {
    notifyPreMemberChange('claim', {
      user_id: result._id,
      store_id: result.store_id ? result.store_id.toString() : null,
      member_status: result.member_status,
      real_name: result.real_name
    });
  }

  return result;  // 未匹配返回 null
}

/**
 * 存量预建档自动合并（会员登录时触发）
 *
 * 场景：会员先注册登录（openid 已有正式账号），之后管理员才录入预建档，
 *       导致同手机号存在"正式账号 + 待认领预建档"双记录，预建档永远停在待认领。
 * 处理：
 *   1. 待认领预建档的套餐（UserPackage）全部转移到当前登录账号
 *   2. 回填当前账号缺失的预留手机号/归属门店/真实姓名（仅在为空时填充，不覆盖已有数据）
 *   3. 写入 claimed_at 认领标记（合并等同于认领完成，使其在预建档管理页"已认领"列表可见）
 *   4. 删除已合并的僵尸预建档记录
 *   5. WebSocket 通知管理端刷新
 *
 * @param {string} phone - 手机号（预留/微信授权）
 * @param {string} targetUserId - 当前登录的正式账号ID
 * @returns {Promise<Object|null>} 合并结果，未命中待合并预建档返回 null
 */
async function mergePendingClaimByPhone(phone, targetUserId) {
  if (!phone || !targetUserId) return null;

  const currentUser = await User.findById(targetUserId).select('reserve_phone store_id real_name claimed_at');
  if (!currentUser) return null;

  // 查找同手机号的待认领预建档（排除当前账号自身）
  const pendingClaims = await User.find({
    _id: { $ne: currentUser._id },
    member_status: 'pending_claim',
    $or: [
      { reserve_phone: phone },
      { wechat_phone: phone }
    ]
  });
  if (pendingClaims.length === 0) return null;

  const merged = [];
  for (const pending of pendingClaims) {
    // 1. 转移套餐到当前账号（保留套餐 _id，Booking/PackageActivation 等引用不受影响）
    const transferResult = await UserPackage.updateMany(
      { user_id: pending._id },
      { $set: { user_id: currentUser._id } }
    );
    // 2. 回填当前账号缺失的信息（仅空值时填充，不覆盖已有数据）
    if (!currentUser.reserve_phone && pending.reserve_phone) currentUser.reserve_phone = pending.reserve_phone;
    if (!currentUser.store_id && pending.store_id) currentUser.store_id = pending.store_id;
    if (!currentUser.real_name && pending.real_name) currentUser.real_name = pending.real_name;
    // 合并等同于认领完成：写入认领标记，使其在预建档管理页"已认领"列表可查询
    if (!currentUser.claimed_at) currentUser.claimed_at = new Date();
    // 3. 删除僵尸预建档记录
    await User.deleteOne({ _id: pending._id });
    merged.push({
      pre_member_id: pending._id,
      real_name: pending.real_name,
      transferred_packages: transferResult.modifiedCount || 0
    });
  }
  await currentUser.save();

  // 4. 通知管理端刷新
  notifyPreMemberChange('merge', {
    user_id: currentUser._id,
    phone: phone.substring(0, 3) + '****' + phone.substring(7),
    merged_count: merged.length,
    real_name: currentUser.real_name
  });

  return { user_id: currentUser._id, merged };
}

/**
 * 门店名称模糊匹配（与 routes 层 cleanStoreName 等效）
 * 支持：精确匹配 / 去括号短名匹配 / 括号关键词匹配 / 包含匹配
 * @param {string} input - 用户输入的门店名称
 * @param {Object} storeMap - { 门店全名: storeId }
 * @returns {string|null} 匹配到的门店全名，未匹配返回 null
 */
function fuzzyMatchStoreName(input, storeMap) {
  if (!input) return null;

  // 0. 规范化括号：把半角括号统一成全角括号，避免"舞栖舞蹈社(固戍店)"与"舞栖舞蹈社（固戍店）"因括号类型不同匹配失败
  const normalizedInput = String(input).replace(/\(/g, '（').replace(/\)/g, '）').trim();

  // 1. 精确匹配（最高优先级）
  if (storeMap[normalizedInput]) return normalizedInput;
  if (storeMap[input]) return input;

  const names = Object.keys(storeMap);
  if (names.length === 0) return null;

  const inputHasBracket = /[（(].+?[）)]/.test(normalizedInput);

  // 2. 括号内关键词匹配（如"固戍" / "固戍店" 匹配"舞栖舞蹈社（固戍店）"）
  //    仅当 input 本身不含括号时才走关键词匹配，避免"舞栖舞蹈社（固戍店）"误匹配到"舞栖舞蹈社（福永店）"
  if (!inputHasBracket) {
    for (const fullName of names) {
      const bracketMatch = fullName.match(/[（(](.+?)[）)]/);
      if (bracketMatch) {
        const keyword = bracketMatch[1];
        // 互相包含即可匹配："固戍店"含"固戍"，"固戍"也含在"固戍店"里
        if (keyword && (normalizedInput.includes(keyword) || keyword.includes(normalizedInput))) return fullName;
      }
    }
    // 3. 去括号短名匹配（如"舞栖"匹配"舞栖舞蹈社（固戍店）"）
    for (const fullName of names) {
      const shortName = fullName.replace(/[（(].*?[）)]/, '').trim();
      if (shortName && (normalizedInput === shortName || normalizedInput.includes(shortName) || shortName.includes(normalizedInput))) {
        return fullName;
      }
    }
  }

  // 4. 短名包含匹配（如"舞栖"匹配"舞栖舞蹈社（固戍店）"），input 不含括号时才走
  if (!inputHasBracket) {
    for (const fullName of names) {
      if (fullName.includes(normalizedInput)) return fullName;
    }
  }

  return null;
}

/**
 * 批量导入预建档记录
 * 支持同会员多套餐：同手机号+同姓名的多行合并为一个会员，每行一个套餐
 * @param {Array} rows - 解析后的行数据
 * @param {string} operatorId - 操作员ID
 * @returns {Object} 导入结果
 */
async function importPreMembers(rows, operatorId) {
  const results = {
    total: rows.length,
    passed: 0,
    failed: 0,
    errors: [],
    validRows: []
  };

  // 预加载门店列表（用于门店名称匹配 + 默认豁免次数）
  const stores = await Store.find({ status: 'active' }).select('_id name default_exemption_count').lean();
  const storeMap = {};
  const storeDocMap = {};  // name -> 门店文档（含 default_exemption_count）
  stores.forEach(s => {
    storeMap[s.name] = s._id;
    storeDocMap[s.name] = s;
  });

  // 预加载舞种列表（用于舞种名称匹配）
  const danceStyles = await DanceStyle.find({ status: 'active' }).select('_id name').lean();
  const danceStyleMap = {};  // name -> _id
  danceStyles.forEach(ds => {
    danceStyleMap[ds.name] = ds._id;
  });

  // 1. 同手机号不同姓名冲突检测（文件内）
  const phoneToNames = {};  // phone -> Set<name>
  rows.forEach((row, index) => {
    const phone = String(row.reserve_phone || '').trim();
    const name = String(row.real_name || '').trim();
    if (phone && name) {
      if (!phoneToNames[phone]) phoneToNames[phone] = new Set();
      phoneToNames[phone].add(name);
    }
  });
  const conflictPhones = {};
  Object.keys(phoneToNames).forEach(phone => {
    if (phoneToNames[phone].size > 1) {
      conflictPhones[phone] = Array.from(phoneToNames[phone]).join(' / ');
    }
  });

  // 2. 逐行校验
  for (const row of rows) {
    const rowNum = row._rowNum || 0;
    const errors = [];

    // 同手机号不同姓名冲突
    const phone = String(row.reserve_phone || '').trim();
    if (conflictPhones[phone]) {
      errors.push(`手机号${phone}出现不同姓名（${conflictPhones[phone]}），请核对`);
    }

    // 门店名称校验（带模糊匹配）
    if (!row.store_name) {
      errors.push('门店名称不能为空');
    } else {
      const matchedName = fuzzyMatchStoreName(row.store_name, storeMap);
      if (!matchedName) {
        const validNames = Object.keys(storeMap).join(' / ');
        errors.push(`门店名称"${row.store_name}"不匹配，可选门店：${validNames}`);
      } else {
        row._store_name_matched = matchedName;  // 用匹配后的全名
      }
    }

    // 会员姓名校验
    if (!row.real_name || !row.real_name.trim()) {
      errors.push('会员姓名不能为空');
    } else if (row.real_name.length > 20) {
      errors.push('会员姓名最长 20 字');
    }

    // 手机号格式校验
    if (!row.reserve_phone) {
      errors.push('预留手机号不能为空');
    } else {
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(String(row.reserve_phone))) {
        errors.push('预留手机号格式不正确');
      }
    }

    // 性别校验
    if (row.gender !== '男' && row.gender !== '女') {
      errors.push('性别仅可填「男」或「女」');
    } else {
      row._gender_num = row.gender === '男' ? 1 : 2;
    }

    // 套餐字段联动校验
    if (row.package_type) {
      if (!['次卡', '时间卡'].includes(row.package_type)) {
        errors.push('套餐类型仅可填「次卡 / 时间卡」');
      } else {
        row._package_type = row.package_type === '次卡' ? 'count_card' : 'time_card';

        // 激活方式校验：已激活（默认）/ 待激活
        if (row.activate_mode && !['已激活', '待激活'].includes(row.activate_mode)) {
          errors.push('激活方式仅可填「已激活 / 待激活」（留空默认已激活）');
        } else {
          row._activate_mode = row.activate_mode === '待激活' ? 'pending' : 'active';
        }

        // 有效期校验（两种模式均必填：已激活直接用起止日期；待激活按起止日期跨度推算时长）
        if (!row.start_date) {
          errors.push('填写了套餐类型时，有效期开始日期必填');
        }
        if (!row.end_date) {
          errors.push('填写了套餐类型时，有效期结束日期必填');
        }
        if (row.start_date && row.end_date) {
          const startDate = new Date(row.start_date);
          const endDate = new Date(row.end_date);
          if (isNaN(startDate.getTime())) {
            errors.push('有效期开始日期格式不正确（应为 YYYY-MM-DD）');
          }
          if (isNaN(endDate.getTime())) {
            errors.push('有效期结束日期格式不正确（应为 YYYY-MM-DD）');
          }
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && startDate >= endDate) {
            errors.push('有效期开始日期必须早于结束日期');
          }
        }

        // 次卡专属校验
        if (row._package_type === 'count_card') {
          if (!row.total_credits || isNaN(Number(row.total_credits)) || Number(row.total_credits) <= 0) {
            errors.push('次卡必须填写总次数（纯数字，大于0）');
          }
        }

        // 时间卡专属校验（新逻辑：使用周期限制方式 + 限制次数两列）
        if (row._package_type === 'time_card') {
          const periodType = row.period_type || '';
          if (!['每日限制', '每周限制', '每月限制', '不限'].includes(periodType)) {
            errors.push('时间卡周期限制方式仅可填「每日限制 / 每周限制 / 每月限制 / 不限」');
          } else {
            if (periodType === '不限') {
              row._period_type = 'unlimited';
              row._period_count = 0;
            } else {
              row._period_type = periodType === '每日限制' ? 'daily' : (periodType === '每月限制' ? 'monthly' : 'weekly');
              if (!row.period_count || isNaN(Number(row.period_count)) || Number(row.period_count) <= 0) {
                errors.push('选择每日/每周/每月限制时，限制次数必填（纯数字，大于0）');
              } else {
                row._period_count = Number(row.period_count);
              }
            }
          }
        }
      }
    }

    // 附加门店校验（仅在有套餐时，带模糊匹配）
    if (row.package_type && row.extra_store_names) {
      const names = String(row.extra_store_names).split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const extraIds = [];
      const mainStoreName = row._store_name_matched || row.store_name;
      for (const name of names) {
        const matched = fuzzyMatchStoreName(name, storeMap);
        if (matched === mainStoreName) {
          errors.push(`附加门店不应包含主门店"${name}"`);
        } else if (!matched) {
          const validNames = Object.keys(storeMap).join(' / ');
          errors.push(`附加门店"${name}"不匹配，可选门店：${validNames}`);
        } else {
          extraIds.push(storeMap[matched]);
        }
      }
      row._extra_store_ids = extraIds;
    }

    // 舞种限制校验（仅在有套餐时，按舞种名称匹配）
    if (row.package_type && row.dance_style_names) {
      const names = String(row.dance_style_names).split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const danceStyleIds = [];
      for (const name of names) {
        if (danceStyleMap[name]) {
          danceStyleIds.push(danceStyleMap[name]);
        } else {
          const validNames = Object.keys(danceStyleMap).join(' / ');
          errors.push(`舞种"${name}"不匹配，可选舞种：${validNames}`);
        }
      }
      row._dance_style_limit = danceStyleIds;
    }

    if (errors.length > 0) {
      results.errors.push({ row: rowNum, reason: errors.join('；') });
      results.failed++;
      row._invalid = true;
    } else {
      results.validRows.push(row);
      results.passed++;
    }
  }

  // 3. 同组内套餐完全重复校验（同 phone+name + 同 package_type + 同起止日期）
  const groupKey = (r) => `${r.reserve_phone}|${r.real_name.trim()}`;
  const groupMap = {};  // key -> { rows: [] }
  results.validRows.forEach(r => {
    const k = groupKey(r);
    if (!groupMap[k]) groupMap[k] = { rows: [] };
    groupMap[k].rows.push(r);
  });
  Object.keys(groupMap).forEach(k => {
    const group = groupMap[k];
    if (group.rows.length < 2) return;
    for (let i = 0; i < group.rows.length; i++) {
      for (let j = i + 1; j < group.rows.length; j++) {
        const a = group.rows[i];
        const b = group.rows[j];
        if (a._package_type && b._package_type &&
            a._package_type === b._package_type &&
            String(a.start_date) === String(b.start_date) &&
            String(a.end_date) === String(b.end_date)) {
          results.errors.push({
            row: b._rowNum || 0,
            reason: `与第${a._rowNum || 0}行套餐完全重复（同类型+同起止日期）`
          });
          b._invalid = true;
          results.passed--;
          results.failed++;
        }
      }
    }
    group.rows = group.rows.filter(r => !r._invalid);
  });

  // 4. 全局唯一性批量校验
  // 策略：
  //   - DB 中已有 pending_claim 会员：把 Excel 中的套餐追加到该会员（不创建新 User）
  //     但要校验套餐不与该会员已有套餐完全重复（同类型+同起止日期）
  //   - DB 中已有 registered / official 会员：拒绝（不能给已注册/正式会员追加预建档套餐）
  const stillValidAfterDedup = results.validRows.filter(r => !r._invalid);
  if (stillValidAfterDedup.length > 0) {
    const phones = [...new Set(stillValidAfterDedup.map(r => r.reserve_phone))];
    const existing = await User.find({
      // 同时校验预留手机号与微信授权手机号，防止同手机号产生双账号
      $or: [
        { reserve_phone: { $in: phones } },
        { wechat_phone: { $in: phones } }
      ],
      member_status: { $in: ['pending_claim', 'registered', 'official'] }
    }).select('reserve_phone wechat_phone member_status store_id real_name').lean();

    const existingMap = {};
    existing.forEach(u => {
      const key = u.reserve_phone || u.wechat_phone;
      if (!key) return;
      const prev = existingMap[key];
      // 同手机号存在多条记录（历史双账号数据）时，正式/待审核账号优先于待认领预建档
      if (!prev || (prev.member_status === 'pending_claim' && u.member_status !== 'pending_claim')) {
        existingMap[key] = u;  // 保存完整 user 对象供追加套餐使用
      }
    });

    // 查询所有待追加会员的已有套餐，用于重复校验
    const appendUserIds = Object.values(existingMap)
      .filter(u => u.member_status === 'pending_claim')
      .map(u => u._id);
    const existingPackages = appendUserIds.length > 0
      ? await UserPackage.find({ user_id: { $in: appendUserIds } })
          .select('user_id package_type start_date end_date').lean()
      : [];
    // 按 user_id 分组，建立 (package_type + start_date + end_date) 集合
    const existingPkgMap = {};
    existingPackages.forEach(p => {
      const uid = p.user_id.toString();
      if (!existingPkgMap[uid]) existingPkgMap[uid] = new Set();
      const startStr = p.start_date ? new Date(p.start_date).toISOString().slice(0, 10) : '';
      const endStr = p.end_date ? new Date(p.end_date).toISOString().slice(0, 10) : '';
      existingPkgMap[uid].add(`${p.package_type}|${startStr}|${endStr}`);
    });

    const stillValid = [];
    stillValidAfterDedup.forEach(row => {
      const existingUser = existingMap[row.reserve_phone];
      if (existingUser) {
        if (existingUser.member_status === 'pending_claim') {
          // 校验姓名一致（防止同手机号不同人）
          if (existingUser.real_name && row.real_name.trim() && existingUser.real_name !== row.real_name.trim()) {
            results.errors.push({
              row: row._rowNum || 0,
              reason: `该手机号已存在待认领会员"${existingUser.real_name}"，与当前行姓名"${row.real_name.trim()}"不一致`
            });
            results.passed--;
            results.failed++;
            return;
          }
          // 校验套餐是否与 DB 已有套餐完全重复（仅当本行有套餐时）
          if (row._package_type) {
            const uid = existingUser._id.toString();
            const startStr = row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : '';
            const endStr = row.end_date ? new Date(row.end_date).toISOString().slice(0, 10) : '';
            const pkgKey = `${row._package_type}|${startStr}|${endStr}`;
            if (existingPkgMap[uid] && existingPkgMap[uid].has(pkgKey)) {
              results.errors.push({
                row: row._rowNum || 0,
                reason: `该会员已存在相同套餐（同类型+同起止日期），不能重复导入`
              });
              results.passed--;
              results.failed++;
              return;
            }
          }
          // 校验通过：标记 _appendToUserId 供写入阶段使用
          row._appendToUserId = existingUser._id;
          row._appendToStoreId = existingUser.store_id;
          stillValid.push(row);
        } else {
          // registered / official：拒绝
          const statusMap = {
            'registered': '待审核',
            'official': '正式会员'
          };
          results.errors.push({
            row: row._rowNum || 0,
            reason: `该手机号已存在${statusMap[existingUser.member_status]}账号，不能追加预建档套餐`
          });
          results.passed--;
          results.failed++;
        }
      } else {
        stillValid.push(row);
      }
    });
    results.validRows = stillValid;
  } else {
    results.validRows = stillValidAfterDedup;
  }

  // 5. 按组写入（同 phone+name 的多行合并为一个会员，每行一个套餐）
  //     支持 _appendToUserId：该组是追加套餐到已有 pending_claim 会员，不创建新 User
  if (results.validRows.length > 0) {
    // 重新分组（基于最终 validRows）
    const writeGroupMap = {};
    const writeOrder = [];  // 保持首次出现顺序
    results.validRows.forEach(r => {
      const k = groupKey(r);
      if (!writeGroupMap[k]) {
        writeGroupMap[k] = { rows: [] };
        writeOrder.push(k);
      }
      writeGroupMap[k].rows.push(r);
    });

    const createdUsers = [];
    const appendedUsers = [];  // 追加套餐的已有会员
    const packagesToCreate = [];

    for (const k of writeOrder) {
      const group = writeGroupMap[k].rows;
      const firstRow = group[0];

      // 判断是新建会员还是追加套餐到已有会员
      const isAppend = !!firstRow._appendToUserId;
      let userId, storeId;

      try {
        if (isAppend) {
          // 追加套餐到已有 pending_claim 会员
          userId = firstRow._appendToUserId;
          storeId = firstRow._appendToStoreId;
          appendedUsers.push({ _id: userId, store_id: storeId });
        } else {
          // 新建会员
          const matchedStoreName = firstRow._store_name_matched || firstRow.store_name;
          storeId = storeMap[matchedStoreName];
          const member_code = await memberService.generateMemberCode(storeId);
          // 归属门店的默认豁免次数（与新注册会员同口径：门店级 → 全局配置 → 默认2）
          const exemptionCount = await getStoreDefaultExemptionCount(storeDocMap[matchedStoreName]);
          const userData = {
            user_type: 'member',
            member_status: 'pending_claim',
            member_identity: 'old', // 批量导入固定为老会员
            member_code,
            real_name: firstRow.real_name.trim(),
            gender: firstRow._gender_num,
            reserve_phone: firstRow.reserve_phone,
            store_id: storeId,
            exemption_count: exemptionCount,
            info_completed: true,
            remark: firstRow.remark || '',
            created_by: operatorId
          };
          const user = await User.create(userData);
          userId = user._id;
          createdUsers.push(user);
        }

        // 为该会员创建所有套餐（每行一个套餐）
        for (const row of group) {
          if (!row._package_type) continue;
          const startDateObj = new Date(row.start_date);
          const endDateObj = new Date(row.end_date);
          // 激活方式：待激活时按起止日期跨度推算时长，激活时从激活日重新计算起止
          const usePendingMode = row._activate_mode === 'pending';
          const now = new Date();
          const packageData = {
            user_id: userId,
            store_id: storeId,
            extra_store_ids: row._extra_store_ids || [],
            package_type: row._package_type,
            is_activated: !usePendingMode,
            status: !usePendingMode ? 'active' : 'pending',
            activated_at: !usePendingMode ? now : null,
            auto_activate_at: usePendingMode ? new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000) : null,
            created_by: operatorId,
            remark: row.remark || '',
            dance_style_limit: row._dance_style_limit || []
          };

          // 根据起止日期计算 duration_value/duration_unit：
          //   已激活：作为展示信息；待激活：作为卡面时长，激活时从激活日重新计算起止
          const duration = calcDurationFromDates(startDateObj, endDateObj);
          if (duration.value > 0) {
            packageData.duration_value = duration.value;
            packageData.duration_unit = duration.unit;
          }

          if (usePendingMode) {
            // 待激活：不写起止日期，激活时由 package.service 计算
            packageData.start_date = null;
            packageData.end_date = null;
          } else {
            packageData.start_date = startDateObj;
            packageData.end_date = endDateObj;
          }

          if (row._package_type === 'count_card') {
            packageData.total_credits = Number(row.total_credits);
            packageData.remaining_credits = Number(row.total_credits);
          } else {
            // 时间卡：使用校验后的周期类型和次数
            packageData.total_credits = 0;
            packageData.remaining_credits = 0;
            if (row._period_type === 'weekly') {
              packageData.weekly_limit = Number(row._period_count);
            } else if (row._period_type === 'daily') {
              packageData.daily_limit = Number(row._period_count);
            } else if (row._period_type === 'monthly') {
              packageData.monthly_limit = Number(row._period_count);
            }
            // unlimited: 不设置 weekly_limit / daily_limit / monthly_limit
          }

          packagesToCreate.push(packageData);
        }
      } catch (err) {
        // 创建/追加失败：整组所有行标记失败
        for (const row of group) {
          results.errors.push({
            row: row._rowNum || 0,
            reason: err.message || (isAppend ? '追加套餐失败' : '创建会员失败')
          });
          results.failed++;
          results.passed--;
        }
      }
    }

    if (packagesToCreate.length > 0) {
      await UserPackage.insertMany(packagesToCreate);
    }

    results.imported_count = createdUsers.length + appendedUsers.length;

    // 通知：新建的会员 + 追加套餐的已有会员，都触发列表刷新
    const allAffectedStoreIds = [
      ...createdUsers.map(u => u.store_id ? u.store_id.toString() : null),
      ...appendedUsers.map(u => u.store_id ? u.store_id.toString() : null)
    ].filter(Boolean);
    notifyPreMemberChange('import', {
      count: results.imported_count,
      store_ids: allAffectedStoreIds
    });
  } else {
    results.imported_count = 0;
  }

  return results;
}

module.exports = {
  checkPhoneUnique,
  getPreMemberList,
  getPreMemberStats,
  createPreMember,
  updatePreMember,
  deletePreMember,
  batchDeletePreMembers,
  claimByPhone,
  mergePendingClaimByPhone,
  importPreMembers,
  createPackageForUser
};
