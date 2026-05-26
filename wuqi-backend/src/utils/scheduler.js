const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const packageService = require('../services/package.service');
const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const UserPackage = require('../models/UserPackage');
const Waitlist = require('../models/Waitlist');
const Holiday = require('../models/Holiday');
const dayjs = require('dayjs');

let reminderExecutedToday = false;
let lastExecutionDate = null;

function shouldExecuteReminder() {
  const now = dayjs();
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

  // 任务3: 每天凌晨1点自动完成已结束的课程（标记未签到的为缺勤）
  cron.schedule('0 1 * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 自动完成已结束课程');
      const today = dayjs().format('YYYY-MM-DD');
      const schedules = await Schedule.find({
        date: { $lt: today },
        status: { $in: ['available', 'full'] },
      });

      let completedCount = 0;
      let absentCount = 0;

      for (const schedule of schedules) {
        // 将所有已预约但未签到的标记为缺勤
        const bookedBookings = await Booking.find({
          schedule_id: schedule._id,
          status: 'booked',
        });

        for (const booking of bookedBookings) {
          if (booking.checked_in) {
            booking.status = 'completed';
            booking.booking_status = 'completed';
          } else {
            booking.status = 'absent';
            booking.booking_status = 'completed';
          }
          await booking.save();
          completedCount++;
          if (!booking.checked_in) absentCount++;
        }

        schedule.status = 'completed';
        await schedule.save();
      }

      console.log(`[Scheduler] 课程自动完成: ${schedules.length}节课, ${completedCount}个预约处理完成, ${absentCount}个缺勤`);
    } catch (err) {
      console.error('[Scheduler] 课程自动完成任务执行失败:', err.message);
    }
  });

  // 任务4: 每小时检查并发送上课提醒（提前1小时提醒）
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 上课提醒检查');
      const wechatMessageService = require('../services/wechat-message.service');

      // 查找1小时后开始的课程
      const oneHourLater = dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm');
      const oneHourLaterDate = dayjs().add(1, 'hour').format('YYYY-MM-DD');
      const oneHourLaterTime = dayjs().add(1, 'hour').format('HH:mm');

      const upcomingSchedules = await Schedule.find({
        date: oneHourLaterDate,
        start_time: oneHourLaterTime,
        status: { $in: ['available', 'full'] },
      });

      let reminderCount = 0;
      for (const schedule of upcomingSchedules) {
        const bookings = await Booking.find({
          schedule_id: schedule._id,
          status: 'booked',
        }).populate('user_id', 'openid nick_name');

        for (const booking of bookings) {
          if (booking.user_id && booking.user_id.openid) {
            await wechatMessageService.sendClassReminder(booking.user_id, schedule);
            reminderCount++;
          }
        }
      }

      console.log(`[Scheduler] 上课提醒完成: ${reminderCount}条提醒已发送`);
    } catch (err) {
      console.error('[Scheduler] 上课提醒任务执行失败:', err.message);
    }
  });

  // 任务5: 每30分钟检查预约截止的课程，不足最低人数自动取消
  cron.schedule('*/30 * * * *', async () => {
    try {
      console.log('[Scheduler] 开始执行: 检查预约截止最低人数');
      const wechatMessageService = require('../services/wechat-message.service');
      const User = require('../models/User');
      const logService = require('../services/log.service');

      const now = dayjs();
      const today = now.format('YYYY-MM-DD');
      const currentTime = now.format('HH:mm');

      // 查找今天所有即将开始或已过预约截止时间的课程
      const schedules = await Schedule.find({
        date: today,
        status: { $in: ['available', 'full'] },
      }).populate('store_id', 'name');

      let cancelledCount = 0;
      let notifiedCount = 0;

      for (const schedule of schedules) {
        // 计算预约截止时间（默认课前2小时）
        const classStartTime = schedule.start_time;
        const deadlineMinutes = schedule.booking_deadline || 120;
        const [hours, minutes] = classStartTime.split(':').map(Number);
        const classDate = dayjs(`${today} ${classStartTime}`);
        const deadlineTime = classDate.subtract(deadlineMinutes, 'minute');
        const deadlineTimeStr = deadlineTime.format('HH:mm');

        // 检查是否已过预约截止时间
        if (now.isAfter(deadlineTime) || now.format('HH:mm') === deadlineTimeStr) {
          const minBookings = schedule.min_bookings || 0;
          const currentBookings = schedule.current_bookings || 0;

          // 检查是否不足最低人数
          if (minBookings > 0 && currentBookings < minBookings) {
            console.log(`[Scheduler] 课程 ${schedule.course_name} 预约人数不足: ${currentBookings}/${minBookings}，自动取消`);

            // 获取所有预约记录
            const bookings = await Booking.find({
              schedule_id: schedule._id,
              status: 'booked',
            }).populate('user_id', 'openid nick_name phone');

            // 取消所有预约并退还课时
            for (const booking of bookings) {
              booking.status = 'cancelled';
              booking.booking_status = 'cancelled';
              booking.cancel_type = 'normal';
              booking.cancel_reason = '因预约人数不足，课程已取消';
              await booking.save();

              // 退还课时（仅次卡用户需要退还）
              const pkg = booking.user_package_id
                ? await UserPackage.findById(booking.user_package_id)
                : await UserPackage.findOne({
                    user_id: booking.user_id._id,
                    status: 'active',
                  });
              if (pkg && booking.credits_deducted > 0 && pkg.package_type === 'count_card') {
                pkg.remaining_credits += booking.credits_deducted;
                await pkg.save();
              }

              // 发送取消通知
              if (booking.user_id && booking.user_id.openid) {
                try {
                  await wechatMessageService.sendBookingCancel(
                    booking.user_id,
                    schedule,
                    '因预约人数不足，课程已取消，次数已退还'
                  );
                  notifiedCount++;
                } catch (notifyErr) {
                  console.error('[Scheduler] 发送取消通知失败:', notifyErr.message);
                }
              }
            }

            // 更新课程状态
            schedule.status = 'cancelled';
            schedule.cancel_reason = '预约人数不足';
            schedule.current_bookings = 0;
            await schedule.save();

            cancelledCount++;
          }
        }
      }

      if (cancelledCount > 0) {
        console.log(`[Scheduler] 最低人数检查完成: 取消${cancelledCount}节课, 通知${notifiedCount}位会员`);
      }
    } catch (err) {
      console.error('[Scheduler] 最低人数检查任务执行失败:', err.message);
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

  // 任务8: 每分钟检查是否到达套餐提醒推送时间
  cron.schedule('* * * * *', async () => {
    try {
      if (!shouldExecuteReminder()) {
        return;
      }

      const Config = require('../models/Config');
      const reminderConfig = await Config.findOne({ key: 'reminder_send_time' });
      const sendTime = reminderConfig ? reminderConfig.value : '14:00';

      const now = dayjs();
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
      const Video = require('../models/Video');
      const uploadsDir = path.join(__dirname, '../../uploads');
      const files = fs.readdirSync(uploadsDir);
      const banners = await Banner.find({}, 'image_url').lean();
      const videos = await Video.find({}, 'video_url cover_url').lean();
      const referencedFiles = new Set();
      for (const b of banners) {
        if (b.image_url) referencedFiles.add(path.basename(b.image_url));
      }
      for (const v of videos) {
        if (v.video_url) referencedFiles.add(path.basename(v.video_url));
        if (v.cover_url) referencedFiles.add(path.basename(v.cover_url));
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

  // 任务11: 每分钟检查到达开课时间的课程，自动完成签到
  cron.schedule('* * * * *', async () => {
    try {
      const now = dayjs();
      const today = now.format('YYYY-MM-DD');
      const currentTime = now.format('HH:mm');

      const startingSchedules = await Schedule.find({
        date: today,
        start_time: currentTime,
        status: { $in: ['available', 'full'] },
      });

      if (startingSchedules.length === 0) return;

      const bookingService = require('../services/booking.service');
      let totalProcessed = 0;
      let totalCheckedIn = 0;

      for (const schedule of startingSchedules) {
        const result = await bookingService.autoCheckIn(schedule._id);
        totalProcessed += result.processed;
        totalCheckedIn += result.checked_in;
      }

      if (totalProcessed > 0) {
        console.log(`[Scheduler] 自动签到完成: ${startingSchedules.length}节课, 处理${totalProcessed}个预约, ${totalCheckedIn}个已自动签到`);
      }
    } catch (err) {
      console.error('[Scheduler] 自动签到任务执行失败:', err.message);
    }
  });

  console.log('[Scheduler] 所有定时任务已注册');
};

module.exports = { startScheduler };
