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
    reserve_phone: reservePhone,
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
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(pageSize))
      .lean(),
    User.countDocuments(filter)
  ]);

  // 为每条记录查询套餐信息
  const userIds = list.map(u => u._id);
  const packages = userIds.length > 0 ? await UserPackage.find({
    user_id: { $in: userIds }
  }).lean() : [];

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
 */
async function getPreMemberStats(storeId = null) {
  const filter = { member_status: 'pending_claim' };
  if (storeId) {
    try {
      filter.store_id = new mongoose.Types.ObjectId(storeId);
    } catch (e) {
      // store_id 无效时不添加筛选条件
    }
  }
  const count = await User.countDocuments(filter);
  return { pending_claim_count: count };
}

/**
 * 创建预建档记录
 */
async function createPreMember(data, operatorId) {
  const { real_name, gender, reserve_phone, store_id, package: packageData, remark, member_identity } = data;

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

  // 校验门店存在
  const store = await Store.findById(store_id).select('_id name');
  if (!store) {
    throw new Error('门店不存在');
  }

  // 校验手机号全局唯一
  const phoneCheck = await checkPhoneUnique(reserve_phone);
  if (!phoneCheck.unique) {
    throw new Error(phoneCheck.reason);
  }

  // 生成会员编号，规则与自主注册会员一致
  const member_code = await memberService.generateMemberCode(store_id);

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
    info_completed: true,
    remark: remark || '',
    created_by: operatorId
    // openid/wechat_phone 留空，认领时回填
  });

  // 如有套餐信息，创建 UserPackage 记录
  if (packageData && packageData.package_type) {
    await createPackageForUser(user._id, store_id, packageData, operatorId, member_identity === 'old');
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
 */
async function createPackageForUser(userId, storeId, packageData, operatorId, isOldMember = false) {
  const { package_type, total_credits, start_date, end_date, duration_value, duration_unit, weekly_limit, daily_limit, remark, extra_store_ids } = packageData;

  if (!package_type || !['count_card', 'time_card'].includes(package_type)) {
    throw new Error('套餐类型必须为次卡(count_card)或时间卡(time_card)');
  }

  // 老会员必须传 start_date/end_date；新会员必须传 duration_value
  if (isOldMember) {
    if (!start_date || !end_date) {
      throw new Error('老会员必须填写套餐有效期起止日期');
    }
  } else {
    if (!duration_value || Number(duration_value) <= 0) {
      throw new Error('新会员必须填写套餐有效期时长');
    }
  }

  if (package_type === 'count_card' && (!total_credits || total_credits <= 0)) {
    throw new Error('次卡必须填写总次数');
  }
  if (package_type === 'time_card' && !weekly_limit && !daily_limit) {
    throw new Error('时间卡必须填写周期限制');
  }

  const now = new Date();
  const packageRecord = {
    user_id: userId,
    store_id: storeId,
    extra_store_ids: extra_store_ids || [],
    package_type: package_type,
    is_activated: isOldMember,
    activated_at: isOldMember ? now : null,
    status: isOldMember ? 'active' : 'pending',
    auto_activate_at: isOldMember ? null : new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
    created_by: operatorId,
    remark: remark || ''
  };

  if (isOldMember) {
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
    // 新会员：duration_value/duration_unit 存入记录，激活时由 package.service 计算起止日期
    packageRecord.duration_value = Number(duration_value);
    packageRecord.duration_unit = duration_unit || 'month';
    packageRecord.start_date = null;
    packageRecord.end_date = null;
  }

  if (package_type === 'count_card') {
    packageRecord.total_credits = Number(total_credits);
    packageRecord.remaining_credits = Number(total_credits);
  } else {
    // 时间卡
    packageRecord.total_credits = 0;
    packageRecord.remaining_credits = 0;
    if (weekly_limit) packageRecord.weekly_limit = Number(weekly_limit);
    if (daily_limit) packageRecord.daily_limit = Number(daily_limit);
  }

  return await UserPackage.create(packageRecord);
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
    const store = await Store.findById(store_id).select('_id');
    if (!store) throw new Error('门店不存在');
    user.store_id = store_id;
  }
  if (remark !== undefined) user.remark = remark;

  user.updated_by = operatorId;
  await user.save();

  // 如有套餐信息变更，更新套餐
  if (data.package) {
    // 删除旧套餐，创建新套餐
    await UserPackage.deleteMany({ user_id: id });
    if (data.package.package_type) {
      await createPackageForUser(id, user.store_id, data.package, operatorId);
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
 * 批量导入预建档记录
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

  // 预加载门店列表（用于门店名称匹配）
  const stores = await Store.find({ status: 'active' }).select('_id name').lean();
  const storeMap = {};
  stores.forEach(s => {
    storeMap[s.name] = s._id;
  });

  // 1. 文件内手机号去重校验
  const phoneSet = new Set();
  const rowNumMap = {};  // 手机号 -> 首次出现的行号
  rows.forEach((row, index) => {
    const phone = row.reserve_phone;
    if (phone) {
      if (phoneSet.has(phone)) {
        results.errors.push({
          row: row._rowNum || index + 2,
          reason: `文件内手机号重复（首次出现在第 ${rowNumMap[phone]} 行）`
        });
        row._invalid = true;
      } else {
        phoneSet.add(phone);
        rowNumMap[phone] = row._rowNum || index + 2;
      }
    }
  });

  // 2. 逐行校验
  for (const row of rows) {
    if (row._invalid) {
      results.failed++;
      continue;
    }

    const rowNum = row._rowNum || 0;
    const errors = [];

    // 门店名称校验
    if (!row.store_name) {
      errors.push('门店名称不能为空');
    } else if (!storeMap[row.store_name]) {
      const validNames = Object.keys(storeMap).join(' / ');
      errors.push(`门店名称"${row.store_name}"不匹配，可选门店：${validNames}`);
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
      if (!phoneRegex.test(row.reserve_phone)) {
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

        // 有效期校验
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
          if (!['每日限制', '每周限制', '无限次'].includes(periodType)) {
            errors.push('时间卡周期限制方式仅可填「每日限制 / 每周限制 / 无限次」');
          } else {
            if (periodType === '无限次') {
              row._period_type = 'unlimited';
              row._period_count = 0;
            } else {
              row._period_type = periodType === '每日限制' ? 'daily' : 'weekly';
              if (!row.period_count || isNaN(Number(row.period_count)) || Number(row.period_count) <= 0) {
                errors.push('选择每日/每周限制时，限制次数必填（纯数字，大于0）');
              } else {
                row._period_count = Number(row.period_count);
              }
            }
          }
        }
      }
    }

    // 附加门店校验（仅在有套餐时）
    if (row.package_type && row.extra_store_names) {
      const names = row.extra_store_names.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const extraIds = [];
      for (const name of names) {
        if (name === row.store_name) {
          errors.push(`附加门店不应包含主门店"${name}"`);
        } else if (!storeMap[name]) {
          const validNames = Object.keys(storeMap).join(' / ');
          errors.push(`附加门店"${name}"不匹配，可选门店：${validNames}`);
        } else {
          extraIds.push(storeMap[name]);
        }
      }
      row._extra_store_ids = extraIds;
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

  // 3. 全局唯一性批量校验（对通过校验的手机号查询数据库）
  if (results.validRows.length > 0) {
    const phones = results.validRows.map(r => r.reserve_phone);
    const existing = await User.find({
      reserve_phone: { $in: phones },
      member_status: { $in: ['pending_claim', 'registered', 'official'] }
    }).select('reserve_phone member_status').lean();

    const existingMap = {};
    existing.forEach(u => {
      existingMap[u.reserve_phone] = u.member_status;
    });

    const stillValid = [];
    results.validRows.forEach(row => {
      if (existingMap[row.reserve_phone]) {
        const statusMap = {
          'pending_claim': '待认领',
          'registered': '待审核',
          'official': '正式会员'
        };
        results.errors.push({
          row: row._rowNum || 0,
          reason: `该手机号已存在${statusMap[existingMap[row.reserve_phone]]}账号`
        });
        results.passed--;
        results.failed++;
      } else {
        stillValid.push(row);
      }
    });
    results.validRows = stillValid;
  }

  // 4. 逐行写入（通过校验的行即可导入，不要求全部通过）
  if (results.validRows.length > 0) {
    const createdUsers = [];
    const packagesToCreate = [];

    for (const row of results.validRows) {
      const storeId = storeMap[row.store_name];
      const member_code = await memberService.generateMemberCode(storeId);
      const userData = {
        user_type: 'member',
        member_status: 'pending_claim',
        member_identity: 'old', // 批量导入固定为老会员
        member_code,
        real_name: row.real_name.trim(),
        gender: row._gender_num,
        reserve_phone: row.reserve_phone,
        store_id: storeId,
        info_completed: true,
        remark: row.remark || '',
        created_by: operatorId
      };

      try {
        const user = await User.create(userData);
        createdUsers.push(user);

        // 创建套餐记录
        if (row._package_type) {
          const startDateObj = new Date(row.start_date);
          const endDateObj = new Date(row.end_date);
          const packageData = {
            user_id: user._id,
            store_id: user.store_id,
            extra_store_ids: row._extra_store_ids || [],
            package_type: row._package_type,
            start_date: startDateObj,
            end_date: endDateObj,
            is_activated: true, // 老会员套餐导入即生效
            status: 'active',
            activated_at: new Date(),
            created_by: operatorId,
            remark: row.remark || ''
          };

          // 批量导入的老会员套餐也根据起止日期计算 duration_value/duration_unit 供前端展示
          const duration = calcDurationFromDates(startDateObj, endDateObj);
          if (duration.value > 0) {
            packageData.duration_value = duration.value;
            packageData.duration_unit = duration.unit;
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
            }
            // unlimited: 不设置 weekly_limit / daily_limit
          }

          packagesToCreate.push(packageData);
        }
      } catch (err) {
        results.errors.push({
          row: row._rowNum || 0,
          reason: err.message || '创建会员失败'
        });
        results.failed++;
        results.passed--;
      }
    }

    if (packagesToCreate.length > 0) {
      await UserPackage.insertMany(packagesToCreate);
    }

    results.imported_count = createdUsers.length;

    notifyPreMemberChange('import', {
      count: results.imported_count,
      store_ids: createdUsers.map(u => u.store_id ? u.store_id.toString() : null).filter(Boolean)
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
  importPreMembers,
  createPackageForUser
};
