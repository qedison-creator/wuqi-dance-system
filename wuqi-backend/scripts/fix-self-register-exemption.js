/**
 * 一次性数据修正：豁免次数全面切换为门店级唯一来源（修复存量数据）
 *
 * 背景：原逻辑存在全局默认豁免次数（Config 表 default_exemption_count），
 *       且未选门店的会员登录时即被赋予全局默认值 2。
 *       新逻辑：门店默认豁免次数是唯一来源——未选门店不赋予豁免次数（0），
 *       选择门店后按门店默认值初始化。代码已修复，本脚本修正存量数据。
 *
 * 修正内容：
 *   A. 未选门店的会员：豁免次数清零（未选门店不应有豁免次数）
 *   B. 已选门店、豁免次数≠门店默认值、且从未被管理员调整过（无 ExemptionLog）的会员：
 *      按门店默认值修正
 *   C. 删除 Config 表中的全局 default_exemption_count 记录（全局默认已废除）
 *
 * 使用方法（生产服务器，二选一）：
 *   方式A. mongosh wuqi_dance --file fix-self-register-exemption.js
 *   方式B. 进入 mongosh 后直接粘贴整个文件内容执行
 *
 * 安全设计：先打印预览（人数+名单），人工确认后再执行修改
 *   确认无误后，把 FIX_CONFIRMED 改为 true 再跑一次即执行修改
 */

const FIX_CONFIRMED = false; // ← 预览确认后改为 true 才会真正修改数据

// ===== 1. 找出所有配置了门店默认豁免次数的门店 =====
const stores = db.stores.find(
  { status: 'active', default_exemption_count: { $type: 'number' } },
  { name: 1, default_exemption_count: 1 }
).toArray();
print('配置了默认豁免次数的门店: ' + stores.length + ' 家');
stores.forEach(s => print('  ' + s.name + ' → 默认 ' + s.default_exemption_count + ' 次'));

const storeIdToDefault = {};
stores.forEach(s => { storeIdToDefault[s._id.toString()] = s.default_exemption_count; });
const storeIds = stores.map(s => s._id);

// ===== 2. 排除条件：被管理员调整过豁免次数的会员（有 ExemptionLog 记录） =====
const adjustedUserIds = db.exemptionlogs.distinct('user_id', {});
print('被管理员调整过豁免次数的会员: ' + adjustedUserIds.length + ' 人（这些会员不会被修正）');

// ===== 3. 场景A：未选门店的会员，豁免次数清零 =====
const noStoreFilter = {
  $or: [
    { store_id: null },
    { store_id: { $exists: false } },
    { store_id: '' }
  ],
  user_type: 'member',
  member_status: { $in: ['registered', 'official'] },
  exemption_count: { $gt: 0 },
  _id: { $nin: adjustedUserIds }
};
const noStoreTargets = db.users.find(noStoreFilter,
  { real_name: 1, nick_name: 1, reserve_phone: 1, wechat_phone: 1, member_status: 1, exemption_count: 1, created_at: 1 }
).sort({ created_at: 1 }).toArray();

// ===== 4. 场景B：已选门店、豁免次数≠门店默认值、未被调整过的会员 =====
const storeFilter = {
  store_id: { $in: storeIds },
  user_type: 'member',
  member_status: { $in: ['registered', 'official'] },
  _id: { $nin: adjustedUserIds }
};
const storeTargets = db.users.find(storeFilter,
  { real_name: 1, nick_name: 1, reserve_phone: 1, wechat_phone: 1, member_status: 1, exemption_count: 1, store_id: 1, created_at: 1 }
).sort({ store_id: 1, created_at: 1 }).toArray();
const needFix = storeTargets.filter(m => {
  const def = storeIdToDefault[m.store_id.toString()];
  return def !== undefined && m.exemption_count !== def;
});

// ===== 5. 场景C：全局默认豁免次数配置记录 =====
const globalConfig = db.configs.findOne({ key: 'default_exemption_count' });

// ===== 6. 预览 =====
print('\n===== 预览 =====');
print('场景A - 未选门店、豁免次数>0（将清零）: ' + noStoreTargets.length + ' 人');
noStoreTargets.forEach(m => {
  const name = m.real_name || m.nick_name || '';
  const phone = m.reserve_phone || m.wechat_phone || '';
  print('  ' + name + ' | ' + phone + ' | 状态:' + m.member_status + ' | 当前豁免:' + m.exemption_count + ' → 0');
});

print('\n场景B - 已选门店、豁免次数≠门店默认值（将按门店默认值修正）: ' + needFix.length + ' 人');
const byStore = {};
needFix.forEach(m => {
  const sname = (stores.find(s => s._id.toString() === m.store_id.toString()) || {}).name || m.store_id;
  byStore[sname] = (byStore[sname] || 0) + 1;
});
print('按门店分布: ' + JSON.stringify(byStore));
needFix.forEach(m => {
  const sname = (stores.find(s => s._id.toString() === m.store_id.toString()) || {}).name || '';
  const def = storeIdToDefault[m.store_id.toString()];
  const name = m.real_name || m.nick_name || '';
  const phone = m.reserve_phone || m.wechat_phone || '';
  print('  ' + name + ' | ' + phone + ' | ' + sname + ' | 当前豁免:' + m.exemption_count + ' → 应为:' + def);
});

print('\n场景C - 全局默认豁免次数配置记录: ' + (globalConfig ? ('存在，value=' + globalConfig.value + '（将删除）') : '不存在，无需处理'));

// ===== 7. 执行修改 =====
if (!FIX_CONFIRMED) {
  print('\n[预览模式] 未修改任何数据。核对名单无误后，把脚本第一行 FIX_CONFIRMED 改为 true 再执行一次。');
} else {
  print('\n===== 执行结果 =====');

  // A. 未选门店会员豁免清零
  const rA = db.users.updateMany(noStoreFilter, { $set: { exemption_count: 0 } });
  print('A. 未选门店清零 - 匹配: ' + rA.matchedCount + ' 条，修改: ' + rA.modifiedCount + ' 条');

  // B. 按门店默认值修正
  let matchedB = 0, modifiedB = 0;
  needFix.forEach(m => {
    const def = storeIdToDefault[m.store_id.toString()];
    const r = db.users.updateOne({ _id: m._id, exemption_count: m.exemption_count }, { $set: { exemption_count: def } });
    matchedB += r.matchedCount; modifiedB += r.modifiedCount;
  });
  print('B. 按门店默认值修正 - 匹配: ' + matchedB + ' 条，修改: ' + modifiedB + ' 条');

  // C. 删除全局默认豁免次数配置记录
  if (globalConfig) {
    const rC = db.configs.deleteOne({ key: 'default_exemption_count' });
    print('C. 删除全局配置记录 - 删除: ' + rC.deletedCount + ' 条');
  } else {
    print('C. 全局配置记录不存在，跳过');
  }

  // 复核
  const stillNoStore = db.users.countDocuments(noStoreFilter);
  const stillWrong = db.users.find(storeFilter, { real_name: 1, nick_name: 1, exemption_count: 1, store_id: 1 }).toArray()
    .filter(m => {
      const def = storeIdToDefault[m.store_id.toString()];
      return def !== undefined && m.exemption_count !== def;
    });
  print('复核-仍未选门店且豁免>0的: ' + stillNoStore + ' 人');
  print('复核-仍偏离门店默认值的: ' + stillWrong.length + ' 人');
  stillWrong.forEach(m => print('  未修正: ' + (m.real_name || m.nick_name || m._id) + ' 当前豁免:' + m.exemption_count));
}
