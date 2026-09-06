/**
 * 一次性数据修正：福永店 昨天和今天（2026-09-05 ~ 2026-09-06）预建档会员豁免次数统一改为 3
 *
 * 背景：旧代码创建预建档时未应用门店默认豁免次数（bug 已修复，但存量数据需修正）
 * 范围：福永店 9月5日-6日创建的预建档会员（含单个新建、批量导入、已认领的），
 *       通过 member_identity 字段识别预建档来源（普通自主注册会员无此字段，不受影响）
 *
 * 使用方法（生产服务器，二选一）：
 *   方式A. mongosh wuqi_dance --file fix-fuyong-exemption.js
 *   方式B. 进入 mongosh 后直接粘贴整个文件内容执行
 *
 * 安全设计：先打印预览（人数+名单+当前豁免分布），人工确认后再执行修改
 *   确认无误后，把最后一行 FIX_CONFIRMED 改为 true 再跑一次即执行修改
 */

const FIX_CONFIRMED = false; // ← 预览确认后改为 true 才会真正修改数据

// ===== 1. 找到福永店 =====
const fuyong = db.stores.findOne({ name: /福永/, status: 'active' });
if (!fuyong) { print('未找到福永店，终止'); quit(1); }
print('门店: ' + fuyong.name + ' (' + fuyong._id + ')');

// ===== 2. 目标会员：福永店 9月5-6日创建的预建档记录（北京时间） =====
const start = new Date('2026-09-05T00:00:00+08:00');
const end = new Date('2026-09-07T00:00:00+08:00');
const filter = {
  store_id: fuyong._id,
  member_identity: { $in: ['old', 'new'] },          // 预建档来源（批量导入=old，单个新建=old/new）
  member_status: { $in: ['pending_claim', 'official'] }, // 待认领 + 已认领
  created_at: { $gte: start, $lt: end }
};

// ===== 3. 预览 =====
const targets = db.users.find(filter,
  { real_name: 1, reserve_phone: 1, member_status: 1, exemption_count: 1, created_at: 1 }
).sort({ created_at: 1 }).toArray();

print('\n===== 预览 =====');
print('命中人数: ' + targets.length);
const dist = {};
targets.forEach(m => { dist[m.exemption_count] = (dist[m.exemption_count] || 0) + 1); });
print('当前豁免次数分布: ' + JSON.stringify(dist));
const statusDist = {};
targets.forEach(m => { statusDist[m.member_status] = (statusDist[m.member_status] || 0) + 1; });
print('状态分布: ' + JSON.stringify(statusDist));
print('\n名单:');
targets.forEach(m => print('  ' + m.real_name + ' | ' + m.reserve_phone + ' | ' +
  (m.member_status === 'pending_claim' ? '待认领' : '已认领') + ' | 当前豁免:' + m.exemption_count));

// ===== 4. 执行修改 =====
if (!FIX_CONFIRMED) {
  print('\n[预览模式] 未修改任何数据。核对名单无误后，把脚本第一行 FIX_CONFIRMED 改为 true 再执行一次。');
} else {
  const r = db.users.updateMany(filter, { $set: { exemption_count: 3 } });
  print('\n===== 执行结果 =====');
  print('匹配: ' + r.matchedCount + ' 条，修改: ' + r.modifiedCount + ' 条');

  // 复核
  const stillWrong = db.users.countDocuments({ ...filter, exemption_count: { $ne: 3 } });
  const nowDist = db.users.aggregate([
    { $match: filter },
    { $group: { _id: '$exemption_count', count: { $sum: 1 } } }
  ]).toArray();
  print('复核-仍非3次的: ' + stillWrong + ' 人');
  print('复核-修改后分布: ' + JSON.stringify(nowDist));
}
