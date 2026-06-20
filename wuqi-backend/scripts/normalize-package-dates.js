/**
 * 一次性脚本：按新规则校准所有已激活套餐的起止日期
 * 规则：end = start + duration - 1 天，start 取当天 00:00（北京时间），end 取最后一天 23:59:59.999（北京时间）
 * 执行：node scripts/normalize-package-dates.js
 */
const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const config = require('../src/config');
const UserPackage = require('../src/models/UserPackage');

const BEIJING_TZ = 'Asia/Shanghai';

function calculateValidityDates(startMoment, durationValue, durationUnit) {
  const start = startMoment.tz(BEIJING_TZ).startOf('day');
  let end;
  if (durationUnit === 'month') {
    end = start.add(durationValue, 'month').subtract(1, 'day').endOf('day');
  } else if (durationUnit === 'year') {
    end = start.add(durationValue, 'year').subtract(1, 'day').endOf('day');
  } else {
    end = start.add(durationValue, 'day').subtract(1, 'day').endOf('day');
  }
  return { start_date: start.toDate(), end_date: end.toDate() };
}

async function main() {
  await mongoose.connect(config.mongodbUri);
  console.log('MongoDB 连接成功');

  // 处理已激活（非暂停中）的套餐；暂停中的套餐需要保留停卡延期，暂不批量处理
  const query = {
    is_activated: true,
    status: { $ne: 'suspended' },
    start_date: { $exists: true, $ne: null },
    duration_value: { $exists: true, $ne: null }
  };

  const packages = await UserPackage.find(query).lean();
  console.log(`需校准套餐数量: ${packages.length}`);

  let updated = 0;

  for (const pkg of packages) {
    const unit = pkg.duration_unit || 'month';
    const { start_date, end_date } = calculateValidityDates(
      dayjs(pkg.start_date).tz(BEIJING_TZ),
      pkg.duration_value,
      unit
    );

    const oldEnd = pkg.end_date ? dayjs(pkg.end_date).tz(BEIJING_TZ).format('YYYY-MM-DD HH:mm:ss') : '无';

    await UserPackage.updateOne(
      { _id: pkg._id },
      {
        $set: {
          start_date,
          end_date,
          original_end_date: end_date
        }
      }
    );
    console.log(`[${pkg._id}] ${pkg.package_type} ${pkg.duration_value}${unit}: ${dayjs(start_date).tz(BEIJING_TZ).format('YYYY-MM-DD')} 至 ${dayjs(end_date).tz(BEIJING_TZ).format('YYYY-MM-DD')} (原结束 ${oldEnd})`);
    updated++;
  }

  console.log(`\n完成：更新 ${updated} 条`);
  await mongoose.connection.close();
  process.exit(0);
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
