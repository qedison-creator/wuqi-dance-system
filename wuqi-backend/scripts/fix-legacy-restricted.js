/* 一次性数据修正：清理历史「限制账号」但已退款/转卡结清的会员（幂等，默认 dry-run）
 *
 * 背景：权益冻结功能上线前，退款/转卡会员被用「限制账号」近似处理。
 *   这些会员已结清，系统内不应再有有效套餐，否则会出现“已退款会员仍有可用套餐”的假数据。
 *
 * 处理规则：
 *   1. 取消未来未完成预约（admin_cancel）
 *   2. 全部未作废套餐强制作废（voided，保留溯源；未激活未使用也不物理删除）
 *   3. 赠课卡随主套餐联动作废
 *   4. 账号保持「已限制」，不恢复登录、不注销、不做时间补回/权益冻结
 *
 * 用法（脚本自动读后端根目录 .env）：
 *   node scripts/fix-legacy-restricted.js           # 预览
 *   node scripts/fix-legacy-restricted.js --apply   # 写库
 *
 * 如需按人区分退款/转卡文案，修改 REASONS 后重新预览再执行。
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const APPLY = process.argv.includes('--apply');
const mongoose = require('mongoose');

const TARGET_NAMES = ['林国晶', '林清清', '龚亚珍'];
// 三人均已结清（退款/转卡二选一）；未单独配置时使用统一文案
const REASONS = {
  '林国晶': '历史补录：已退款/转卡结清（原限制账号）',
  '林清清': '历史补录：已退款/转卡结清（原限制账号）',
  '龚亚珍': '历史补录：已退款/转卡结清（原限制账号）',
};

function todayStr() {
  const d = new Date();
  const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().split('T')[0];
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const Booking = require('../src/models/Booking');
  const logService = require('../src/services/log.service');
  const packageService = require('../src/services/package.service');

  const operator = await User.findOne({ role: 'super_admin' }).select('_id nick_name username');
  const operatorId = operator ? operator._id : null;
  console.log(`[Legacy] 执行人：${operator ? (operator.nick_name || operator.username || String(operator._id)) : '系统'}`);
  console.log(`[Legacy] 模式：${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览）'}`);

  const today = todayStr();
  let totalVoid = 0;
  let totalCancel = 0;
  let blocked = 0;

  for (const name of TARGET_NAMES) {
    console.log(`\n===== ${name} =====`);
    const users = await User.find({
      $or: [{ real_name: name }, { nick_name: name }],
      user_type: 'member',
    }).select('_id real_name nick_name member_code status frozen_by_package is_deleted');

    if (users.length === 0) {
      console.log('未找到会员，跳过');
      blocked++;
      continue;
    }
    if (users.length > 1) {
      console.log(`重名 ${users.length} 人，为避免误伤中止：`);
      users.forEach(u => console.log(`  ${u._id} ${u.real_name || u.nick_name} 编码=${u.member_code || '-'}`));
      blocked++;
      continue;
    }

    const user = users[0];
    console.log(`会员ID=${user._id} 编码=${user.member_code || '-'} 状态=${user.status} 冻结标记=${!!user.frozen_by_package}`);

    const packages = await UserPackage.find({ user_id: user._id })
      .select('_id package_type status is_activated is_suspended suspend_type is_bonus bonus_source_id remaining_credits end_date')
      .sort({ created_at: 1 });

    if (packages.length === 0) {
      console.log('无套餐记录');
    } else {
      packages.forEach(p => {
        console.log(`  套餐 ${p._id} 类型=${p.package_type} 状态=${p.status} 已激活=${p.is_activated} 停卡=${p.is_suspended} 类型=${p.suspend_type || '-'} 赠课=${!!p.is_bonus} 剩余=${p.remaining_credits} 到期=${p.end_date ? p.end_date.toISOString().split('T')[0] : '-'}`);
      });
    }

    const toVoid = packages.filter(p => p.status !== 'voided');
    const futureBookings = await Booking.find({
      user_id: user._id,
      user_package_id: { $in: toVoid.map(p => p._id) },
      status: 'booked',
      booking_date: { $gte: today },
    }).select('_id booking_date booking_time');

    console.log(`待作废套餐 ${toVoid.length} 个，未来预约 ${futureBookings.length} 条`);
    futureBookings.forEach(b => console.log(`  预约 ${b._id} ${b.booking_date} ${b.booking_time}`));

    if (toVoid.length === 0) {
      console.log('已全部作废，跳过');
    }

    if (!APPLY) {
      totalVoid += toVoid.length;
      totalCancel += futureBookings.length;
      continue;
    }

    // 1. 取消未来预约
    for (const b of futureBookings) {
      b.status = 'cancelled';
      b.cancelled_at = new Date();
      b.cancel_reason = '套餐已作废（历史补录）';
      b.cancel_type = 'admin_cancel';
      await b.save();
      totalCancel++;
    }

    // 2. 强制作废套餐（赠课卡由 deleteUserPackage 联动作废）
    const reason = REASONS[name] || '历史补录：已退款/转卡结清（原限制账号）';
    for (const p of toVoid) {
      await packageService.deleteUserPackage(p._id, operatorId, reason, { forceVoid: true });
      totalVoid++;
    }

    // 3. 账号保持已限制，仅清除可能存在的冻结标记，避免被误判为权益冻结
    if (user.status !== 'disabled' || user.frozen_by_package) {
      user.status = 'disabled';
      user.frozen_by_package = false;
      await user.save();
    }

    await logService.createLog({
      operator_id: operatorId,
      action: 'legacy_remediation',
      module: 'member',
      target_id: user._id,
      detail: `历史限制账号补录：${name} 已结清，作废套餐 ${toVoid.length} 个，取消未来预约 ${futureBookings.length} 条，账号保持已限制`,
    });
  }

  console.log(`\n[Legacy] ${APPLY ? '完成' : '预览'}：作废套餐 ${totalVoid} 个，取消预约 ${totalCancel} 条，异常/重名 ${blocked} 人`);
  if (!APPLY) console.log('[Legacy] 确认无误后加 --apply 执行');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[Legacy] 执行失败:', err);
  process.exit(1);
});
