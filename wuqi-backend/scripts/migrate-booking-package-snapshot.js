/* 扣课溯源存量迁移：Booking 套餐快照 + UserPackage 套餐名补齐（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 背景：Booking 新增 package_name / package_type 不可变快照字段，用于"扣了哪个套餐"的权益溯源。
 *
 * 套餐名的数据源优先级（依次尝试，拿到即止）：
 *   a. UserPackage.package_snapshot.name        —— 录入时从 Package 模板写入
 *   b. Package 模板（UserPackage.package_id 指向）—— 模板名
 *   c. PackageActivation.package_snapshot.name  —— 独立集合，套餐被物理删除后仍保留，最后一道溯源防线
 *   全取不到时留空，展示层按 package_type 退化为类型词后缀（如「· 次卡」），绝不出现"已删除"。
 *
 * 迁移内容：
 *   1. UserPackage.package_snapshot.name 补齐（数据源 a→b→c）
 *   2. Booking.package_name / package_type 回填（数据源 a→b→c；孤儿预约也能从 c 救回）
 *
 * 用法（自动读后端根目录 .env）：
 *   node scripts/migrate-booking-package-snapshot.js           # 预览
 *   node scripts/migrate-booking-package-snapshot.js --apply   # 写库
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const APPLY = process.argv.includes('--apply');

async function main() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`[migrate] 数据库: ${db.databaseName}  模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览，加 --apply 执行）'}`);

  const Booking = require('../src/models/Booking');
  const UserPackage = require('../src/models/UserPackage');
  const Package = require('../src/models/Package');
  const PackageActivation = require('../src/models/PackageActivation');

  // 前置：套餐模板总数（判断"具体套餐名"规则是否还有模板数据源）
  const tplTotal = await Package.countDocuments();
  console.log(`[前置] Package 模板总数: ${tplTotal} 个`);

  // 辅助：批量取 PackageActivation 里的套餐名/类型（按 user_package_id 聚合，取第一个非空值）
  // 激活记录是独立集合，套餐被物理删除后依然保留 → 孤儿预约的最后溯源来源
  async function loadActivationMap(userPackageIds) {
    const map = new Map();
    const ids = [...new Set(userPackageIds.filter(Boolean).map(String))];
    for (let i = 0; i < ids.length; i += 2000) {
      const chunk = ids.slice(i, i + 2000);
      const acts = await PackageActivation.find({
        user_package_id: { $in: chunk },
        $or: [
          { 'package_snapshot.name': { $nin: ['', null] } },
          { 'package_snapshot.package_type': { $nin: ['', null] } },
        ],
      }).select('user_package_id package_snapshot').lean();
      for (const a of acts) {
        const key = String(a.user_package_id);
        const cur = map.get(key) || { name: '', type: '' };
        const ps = a.package_snapshot || {};
        map.set(key, {
          name: cur.name || ps.name || '',
          type: cur.type || ps.package_type || '',
        });
      }
    }
    return map;
  }

  // 辅助：取 Package 模板名（带缓存）
  const templateCache = new Map();
  async function templateName(packageId) {
    if (!packageId) return '';
    const tid = String(packageId);
    if (!templateCache.has(tid)) {
      const tpl = await Package.findById(tid).select('name').lean();
      templateCache.set(tid, tpl ? (tpl.name || '') : null);
    }
    return templateCache.get(tid) || '';
  }

  // ========== 1. 补齐 UserPackage.package_snapshot.name ==========
  console.log('\n[1] UserPackage.package_snapshot.name 补齐');
  const pkgsWithoutName = await UserPackage.find({
    $or: [
      { 'package_snapshot.name': { $exists: false } },
      { 'package_snapshot.name': '' },
      { 'package_snapshot.name': null },
    ],
  }).select('package_id package_type').limit(200000).lean();
  console.log(`    扫描: ${pkgsWithoutName.length} 个`);

  const pkgActMap = await loadActivationMap(pkgsWithoutName.map(p => p._id));

  let pkgFromActivation = 0, pkgNoSource = 0, noPkgId = 0, tplDeleted = 0;
  for (const p of pkgsWithoutName) {
    // 优先级 b: Package 模板
    let name = await templateName(p.package_id);
    let source = name ? 'template' : '';
    // 优先级 c: PackageActivation
    if (!name) {
      const act = pkgActMap.get(String(p._id));
      if (act && act.name) { name = act.name; source = 'activation'; }
    }
    if (!name) {
      pkgNoSource += 1;
      if (!p.package_id) noPkgId += 1; else tplDeleted += 1;
      continue;
    }
    if (source === 'activation') pkgFromActivation += 1;
    if (APPLY) {
      await UserPackage.collection.updateOne(
        { _id: p._id },
        { $set: { package_snapshot: { name } } }
      );
    }
  }
  const pkgPatched = pkgsWithoutName.length - pkgNoSource;
  console.log(`    可补齐套餐名 ${pkgPatched} 个（其中从激活记录救回 ${pkgFromActivation} 个），仍无名字数据源 ${pkgNoSource} 个`);
  console.log(`      其中：无 package_id（录入时未选模板）${noPkgId} 个 / 有 package_id 但模板已不存在 ${tplDeleted} 个`);
  console.log('    说明：无名字数据源的套餐仍会按 package_type 显示类型词后缀（如「· 次卡」），不影响溯源。');

  // ========== 2. 回填 Booking.package_name / package_type ==========
  console.log('\n[2] Booking 套餐快照回填');
  // 候选：套餐快照任一字段缺失（无套餐名的记录不会被填上名字，因此靠"与实际值比对"判定是否需写入）
  const bookings = await Booking.find({
    user_package_id: { $ne: null },
    $or: [
      { package_type: { $exists: false } },
      { package_type: '' },
      { package_type: null },
      { package_name: { $exists: false } },
      { package_name: '' },
      { package_name: null },
    ],
  }).select('user_package_id package_name package_type').limit(500000).lean();
  console.log(`    扫描: ${bookings.length} 条`);

  const bActMap = await loadActivationMap(bookings.map(b => b.user_package_id));

  const upkgCache = new Map();
  let fillOk = 0, fillTypeOnly = 0, orphan = 0, orphanRescued = 0, noData = 0, unchanged = 0;
  for (const b of bookings) {
    const pid = String(b.user_package_id);
    if (!upkgCache.has(pid)) {
      const up = await UserPackage.findById(pid).select('package_snapshot package_type package_id').lean();
      upkgCache.set(pid, up || null);
    }
    const up = upkgCache.get(pid);
    const act = bActMap.get(pid);
    if (!up) orphan += 1; // 套餐已被物理删除（历史孤儿）

    // 优先级 a/b: UserPackage 自身快照 → Package 模板；a/b 失效时补 c: PackageActivation
    let name = (up && up.package_snapshot && up.package_snapshot.name) || '';
    if (!name && up && up.package_id) name = await templateName(up.package_id);
    const nameFromActivation = !name && !!(act && act.name);
    if (nameFromActivation) name = act.name;

    let type = (up && up.package_type) || '';
    if (!type && act && act.type) type = act.type;

    if (!up && name) orphanRescued += 1;
    if (!name && !type) { noData += 1; continue; } // 既无名字也无类型，展示层兜底为纯扣课文案

    // 快照已是最新（例如已由上一轮迁移写入，或本就无套餐名可补），无需重复写库
    const curName = b.package_name || '';
    const curType = b.package_type || '';
    if (curName === name && curType === type) { unchanged += 1; continue; }

    if (APPLY) {
      await Booking.collection.updateOne(
        { _id: b._id },
        { $set: { package_name: name, package_type: type } }
      );
    }
    if (name) fillOk += 1; else fillTypeOnly += 1;
  }
  console.log(`    可回填（有套餐名，可显示具体套餐名）${fillOk} 条`);
  console.log(`    仅有类型（可显示类型词后缀，如「· 次卡」）${fillTypeOnly} 条`);
  console.log(`    无需处理（快照已是最新）${unchanged} 条`);
  console.log(`    完全无数据（无名字也无类型）${noData} 条 → 展示层兜底为纯扣课文案，绝不出现"已删除"`);
  console.log(`    孤儿预约（套餐已物理删除）${orphan} 条，其中从激活记录救回套餐名 ${orphanRescued} 条`);
  console.log('    剩余无名字的孤儿预约仍按 package_type 显示类型词后缀，绝不出现"已删除"。');

  if (!APPLY) console.log('\n预览完成。确认无误后加 --apply 执行写库。');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[migrate] 执行失败:', err);
  process.exit(1);
});
