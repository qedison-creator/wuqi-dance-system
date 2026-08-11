/**
 * 门店归属校验工具
 * 用于校验目标记录的 store_id 是否在用户允许访问的门店列表内
 */

/**
 * 校验目标记录的门店归属
 * @param {Object|null} record - 目标记录（必须包含 store_id 字段）
 * @param {string[]} allowedStoreIds - 用户允许访问的门店ID列表（字符串数组）
 * @param {string} [recordName='记录'] - 记录名称（用于错误提示）
 * @returns {boolean} 校验通过返回 true
 * @throws {Error} 校验失败抛出业务错误（message 为提示文案）
 */
function checkStoreOwnership(record, allowedStoreIds, recordName = '记录') {
  // 记录不存在，交给上层处理（返回 404）
  if (!record) {
    return true;
  }

  // 允许列表为空，拒绝访问
  if (!allowedStoreIds || allowedStoreIds.length === 0) {
    throw new Error(`无权操作此${recordName}`);
  }

  // 记录无 store_id（全局数据），仅允许超管（由上层判断），此处拒绝
  if (!record.store_id) {
    throw new Error(`无权操作此${recordName}`);
  }

  const recordStoreId = String(record.store_id);
  if (!allowedStoreIds.includes(recordStoreId)) {
    throw new Error(`无权操作非所属门店的${recordName}`);
  }

  return true;
}

/**
 * 从 req.user 提取允许访问的门店ID列表
 * @param {Object} reqUser - req.user 对象
 * @returns {string[]|null} 门店ID列表，null 表示超管/审核员（不限门店）
 */
function getAllowedStoreIds(reqUser) {
  if (!reqUser) return [];

  const role = reqUser.role;
  if (role === 'super_admin' || role === 'reviewer') {
    return null; // 不限门店
  }

  // 会员端用户不受门店隔离限制，可查看所有门店
  // 注意：User 模型中 role 字段 enum 不含 'member'，会员用户 role 为 undefined，
  // 需通过 user_type === 'member' 判断会员身份
  if (role === 'member' || reqUser.user_type === 'member') {
    return null;
  }

  if (role === 'store_manager') {
    return (reqUser.store_ids || []).map(s => String(s));
  }

  if (role === 'staff') {
    return reqUser.store_id ? [String(reqUser.store_id)] : [];
  }

  return [];
}

/**
 * 校验单门店角色是否可查看/签到指定会员（用于扫码签到场景）
 * 规则：
 *   - 超管/审核员：直接通过
 *   - 会员归属门店在允许范围内：通过
 *   - 会员归属门店不在允许范围，但拥有跨门店可用套餐（UserPackage.store_id 或 extra_store_ids 命中允许门店）：通过
 *   - 否则：拒绝
 * @param {string} userId - 会员用户ID
 * @param {Object} reqUser - req.user 对象
 * @returns {Promise<{ok: boolean, reason?: string, crossStore?: boolean}>}
 */
async function assertMemberAccessibleForCheckin(userId, reqUser) {
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管/审核员：不限门店
  if (allowedStoreIds === null) {
    return { ok: true };
  }

  if (!allowedStoreIds || allowedStoreIds.length === 0) {
    return { ok: false, reason: '非本门店会员，无权限查看会员信息' };
  }

  const User = require('../models/User');
  const UserPackage = require('../models/UserPackage');

  const member = await User.findById(userId).select('store_id').lean();
  if (!member) {
    return { ok: false, reason: '会员不存在' };
  }

  // 会员归属门店在允许范围内：直接通过
  const memberStoreId = member.store_id ? String(member.store_id) : null;
  if (memberStoreId && allowedStoreIds.includes(memberStoreId)) {
    return { ok: true };
  }

  // 会员归属门店不在允许范围：检查是否有跨门店可用套餐
  // 跨门店套餐：UserPackage status=active，且 store_id 或 extra_store_ids 命中当前管理员所属门店
  const crossStorePackage = await UserPackage.findOne({
    user_id: userId,
    status: 'active',
    $or: [
      { store_id: { $in: allowedStoreIds } },
      { extra_store_ids: { $in: allowedStoreIds } },
    ],
  }).select('_id').lean();

  if (crossStorePackage) {
    return { ok: true, crossStore: true };
  }

  return { ok: false, reason: '非本门店会员，无权限查看会员信息' };
}

/**
 * 校验单门店角色是否可访问指定会员（用于会员详情页、列表等场景）
 * assertMemberAccessibleForCheckin 的语义别名，复用同一套跨门店套餐判定逻辑
 */
async function assertMemberAccessible(userId, reqUser) {
  return assertMemberAccessibleForCheckin(userId, reqUser);
}

/**
 * 校验单门店角色是否可操作（修改/删除）指定套餐
 * 规则：
 *   - 超管/审核员：直接通过
 *   - 套餐 store_id 命中允许门店：通过（原门店店长可编辑跨门店套餐）
 *   - 套餐 store_id 不在允许范围：拒绝
 *   - 套餐无 store_id（全局套餐）：拒绝（仅超管可操作）
 * @param {string} packageId - 套餐ID
 * @param {Object} reqUser - req.user 对象
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function assertPackageOwnership(packageId, reqUser) {
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管/审核员：不限门店
  if (allowedStoreIds === null) {
    return { ok: true };
  }

  if (!allowedStoreIds || allowedStoreIds.length === 0) {
    return { ok: false, reason: '无权操作该套餐' };
  }

  const UserPackage = require('../models/UserPackage');
  const pkg = await UserPackage.findById(packageId).select('store_id').lean();
  if (!pkg) {
    return { ok: false, reason: '套餐不存在' };
  }

  const pkgStoreId = pkg.store_id ? String(pkg.store_id) : null;
  if (!pkgStoreId || !allowedStoreIds.includes(pkgStoreId)) {
    return { ok: false, reason: '无权操作该套餐' };
  }

  return { ok: true };
}

/**
 * 校验单门店角色是否可操作（修改/审核/删除）指定会员的个人信息
 * 规则：
 *   - 超管/审核员：直接通过
 *   - 会员归属门店在允许范围内：通过
 *   - 跨门店套餐会员（通过套餐关系访问但非归属门店）：拒绝，不可修改个人信息
 * @param {string} userId - 会员用户ID
 * @param {Object} reqUser - req.user 对象
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function assertMemberOwnership(userId, reqUser) {
  const access = await assertMemberAccessible(userId, reqUser);
  if (!access.ok) {
    return access;
  }
  // 跨门店访问：可查看但不可修改个人信息
  if (access.crossStore) {
    return { ok: false, reason: '跨门店会员仅可查看，无权修改会员信息' };
  }
  return { ok: true };
}

module.exports = {
  checkStoreOwnership,
  getAllowedStoreIds,
  assertMemberAccessibleForCheckin,
  assertMemberAccessible,
  assertPackageOwnership,
  assertMemberOwnership,
};
