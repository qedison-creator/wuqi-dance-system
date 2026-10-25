/* 存量修复：同日「权益冻结→解冻」「停卡→复卡」被多加的服务有效期天数
 *
 * 背景（已修复的代码问题）：旧逻辑按 ceil 计算暂停天数且最低 1 天，
 * 同一天冻结后立即解冻（或停卡后立即复卡）也会给 end_date 加 1 天，反复操作会累计多加。
 * 本脚本按「解冻/复卡记录里的实际天数」与「该次冻结/停卡到恢复的真实整日数」对比，
 * 把多补的天数从到期日扣回，并写入套餐变更记录留痕。
 *
 * 用法（在生产后端目录执行）：
 *   node scripts/fix-suspend-extra-days.js --member 孙燕姿           # 只读预览
 *   node scripts/fix-suspend-extra-days.js --member 孙燕姿 --apply   # 执行扣回
 *
 * 仅处理 status=active 的套餐；已作废(voided) 记录不改动。
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';
const mongoose = require('mongoose');

const DAY_MS = 24 * 60 * 60 * 1000;
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const memberIdx = args.indexOf('--member');
const MEMBER = memberIdx >= 0 ? args[memberIdx + 1] : null;

if (!MEMBER) {
  console.error('请用 --member 指定会员姓名/手机号/编码，如：node scripts/fix-suspend-extra-days.js --member 孙燕姿');
  process.exit(1);
}

const fmt = (d) => {
  if (!d) return '-';
  const bj = new Date(new Date(d).getTime() + 8 * 3600000);
  return bj.toISOString().replace('T', ' ').slice(0, 16);
};
const fmtDay = (d) => (d ? fmt(d).slice(0, 10) : '-');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const PackageChange = require('../src/models/PackageChange');
  const OperationLog = require('../src/models/OperationLog');

  const re = new RegExp(MEMBER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const users = await User.find({
    $or: [{ real_name: re }, { nick_name: re }, { phone: re }, { reserve_phone: re }, { member_code: re }],
  }).select('_id real_name nick_name phone reserve_phone member_code').lean();

  if (users.length === 0) {
    console.log('未找到匹配会员');
    await mongoose.disconnect();
    return;
  }

  for (const user of users) {
    console.log(`\n==================== ${user.real_name || user.nick_name || user._id} ====================`);
    const packages = await UserPackage.find({ user_id: user._id }).sort({ created_at: 1 });
    const pkgIds = packages.map(p => p._id);
    const changes = await PackageChange.find({ user_package_id: { $in: pkgIds } }).sort({ created_at: 1 }).lean();

    let totalExcessDays = 0;
    let fixedPackages = 0;

    for (const pkg of packages) {
      const records = changes.filter(c => String(c.user_package_id) === String(pkg._id));
      if (records.length === 0) continue;

      const label = pkg.is_bonus ? '赠课' : (pkg.package_type === 'time_card' ? '时间卡' : '次卡');
      let lastFreeze = null;
      let lastSuspend = null;
      let excess = 0;

      for (const rec of records) {
        const remark = rec.remark || '';
        if (remark.startsWith('管理员权益冻结')) {
          lastFreeze = rec;
        } else if (remark.startsWith('管理员解除冻结')) {
          const m = remark.match(/实际冻结(\d+)天/);
          if (m && lastFreeze) {
            const recorded = Number(m[1]);
            const correct = Math.max(0, Math.floor((new Date(rec.created_at).getTime() - new Date(lastFreeze.created_at).getTime()) / DAY_MS));
            const extra = recorded - correct;
            if (extra > 0) {
              excess += extra;
              console.log(`  ${label}(${pkg._id}) 解冻 ${fmt(rec.created_at)} 记录${recorded}天 / 实际${correct}天 → 多补 ${extra} 天`);
            }
          }
          lastFreeze = null;
        } else if (remark.startsWith('管理员复卡')) {
          const m = remark.match(/实际停卡(\d+)天/);
          if (m && lastSuspend) {
            const recorded = Number(m[1]);
            const correct = Math.max(0, Math.floor((new Date(rec.created_at).getTime() - new Date(lastSuspend.created_at).getTime()) / DAY_MS));
            const extra = recorded - correct;
            if (extra > 0) {
              excess += extra;
              console.log(`  ${label}(${pkg._id}) 复卡 ${fmt(rec.created_at)} 记录${recorded}天 / 实际${correct}天 → 多补 ${extra} 天`);
            }
          }
          lastSuspend = null;
        } else if (remark.startsWith('管理员停卡')) {
          lastSuspend = rec;
        }
      }

      if (excess <= 0) continue;
      if (pkg.status !== 'active') {
        console.log(`  ${label}(${pkg._id}) 多补 ${excess} 天，但当前状态=${pkg.status}，跳过`);
        continue;
      }

      // 幂等保护：该套餐已修正过则不再重复扣回
      const alreadyFixed = records.some(c => (c.remark || '').startsWith('修正多补天数'));
      if (alreadyFixed) {
        console.log(`  ${label}(${pkg._id}) 多补 ${excess} 天，但已修正过，跳过`);
        continue;
      }

      const oldEnd = pkg.end_date;
      const newEnd = oldEnd ? new Date(oldEnd.getTime() - excess * DAY_MS) : null;
      if (!newEnd) continue;
      console.log(`  ${label}(${pkg._id}) 到期日 ${fmtDay(oldEnd)} → ${fmtDay(newEnd)}（扣回 ${excess} 天）`);
      totalExcessDays += excess;

      if (!APPLY) continue;

      pkg.end_date = newEnd;
      await pkg.save();

      await PackageChange.create({
        user_package_id: pkg._id,
        user_id: pkg.user_id,
        store_id: pkg.store_id,
        operator_id: null,
        operator_name: '系统',
        changes: [{
          field: 'end_date',
          field_label: '到期日期',
          old_value: fmtDay(oldEnd),
          new_value: fmtDay(newEnd),
        }],
        remark: `修正多补天数：同日冻结/停卡与解冻/复卡不应补天数（扣回${excess}天）`,
        member_snapshot: {
          real_name: user.real_name || '',
          nick_name: user.nick_name || '',
          phone: user.reserve_phone || user.phone || '',
          member_code: user.member_code || '',
        },
        package_snapshot: {
          package_type: pkg.package_type,
          total_credits: pkg.total_credits,
          duration_value: pkg.duration_value,
          duration_unit: pkg.duration_unit,
        },
      });

      await OperationLog.create({
        operator_id: null,
        action: 'update',
        module: 'package',
        target_id: pkg._id,
        target_type: 'UserPackage',
        detail: `脚本修正同日冻结/停卡多补天数：会员(${pkg.user_id}) 套餐(${pkg._id}) ${fmtDay(oldEnd)} → ${fmtDay(newEnd)}（-${excess}天）`,
      });

      fixedPackages++;
    }

    console.log(`合计多补 ${totalExcessDays} 天，已修正套餐 ${APPLY ? fixedPackages : 0} 个${APPLY ? '' : '（只读预览，加 --apply 执行）'}`);
  }

  await mongoose.disconnect();
})().catch(e => {
  console.error('执行失败:', e);
  process.exit(1);
});
