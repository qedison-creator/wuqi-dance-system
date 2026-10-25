/* 存量修复：随主套餐赠课卡有效期与主卡不一致
 *
 * 背景（已修复的代码问题）：主卡「延长 / 撤销延长 / 放假顺延 / 回滚放假」只改主卡 end_date，
 * 随主套餐（follow_main）的赠课卡未同步，导致赠课到期日比主卡短（或长）。
 * 本脚本把这类赠课卡的起止日期对齐到主卡当前有效期，并写入套餐变更记录留痕。
 *
 * 用法（在生产后端目录执行）：
 *   node scripts/fix-bonus-expiry-sync.js                      # 只读预览（全部会员）
 *   node scripts/fix-bonus-expiry-sync.js --member 孙燕姿       # 只读预览（指定会员）
 *   node scripts/fix-bonus-expiry-sync.js --member 孙燕姿 --apply
 *   node scripts/fix-bonus-expiry-sync.js --member 孙燕姿 --align-months --apply
 *     --align-months：把该会员「单独有效期(months)」的赠课卡一并改为随主套餐并同步到期日
 *                     （必须配合 --member 使用，避免批量改动单独有效期语义）
 *
 * 只处理 status=active 的赠课卡；已作废(voided) 记录保持原样用于权益溯源。
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const APPLY = hasFlag('--apply');
const MEMBER = getArg('--member');
const ALIGN_MONTHS = hasFlag('--align-months');

if (ALIGN_MONTHS && !MEMBER) {
  console.error('--align-months 必须配合 --member 指定会员，避免批量改动单独有效期语义');
  process.exit(1);
}

const fmt = (d) => {
  if (!d) return '-';
  const bj = new Date(new Date(d).getTime() + 8 * 3600000);
  return bj.toISOString().slice(0, 10);
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const PackageChange = require('../src/models/PackageChange');
  const OperationLog = require('../src/models/OperationLog');

  const userFilter = {};
  if (MEMBER) {
    const re = new RegExp(MEMBER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    userFilter.$or = [{ real_name: re }, { nick_name: re }, { phone: re }, { reserve_phone: re }, { member_code: re }];
  }
  const users = await User.find(userFilter).select('_id real_name nick_name phone reserve_phone member_code').lean();
  if (users.length === 0) {
    console.log('未找到匹配会员');
    await mongoose.disconnect();
    return;
  }

  let scanned = 0;
  let mismatch = 0;
  let fixed = 0;
  let monthsSkipped = 0;

  for (const user of users) {
    const packages = await UserPackage.find({ user_id: user._id });
    const mains = packages.filter(p => !p.is_bonus);
    const bonuses = packages.filter(p => p.is_bonus);

    // 会员筛选时，即使没有不一致也打印套餐概况，便于核对
    if (MEMBER) {
      console.log(`\n==================== ${user.real_name || user.nick_name || user._id} ====================`);
      console.log(`_id=${user._id} 编码=${user.member_code || '-'} 手机=${user.reserve_phone || user.phone || '-'}`);
      packages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(p => {
        const type = p.is_bonus ? `赠课(${p.bonus_expire_mode || 'follow_main'})` : (p.package_type === 'time_card' ? '时间卡' : '次卡');
        console.log(`  ${type} ${p._id} status=${p.status} ${fmt(p.start_date)} ~ ${fmt(p.end_date)} 剩余=${p.remaining_credits}/${p.total_credits}${p.status === 'voided' ? ` 作废于${fmt(p.voided_at)}` : ''}`);
      });
    }

    for (const main of mains) {
      if (main.status !== 'active') continue;
      const linked = bonuses.filter(b => b.bonus_source_id && String(b.bonus_source_id) === String(main._id) && b.status === 'active');
      for (const bonus of linked) {
        scanned++;
        const isMonths = bonus.bonus_expire_mode === 'months';
        const sameEnd = bonus.end_date && main.end_date
          && new Date(bonus.end_date).getTime() === new Date(main.end_date).getTime();
        if (isMonths && !ALIGN_MONTHS) {
          monthsSkipped++;
          if (!sameEnd || MEMBER) {
            console.log(`[单独有效期] 会员=${user.real_name || user.nick_name} 赠课=${bonus._id} ${fmt(bonus.start_date)}~${fmt(bonus.end_date)} 主卡=${fmt(main.end_date)}（保持原样）`);
          }
          continue;
        }
        if (sameEnd && !isMonths) continue;

        mismatch++;
        console.log(`[需修复] 会员=${user.real_name || user.nick_name}(${user._id}) 主卡=${main._id} 主卡到期=${fmt(main.end_date)} | 赠课=${bonus._id} 模式=${bonus.bonus_expire_mode || 'follow_main'} 到期=${fmt(bonus.end_date)}${isMonths ? '（将改为随主套餐）' : ''}`);

        if (!APPLY) continue;

        const oldStart = bonus.start_date;
        const oldEnd = bonus.end_date;
        bonus.start_date = main.start_date || null;
        bonus.end_date = main.end_date || null;
        bonus.original_end_date = main.original_end_date || main.end_date || null;
        bonus.duration_value = main.duration_value || null;
        bonus.duration_unit = main.duration_unit || 'month';
        if (isMonths) bonus.bonus_expire_mode = 'follow_main';
        await bonus.save();

        const changes = [];
        if (fmt(oldStart) !== fmt(bonus.start_date)) {
          changes.push({ field: 'start_date', field_label: '开始日期', old_value: fmt(oldStart), new_value: fmt(bonus.start_date) });
        }
        if (fmt(oldEnd) !== fmt(bonus.end_date)) {
          changes.push({ field: 'end_date', field_label: '到期日期', old_value: fmt(oldEnd), new_value: fmt(bonus.end_date) });
        }
        if (isMonths) {
          changes.push({ field: 'bonus_expire_mode', field_label: '赠课有效期模式', old_value: '单独有效期', new_value: '随主套餐' });
        }

        if (changes.length > 0) {
          await PackageChange.create({
            user_package_id: bonus._id,
            user_id: bonus.user_id,
            store_id: bonus.store_id,
            operator_id: null,
            operator_name: '系统',
            changes,
            remark: '修复赠课有效期：与主套餐有效期同步',
            member_snapshot: {
              real_name: user.real_name || '',
              nick_name: user.nick_name || '',
              phone: user.reserve_phone || user.phone || '',
              member_code: user.member_code || '',
            },
            package_snapshot: {
              package_type: bonus.package_type,
              total_credits: bonus.total_credits,
              duration_value: bonus.duration_value,
              duration_unit: bonus.duration_unit,
            },
          });
        }

        await OperationLog.create({
          operator_id: null,
          action: 'update',
          module: 'package',
          target_id: bonus._id,
          target_type: 'UserPackage',
          detail: `脚本修复随主套餐赠课卡有效期：会员(${user._id}) 赠课(${bonus._id}) ${fmt(oldEnd)} → ${fmt(bonus.end_date)}（主卡 ${main._id}）`,
        });

        fixed++;
      }
    }
  }

  console.log(`\n扫描赠课卡 ${scanned} 张，需修复 ${mismatch} 张，已修复 ${fixed} 张，单独有效期跳过 ${monthsSkipped} 张`);
  if (!APPLY) console.log('当前为只读预览，补上 --apply 才会写入数据库');

  await mongoose.disconnect();
})().catch(e => {
  console.error('执行失败:', e);
  process.exit(1);
});
