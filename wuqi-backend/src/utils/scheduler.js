const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const packageService = require('../services/package.service');
const wechatMessageService = require('../services/wechat-message.service');
const scheduleService = require('../services/schedule.service');
const bookingService = require('../services/booking.service');
const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');
const attendanceService = require('../services/attendance.service');
const User = require('../models/User');
const UserPackage = require('../models/UserPackage');
const Waitlist = require('../models/Waitlist');
const Holiday = require('../models/Holiday');
const PendingTask = require('../models/PendingTask');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const BEIJING_TZ = 'Asia/Shanghai';
const bjNow = () => dayjs().tz(BEIJING_TZ);

let reminderExecutedToday = false;
let lastExecutionDate = null;

function shouldExecuteReminder() {
  const now = bjNow();
  const today = now.format('YYYY-MM-DD');
  
  if (lastExecutionDate !== today) {
    reminderExecutedToday = false;
    lastExecutionDate = today;
  }
  
  return !reminderExecutedToday;
}

function markReminderExecuted() {
  reminderExecutedToday = true;
}

/**
 * 定时任务调度器
 * 启动所有定时任务
 */
const startScheduler = () => {
  console.log('[Scheduler] 定时任务调度器启动...');

  // 任务1: 每天凌晨2点检查自动激活超时未使用的pending套餐
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 检查自动激活pending套餐');
      const result = await packageService.checkAutoActivation();
      console.log(`[Scheduler] 自动激活完成: ${result.activated_count}个套餐已激活`);
    } catch (err) {
      console.error('[Scheduler] 自动激活任务执行失败:', err.message);
    }
  });

  // 任务1b: 每天凌晨2:15检查超过60天未预约的pending套餐，设置自动激活
  cron.schedule('15 2 * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 2个月未预约自动激活检查');
      const sixtyDaysAgo = dayjs().subtract(60, 'day').toDate();
      const oldPendingPackages = await UserPackage.find({
        status: 'pending',
        is_activated: false,
        created_at: { $lte: sixtyDaysAgo },
        $or: [
          { auto_activate_at: { $exists: false } },
          { auto_activate_at: null }
        ]
      });

      if (oldPendingPackages.length === 0) {
        console.log('[Scheduler] 2个月未预约检查: 无需处理的套餐');
        return;
      }

      let setCount = 0;
      for (const pkg of oldPendingPackages) {
        pkg.auto_activate_at = new Date();
        await pkg.save();
        setCount++;
      }

      console.log(`[Scheduler] 2个月未预约: ${setCount}个套餐已设置自动激活时间`);

      if (setCount > 0) {
        const result = await packageService.checkAutoActivation();
        console.log(`[Scheduler] 2个月未预约自动激活完成: ${result.activated_count}个套餐已激活`);
      }
    } catch (err) {
      console.error('[Scheduler] 2个月未预约自动激活任务执行失败:', err.message);
    }
  });

  // 任务2: 每天凌晨3点检查过期套餐
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 检查过期套餐');
      const expiredPackages = await UserPackage.find({
        status: 'active',
        end_date: { $lte: new Date(), $ne: null },
      });
      let count = 0;
      for (const pkg of expiredPackages) {
        pkg.status = 'expired';
        await pkg.save();
        count++;
      }
      console.log(`[Scheduler] 过期套餐检查完成: ${count}个套餐已标记为过期`);
    } catch (err) {
      console.error('[Scheduler] 过期套餐检查任务执行失败:', err.message);
    }
  });

  // 任务4: 每分钟处理 PendingTask（上课提醒 / 人数不足取消 / 自动签到 / 课程完成）
  // 替代旧的任务3（课程完成轮询）、任务4（上课提醒轮询）、任务5（人数不足轮询）、任务11（自动签到轮询）
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      let processedCount = 0;

      // 每次最多处理 100 条，避免单次执行过久
      for (let i = 0; i < 100; i++) {
        // 原子认领：将 pending 改为 sending，防止多实例并发
        const task = await PendingTask.findOneAndUpdate(
          { trigger_at: { $lte: now }, processed: 'pending' },
          { processed: 'sending', updated_at: new Date() },
          { new: true }
        );

        if (!task) break; // 没有待处理的任务了

        try {
          // 上课提醒
          if (task.type === 'class_reminder_1h' || task.type === 'class_reminder_30m') {
            const schedule = await Schedule.findById(task.schedule_id)
              .populate('coach_id', 'name')
              .populate('store_id', 'name')
              .lean();

            if (!schedule || !['available', 'full'].includes(schedule.status)) {
              task.processed = 'done';
              await task.save();
              processedCount++;
              continue;
            }

            const user = await User.findById(task.user_id);
            if (user && user.openid) {
              const reminderType = task.type === 'class_reminder_1h' ? '1h' : '30m';
              await wechatMessageService.sendClassReminder(user, schedule, 'member', reminderType);
            }

            task.processed = 'done';
            await task.save();
            processedCount++;
          }

          // 人数不足自动取消
          if (task.type === 'min_bookings_check') {
            const schedule = await Schedule.findById(task.schedule_id);
            if (!schedule || !['available', 'full'].includes(schedule.status)) {
              task.processed = 'done';
              await task.save();
              processedCount++;
              continue;
            }

            const startDateTime = dayjs.tz(schedule.date + ' ' + schedule.start_time, BEIJING_TZ);
            if (bjNow().isAfter(startDateTime)) {
              task.processed = 'done';
              await task.save();
              processedCount++;
              continue;
            }

            const realtimeBookings = await Booking.countDocuments({
              schedule_id: task.schedule_id,
              status: 'booked'
            });

            const minBookings = schedule.min_bookings || 5;
            if (realtimeBookings < minBookings) {
              await scheduleService.cancelSchedule(
                task.schedule_id,
                null,
                '预约人数不足',
                'min_bookings_not_met'
              );
            }

            task.processed = 'done';
            await task.save();
            processedCount++;
          }

          // 自动签到（开课时间触发）
          if (task.type === 'auto_check_in') {
            const schedule = await Schedule.findById(task.schedule_id);
            if (!schedule || ['cancelled', 'cancelled_insufficient', 'offline', 'deleted', 'completed'].includes(schedule.status)) {
              task.processed = 'done';
              await task.save();
              processedCount++;
              continue;
            }

            const result = await bookingService.autoCheckIn(task.schedule_id);

            task.processed = 'done';
            await task.save();
            processedCount++;
            console.log(`[Scheduler] 自动签到: ${task.schedule_id}, 处理${result.processed}条, 签到${result.checked_in}条`);
          }

          // 课程完成（下课时间触发）
          if (task.type === 'class_complete') {
            const schedule = await Schedule.findById(task.schedule_id);
            // 已是终态（含completed）直接跳过，避免与auto_check_in重复处理
            if (!schedule || ['cancelled', 'cancelled_insufficient', 'offline', 'deleted', 'completed'].includes(schedule.status)) {
              task.processed = 'done';
              await task.save();
              processedCount++;
              continue;
            }

            // 查询所有状态为booked的booking
            const bookedBookings = await Booking.find({
              schedule_id: task.schedule_id,
              status: 'booked',
            });

            let completedCount = 0;
            for (const booking of bookedBookings) {
              booking.status = 'completed';
              if (!booking.checked_in) {
                booking.checked_in = true;
                booking.check_in_time = booking.check_in_time || new Date();
              }
              await booking.save();
              completedCount++;

              // 为每个用户创建attendance记录（无论是否已签到，都标记为自动签到）
              try {
                const existingAtt = await Attendance.findOne({
                  schedule_id: task.schedule_id,
                  user_id: booking.user_id,
                });
                if (!existingAtt) {
                  await attendanceService.createAttendance({
                    schedule_id: task.schedule_id,
                    user_id: booking.user_id,
                    booking_id: booking._id,
                    store_id: schedule.store_id,
                    coach_id: schedule.coach_id,
                    dance_style_id: schedule.dance_style_id,
                    check_in_time: booking.check_in_time || new Date(),
                    source: 'booking',
                    check_in_method: booking.check_in_time ? 'auto' : 'auto',
                    credits_cost: booking.credits_deducted || schedule.credits_cost || 0,
                    date: schedule.date,
                    course_name: schedule.course_name || '',
                  });
                }
              } catch (attErr) {
                console.error(`[Scheduler] class_complete 创建attendance失败: ${booking.user_id}`, attErr.message);
              }
            }

            // 只有当schedule还不是completed时才设置，避免重复操作
            if (schedule.status !== 'completed') {
              schedule.status = 'completed';
              await schedule.save();
            }

            task.processed = 'done';
            await task.save();
            processedCount++;
            console.log(`[Scheduler] 课程完成: ${task.schedule_id}, ${completedCount}个预约`);
          }
        } catch (taskErr) {
          console.error(`[Scheduler] PendingTask ${task._id} 处理失败:`, taskErr.message);
          // 失败回退为 pending，下次重试
          task.processed = 'pending';
          await task.save();
        }
      }

      if (processedCount > 0) {
        console.log(`[Scheduler] PendingTask 处理完成: ${processedCount} 条`);
      }
    } catch (err) {
      console.error('[Scheduler] PendingTask 处理失败:', err.message);
    }
  });

  // 任务4b: 每5分钟清理卡在 sending 状态超过 5 分钟的 PendingTask（宕机兜底）
  cron.schedule('*/5 * * * *', async () => {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = await PendingTask.updateMany(
        { processed: 'sending', updated_at: { $lte: fiveMinutesAgo } },
        { processed: 'pending' }
      );
      if (result.modifiedCount > 0) {
        console.log(`[Scheduler] PendingTask 兜底恢复: ${result.modifiedCount} 条`);
      }
    } catch (err) {
      console.error('[Scheduler] PendingTask 兜底恢复失败:', err.message);
    }
  });

  // 任务6: 每10分钟检查候补过期，释放名额给下一位候补用户
  cron.schedule('*/10 * * * *', async () => {
    try {
      const now = new Date();
      const expiredWaitlists = await Waitlist.find({
        status: 'notified',
        expire_at: { $lte: now },
      });

      let expiredCount = 0;
      const scheduleIdsToNotify = new Set();

      for (const waitlist of expiredWaitlists) {
        waitlist.status = 'expired';
        await waitlist.save();
        expiredCount++;
        scheduleIdsToNotify.add(waitlist.schedule_id.toString());
      }

      if (expiredCount > 0) {
        console.log(`[Scheduler] 候补过期检查: ${expiredCount}个候补已过期`);

        const bookingService = require('../services/booking.service');
        for (const scheduleId of scheduleIdsToNotify) {
          const schedule = await Schedule.findById(scheduleId);
          if (schedule && schedule.current_bookings < schedule.max_bookings) {
            bookingService.notifyWaitlistUsers(scheduleId).catch(err => {
              console.error('[Scheduler] 通知候补用户失败:', err.message);
            });
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] 候补过期检查任务执行失败:', err.message);
    }
  });

  // 任务7: 每天凌晨4点清理课程已结束的候补记录
  cron.schedule('0 4 * * *', async () => {
    try {
      const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
      const oldSchedules = await Schedule.find({
        date: { $lte: yesterday },
        status: { $in: ['completed', 'cancelled'] },
      }).select('_id');

      const scheduleIds = oldSchedules.map(s => s._id);
      if (scheduleIds.length > 0) {
        const result = await Waitlist.updateMany(
          { schedule_id: { $in: scheduleIds }, status: { $in: ['waiting', 'notified'] } },
          { status: 'expired' }
        );
        console.log(`[Scheduler] 清理过期候补: ${result.modifiedCount}条记录已标记为过期`);
      }
    } catch (err) {
      console.error('[Scheduler] 清理过期候补任务执行失败:', err.message);
    }
  });

  // 任务8: 每分钟检查是否到达套餐提醒推送时间（使用北京时间）
  cron.schedule('* * * * *', async () => {
    try {
      if (!shouldExecuteReminder()) {
        return;
      }

      const Config = require('../models/Config');
      const reminderConfig = await Config.findOne({ key: 'reminder_send_time' });
      const sendTime = reminderConfig ? reminderConfig.value : '14:00';

      const now = bjNow();
      const currentTime = now.format('HH:mm');

      if (currentTime === sendTime) {
        console.log(`[Scheduler] 开始执行: 会员套餐提醒 (配置时间: ${sendTime})`);
        const reminderService = require('../services/reminder.service');
        const results = await reminderService.runAllReminders();
        console.log(`[Scheduler] 会员套餐提醒完成: 到期提醒${results.expireReminders}条, 低次数提醒${results.lowCountReminders}条, 不活跃提醒${results.inactiveReminders}条`);
        markReminderExecuted();
      }
    } catch (err) {
      console.error('[Scheduler] 会员套餐提醒任务执行失败:', err.message);
    }
  });

  // 任务9: 每天凌晨5点清理孤立的 uploads 文件
  cron.schedule('0 5 * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 清理孤立上传文件');
      const Banner = require('../models/Banner');
      const uploadsDir = path.join(__dirname, '../../uploads');
      const files = fs.readdirSync(uploadsDir);
      const banners = await Banner.find({}, 'image_url').lean();
      const referencedFiles = new Set();
      for (const b of banners) {
        if (b.image_url) referencedFiles.add(path.basename(b.image_url));
      }
      let deletedCount = 0;
      for (const file of files) {
        if (!referencedFiles.has(file)) {
          const filePath = path.join(uploadsDir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      }
      console.log(`[Scheduler] 孤立文件清理完成: 删除${deletedCount}个文件`);
    } catch (err) {
      console.error('[Scheduler] 孤立文件清理任务执行失败:', err.message);
    }
  });

  // 任务10: 每天凌晨4:30检查已过期的放假，自动解封排课
  cron.schedule('30 4 * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 自动处理已过期放假');
      const today = dayjs().format('YYYY-MM-DD');
      const expiredHolidays = await Holiday.find({
        status: 'active',
        end_date: { $lt: today },
      });

      let restoredCount = 0;
      for (const holiday of expiredHolidays) {
        const endDate = holiday.end_date || holiday.date;
        const storeId = holiday.store_scope === 'single' ? holiday.store_id : undefined;
        const filter = {
          status: 'offline',
          date: { $gte: holiday.date, $lte: endDate },
        };
        if (storeId) filter.store_id = storeId;
        const schedules = await Schedule.find(filter);
        for (const s of schedules) {
          s.status = s.current_bookings > 0 ? 'full' : 'available';
          await s.save();
          restoredCount++;
        }
        holiday.status = 'disabled';
        await holiday.save();
        console.log(`[Scheduler] 放假"${holiday.name}"已过期，解封${schedules.length}节排课`);
      }

      if (expiredHolidays.length > 0) {
        console.log(`[Scheduler] 过期放假处理完成: ${expiredHolidays.length}条放假记录, 解封${restoredCount}节排课`);
      }
    } catch (err) {
      console.error('[Scheduler] 过期放假处理任务执行失败:', err.message);
    }
  });

  // 任务12: 每天凌晨2:40检查到期的停卡套餐，自动复卡
  cron.schedule('40 2 * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 检查到期停卡自动复卡');
      const now = new Date();
      const expiredSuspends = await UserPackage.find({
        status: 'active',
        is_suspended: true,
        suspend_end_date: { $lte: now, $ne: null },
      });

      if (expiredSuspends.length === 0) {
        return;
      }

      const logService = require('../services/log.service');
      let restoredCount = 0;

      for (const pkg of expiredSuspends) {
        const suspendedAt = pkg.suspended_at;

        // 计算实际停卡天数
        let actualSuspendDays = 0;
        if (suspendedAt) {
          const diffMs = (pkg.suspend_end_date || now).getTime() - suspendedAt.getTime();
          actualSuspendDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          if (actualSuspendDays < 1) actualSuspendDays = 1;
        }

        // 校准 end_date
        if (pkg.frozen_end_date && actualSuspendDays > 0) {
          const correctedEndDate = new Date(pkg.frozen_end_date.getTime() + actualSuspendDays * 24 * 60 * 60 * 1000);
          pkg.end_date = correctedEndDate;
        }

        pkg.is_suspended = false;
        pkg.suspended_at = null;
        pkg.suspend_end_date = null;
        pkg.frozen_remaining_credits = null;
        pkg.frozen_end_date = null;
        await pkg.save();

        await logService.createLog({
          operator_id: null,
          action: 'auto_unsuspend',
          module: 'member',
          target_id: pkg.user_id,
          detail: `会员(${pkg.user_id})停卡到期（停卡${actualSuspendDays}天），系统自动复卡`,
        });

        restoredCount++;
      }

      console.log(`[Scheduler] 自动复卡完成: ${restoredCount}个套餐已恢复`);
    } catch (err) {
      console.error('[Scheduler] 自动复卡任务执行失败:', err.message);
    }
  });

  // 任务13: 每天凌晨4:30清理7天前已处理的 PendingTask
  cron.schedule('30 4 * * *', async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const result = await PendingTask.deleteMany({
        processed: 'done',
        created_at: { $lte: sevenDaysAgo }
      });
      if (result.deletedCount > 0) {
        console.log(`[Scheduler] PendingTask 清理: ${result.deletedCount} 条`);
      }
    } catch (err) {
      console.error('[Scheduler] PendingTask 清理失败:', err.message);
    }
  });

  console.log('[Scheduler] 所有定时任务已注册');
};

module.exports = { startScheduler };
