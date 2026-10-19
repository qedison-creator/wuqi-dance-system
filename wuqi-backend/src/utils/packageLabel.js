/**
 * 套餐展示后缀工具（扣课溯源文案）
 *
 * 规则（用户 2026-10-15 定稿）：
 * - 拿不到套餐名与类型时后缀为空，绝不出现「已删除」
 * - 同一会员「同类型」未作废套餐有 2 张及以上时，后缀用具体套餐名（如「20次卡」）
 * - 只有 1 张时，后缀用类型词（如「次卡」/「时间卡」）
 *
 * 只依赖 UserPackage 模型，避免与 package.service 形成循环引用。
 */
const UserPackage = require('../models/UserPackage');

const TYPE_LABEL = { count_card: '次卡', time_card: '时间卡' };

/**
 * 计算展示后缀
 * @param {string} name - 套餐名（Booking.package_name 或 UserPackage.package_snapshot.name）
 * @param {string} type - 套餐类型 count_card / time_card
 * @param {number} sameTypeCount - 该会员同类型未作废套餐张数
 * @returns {string} 后缀（不含分隔符），无法判定时返回 ''
 */
function resolvePackageSuffix(name, type, sameTypeCount) {
  const n = (name || '').trim();
  const t = type || '';
  if (!n && !t) return '';
  if (n && Number(sameTypeCount) >= 2) return n;
  return TYPE_LABEL[t] || '';
}

/**
 * 批量统计各会员各类型未作废套餐张数
 * @param {Array} userIds - 会员ID数组（字符串或 ObjectId）
 * @returns {Promise<Object>} { [userId]: { count_card: n, time_card: n, total: n } }
 */
async function getMemberTypeCounts(userIds) {
  const ids = (userIds || []).filter(Boolean);
  const map = {};
  if (!ids.length) return map;
  const rows = await UserPackage.find(
    { user_id: { $in: ids }, status: { $ne: 'voided' } },
    'user_id package_type'
  ).lean();
  rows.forEach((p) => {
    const key = String(p.user_id);
    if (!map[key]) map[key] = { count_card: 0, time_card: 0, total: 0 };
    if (p.package_type === 'count_card') map[key].count_card += 1;
    else if (p.package_type === 'time_card') map[key].time_card += 1;
    map[key].total += 1;
  });
  return map;
}

/**
 * 单个套餐后缀（内部自取该会员同类型张数）
 * @param {Object} booking - 带 package_name / package_type / user_id 的对象
 */
async function suffixForBooking(booking) {
  if (!booking) return '';
  const counts = await getMemberTypeCounts([booking.user_id]);
  const c = counts[String(booking.user_id)] || {};
  return resolvePackageSuffix(booking.package_name, booking.package_type, c[booking.package_type] || 0);
}

/**
 * 构造 Booking 的套餐快照字段
 * @param {Object} pkg - UserPackage 文档
 */
function buildPackageFields(pkg) {
  if (!pkg) return { package_name: '', package_type: '' };
  const name = (pkg.package_snapshot && pkg.package_snapshot.name) || '';
  return { package_name: name, package_type: pkg.package_type || '' };
}

module.exports = {
  TYPE_LABEL,
  resolvePackageSuffix,
  getMemberTypeCounts,
  suffixForBooking,
  buildPackageFields,
};
