/* 只读诊断：会员赠课卡 / 冻结解冻 / 作废 事件溯源
 * 用法（在生产后端目录执行）：
 *   node scripts/diag-member-bonus.js 孙燕姿
 *   node scripts/diag-member-bonus.js 175  （手机号/编码片段也可）
 *
 * 输出：会员基本信息、全部套餐（含 voided）、赠课来源与有效期模式、
 *       每张套餐的变更记录（PackageChange）、延长记录（PackageExtension）、
 *       针对该会员及其套餐的操作日志（OperationLog，按时间升序）
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';
const mongoose = require('mongoose');

const keyword = process.argv[2];
if (!keyword) {
  console.error('请传入会员姓名/手机号/编码，如：node scripts/diag-member-bonus.js 孙燕姿');
  process.exit(1);
}

function fmt(d) {
  if (!d) return '-';
  const bj = new Date(new Date(d).getTime() + 8 * 3600000);
  return bj.toISOString().replace('T', ' ').slice(0, 19);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const PackageChange = require('../src/models/PackageChange');
  const PackageExtension = require('../src/models/PackageExtension');
  const OperationLog = require('../src/models/OperationLog');

  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const users = await User.find({
    $or: [{ real_name: re }, { nick_name: re }, { phone: re }, { reserve_phone: re }, { member_code: re }],
  }).select('_id real_name nick_name phone reserve_phone member_code status frozen_by_package member_status store_id').lean();

  if (users.length === 0) {
    console.log('未找到会员');
    await mongoose.disconnect();
    return;
  }

  for (const user of users) {
    console.log('\n==================== 会员 ====================');
    console.log(`_id=${user._id} 姓名=${user.real_name || user.nick_name || '-'} 编码=${user.member_code || '-'} 手机=${user.reserve_phone || user.phone || '-'}`);
    console.log(`状态=${user.status} frozen_by_package=${!!user.frozen_by_package} member_status=${user.member_status}`);

    const packages = await UserPackage.find({ user_id: user._id })
      .populate('bonus_source_id', 'package_type status start_date end_date')
      .sort({ created_at: 1 })
      .lean();

    console.log(`\n-------------------- 套餐 ${packages.length} 个（按创建时间升序） --------------------`);
    packages.forEach((p, i) => {
      console.log(`\n[${i + 1}] ${p._id} ${p.is_bonus ? '赠课' : (p.package_type === 'time_card' ? '时间卡' : '次卡')}`);
      console.log(`    status=${p.status} is_activated=${p.is_activated} is_suspended=${p.is_suspended} suspend_type=${p.suspend_type || '-'}`);
      console.log(`    start=${fmt(p.start_date)} end=${fmt(p.end_date)} original_end=${fmt(p.original_end_date)}`);
      console.log(`    remain=${p.remaining_credits}/${p.total_credits} duration=${p.duration_value || '-'}${p.duration_unit || ''} 到期天数字段已停用`);
      console.log(`    created=${fmt(p.created_at)} activated=${fmt(p.activated_at)} updated=${fmt(p.updated_at)}`);
      if (p.is_bonus) {
        console.log(`    bonus_source_id=${p.bonus_source_id && p.bonus_source_id._id ? p.bonus_source_id._id : (p.bonus_source_id || '-')} bonus_expire_mode=${p.bonus_expire_mode || '-'}`);
        console.log(`    bonus_source状态=${p.bonus_source_id && p.bonus_source_id.status || '-'} 主卡到期=${p.bonus_source_id ? fmt(p.bonus_source_id.end_date) : '-'}`);
      }
      if (p.is_suspended) {
        console.log(`    suspended_at=${fmt(p.suspended_at)} suspend_end=${fmt(p.suspend_end_date)} frozen_end=${fmt(p.frozen_end_date)} frozen_remain=${p.frozen_remaining_credits}`);
      }
      if (p.status === 'voided') {
        console.log(`    voided_at=${fmt(p.voided_at)} voided_reason=${p.voided_reason || '-'}`);
      }
      if (p.remark) console.log(`    remark=${p.remark}`);
    });

    const pkgIds = packages.map(p => p._id);
    const changes = await PackageChange.find({ user_package_id: { $in: pkgIds } }).sort({ created_at: 1 }).lean();
    console.log(`\n-------------------- 套餐变更记录 ${changes.length} 条（升序） --------------------`);
    changes.forEach(c => {
      const pkg = packages.find(p => String(p._id) === String(c.user_package_id));
      const label = pkg ? (pkg.is_bonus ? '赠课' : pkg.package_type) : '套餐';
      console.log(`[${fmt(c.created_at)}] ${label}(${c.user_package_id}) 操作人=${c.operator_name || '-'} remark=${c.remark || '-'}`);
      (c.changes || []).forEach(ch => console.log(`     ${ch.field_label || ch.field}: ${ch.old_value} → ${ch.new_value}${ch.undone_at ? '（已撤回）' : ''}`));
    });

    const exts = await PackageExtension.find({ user_package_id: { $in: pkgIds } }).sort({ created_at: 1 }).lean();
    console.log(`\n-------------------- 延长记录 ${exts.length} 条 --------------------`);
    exts.forEach(e => console.log(`[${fmt(e.created_at)}] 套餐=${e.user_package_id} 类型=${e.operation_type} +${e.extend_value}${e.extend_unit} 原=${fmt(e.original_expire_at)} 新=${fmt(e.new_expire_at)} 备注=${e.reason || e.remark || '-'}`));

    const logs = await OperationLog.find({
      $or: [
        { target_id: user._id },
        { target_id: { $in: pkgIds } },
      ],
    }).sort({ created_at: 1 }).lean();
    console.log(`\n-------------------- 操作日志 ${logs.length} 条（升序） --------------------`);
    logs.forEach(l => console.log(`[${fmt(l.created_at)}] ${l.action} module=${l.module} target=${l.target_id} 操作人=${l.operator_id || '-'} detail=${l.detail || ''}`));
  }

  await mongoose.disconnect();
})().catch(e => { console.error('执行失败:', e); process.exit(1); });
