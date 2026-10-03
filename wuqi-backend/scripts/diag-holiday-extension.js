/**
 * 只读诊断：放假顺延数据全貌（不修改任何数据）
 *
 * 用途：原 fix-holiday-double-extension.js 检测到 48 条 bug 期"撤销放假顺延"记录后主动中止，
 *       因为"假期被编辑/撤销过"时净效果无法靠单条记录推断，需要先看全貌。
 *       本脚本按 时间批次 / 门店归属 / 套餐净额 三个维度输出，用于人工定修正方案。
 *
 * 使用方法：
 *   mongosh wuqi_dance --file ~/wuqi-dance-system/backend/scripts/diag-holiday-extension.js
 */

const fmt = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : 'null');
const storeName = (id) => {
  if (!id) return '-';
  const s = db.stores.findOne({ _id: id }, { name: 1 });
  return s ? s.name : '(已删除门店)';
};

print('========== 1. 全部假期 ==========');
const holidays = db.holidays.find({}).sort({ created_at: 1 }).toArray();
holidays.forEach(h => {
  print('  ' + h._id + ' | ' + h.name + ' | scope=' + h.store_scope +
    ' | store=' + storeName(h.store_id) + ' | ' + h.date + '~' + (h.end_date || h.date) +
    ' | status=' + h.status +
    ' | created=' + fmt(h.created_at) + ' | updated=' + fmt(h.updated_at));
});
print('  合计 ' + holidays.length + ' 个假期');

print('');
print('========== 2. 放假相关顺延记录（按 秒+原因+天数 分组） ==========');
const recs = db.packageextensions.find({
  reason: { $in: ['放假顺延', '撤销放假顺延'] }
}).sort({ created_at: 1 }).toArray();
print('  记录总数: ' + recs.length);

const groups = [];
recs.forEach(r => {
  const t = fmt(r.created_at);
  const key = t + ' | ' + r.operation_type + ' | ' + r.reason + ' | days=' + r.extend_days;
  let g = groups.find(x => x.key === key);
  if (!g) { g = { key, count: 0 }; groups.push(g); }
  g.count++;
});
groups.forEach(g => print('  ' + g.key + ' → ' + g.count + ' 条'));

print('');
print('========== 3. holiday_id 有值的记录数（新代码特征，修复前应为 0） ==========');
print('  ' + db.packageextensions.countDocuments({ holiday_id: { $ne: null } }) + ' 条');

print('');
print('========== 4. 每批记录的套餐归属分布（判断该批属于哪个门店的假期） ==========');
const byTime = [];
recs.forEach(r => {
  const t = fmt(r.created_at);
  let g = byTime.find(x => x.t === t);
  if (!g) { g = { t, items: [] }; byTime.push(g); }
  g.items.push(r);
});
byTime.forEach(g => {
  const storeCount = {};
  const extraCount = {};
  g.items.forEach(r => {
    const pkg = db.userpackages.findOne(
      { _id: r.user_package_id },
      { store_id: 1, extra_store_ids: 1 }
    );
    const sn = pkg ? storeName(pkg.store_id) : '(套餐已删除)';
    storeCount[sn] = (storeCount[sn] || 0) + 1;
    if (pkg && pkg.extra_store_ids && pkg.extra_store_ids.length) {
      pkg.extra_store_ids.forEach(e => {
        const en = '含跨店:' + storeName(e);
        extraCount[en] = (extraCount[en] || 0) + 1;
      });
    }
  });
  print('  --- ' + g.t + ' (' + g.items.length + ' 条) ---');
  print('    归属门店分布: ' + JSON.stringify(storeCount));
  print('    跨店标记分布: ' + JSON.stringify(extraCount));
});

print('');
print('========== 5. 每个套餐的放假顺延净额（sum(extend_days)） ==========');
const pkgAgg = {};
recs.forEach(r => {
  const k = String(r.user_package_id);
  if (!pkgAgg[k]) pkgAgg[k] = { sum: 0, n: 0 };
  pkgAgg[k].sum += (r.extend_days || 0);
  pkgAgg[k].n++;
});
const keys = Object.keys(pkgAgg);
print('  受影响套餐数: ' + keys.length);
keys.forEach(k => {
  const pkg = db.userpackages.findOne(
    { _id: ObjectId(k) },
    { store_id: 1, end_date: 1, extension_days: 1, status: 1, is_suspended: 1, suspend_end_date: 1 }
  );
  print('  套餐 ' + k +
    ' | ' + (pkg ? storeName(pkg.store_id) : '(套餐已删除)') +
    ' | end_date=' + (pkg ? fmt(pkg.end_date) : '-') +
    ' | extension_days=' + (pkg ? pkg.extension_days : '-') +
    ' | suspended=' + (pkg ? !!pkg.is_suspended : '-') +
    ' | 放假净额=' + pkgAgg[k].sum + ' | ' + pkgAgg[k].n + ' 条记录');
});

print('');
print('========== 诊断结束（未修改任何数据） ==========');