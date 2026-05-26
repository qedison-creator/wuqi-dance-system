const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const { success } = require('../utils/response');
const { getMessageTemplates, setMessageTemplates, getReminderSettings, setReminderSettings } = require('../config/messageConfig');
const Config = require('../models/Config');

// GET /api/v1/config - 获取所有配置
router.get('/', auth, checkModulePermission('config'), async (req, res, next) => {
  try {
    const configs = await Config.find();
    res.json(success(configs));
  } catch (err) {
    next(err);
  }
});

// 默认配置初始化
const DEFAULT_CONFIGS = [
  { key: 'default_booking_deadline', value: '180', description: '默认预约截止时间(分钟)' },
  { key: 'default_cancel_deadline', value: '120', description: '默认取消截止时间(分钟)' },
  { key: 'default_credits_cost', value: '1', description: '默认消耗次数' },
  { key: 'default_exemption_count', value: '3', description: '新注册会员默认豁免次数' },
  { key: 'timeout_cancel_window', value: '10', description: '超时取消窗口(分钟)' },
  { key: 'default_schedule_duration', value: '75', description: '默认排课时长(分钟)' },
  { key: 'booking_cancel_deadline', value: '120', description: '预约取消截止时间（分钟）' },
  { key: 'class_reminder_time', value: '30', description: '上课提醒时间（分钟）' },
  { key: 'package_expire_remind_days', value: '8', description: '套餐到期提前提醒天数' },
  { key: 'count_card_low_remind', value: '5', description: '次卡剩余次数低于此值时提醒' },
  { key: 'inactive_remind_days', value: '10', description: '会员未预约课程提醒天数' },
  { key: 'reminder_send_time', value: '14:00', description: '套餐提醒推送时间' }
];

// 初始化默认配置
const initDefaultConfigs = async () => {
  try {
    for (const config of DEFAULT_CONFIGS) {
      const existing = await Config.findOne({ key: config.key });
      if (!existing) {
        await Config.create(config);
        console.log(`初始化配置: ${config.key} = ${config.value}`);
      }
    }

    const templateKeys = [
      { dbKey: 'tpl_bookingSuccessTemplateId', configKey: 'bookingSuccessTemplateId' },
      { dbKey: 'tpl_classReminderTemplateId', configKey: 'classReminderTemplateId' },
      { dbKey: 'tpl_bookingCancelTemplateId', configKey: 'bookingCancelTemplateId' },
      { dbKey: 'tpl_waitlistAvailableTemplateId', configKey: 'waitlistAvailableTemplateId' },
      { dbKey: 'tpl_packageExpiringTemplateId', configKey: 'packageExpiringTemplateId' },
      { dbKey: 'tpl_packageActivatedTemplateId', configKey: 'packageActivatedTemplateId' },
      { dbKey: 'tpl_countCardLowRemindTemplateId', configKey: 'countCardLowRemindTemplateId' },
      { dbKey: 'tpl_memberInactiveRemindTemplateId', configKey: 'memberInactiveRemindTemplateId' },
      { dbKey: 'tpl_phoneAuditResultTemplateId', configKey: 'phoneAuditResultTemplateId' }
    ];

    const savedTemplates = {};
    for (const tpl of templateKeys) {
      const config = await Config.findOne({ key: tpl.dbKey });
      if (config && config.value) {
        savedTemplates[tpl.configKey] = config.value;
      }
    }

    if (Object.keys(savedTemplates).length > 0) {
      setMessageTemplates({
        bookingSuccessTemplateId: savedTemplates.bookingSuccessTemplateId || '',
        classReminderTemplateId: savedTemplates.classReminderTemplateId || '',
        bookingCancelTemplateId: savedTemplates.bookingCancelTemplateId || '',
        waitlistAvailableTemplateId: savedTemplates.waitlistAvailableTemplateId || '',
        packageExpiringTemplateId: savedTemplates.packageExpiringTemplateId || '',
        packageActivatedTemplateId: savedTemplates.packageActivatedTemplateId || '',
        countCardLowRemindTemplateId: savedTemplates.countCardLowRemindTemplateId || '',
        memberInactiveRemindTemplateId: savedTemplates.memberInactiveRemindTemplateId || '',
        phoneAuditResultTemplateId: savedTemplates.phoneAuditResultTemplateId || ''
      });
      console.log('[Config] 从数据库加载消息模板配置成功');
    }

    const reminderKeys = ['package_expire_remind_days', 'count_card_low_remind', 'inactive_remind_days', 'reminder_send_time'];
    const savedReminder = {};
    for (const key of reminderKeys) {
      const config = await Config.findOne({ key });
      if (config && config.value) {
        savedReminder[key] = config.value;
      }
    }

    if (Object.keys(savedReminder).length > 0) {
      setReminderSettings(savedReminder);
      console.log('[Config] 从数据库加载提醒设置配置成功');
    }
  } catch (err) {
    console.error('初始化默认配置失败:', err);
  }
};

// GET /api/v1/config/message-templates - 获取消息模板配置（必须在 :key 路由之前）
router.get('/message-templates', auth, checkModulePermission('config'), async (req, res, next) => {
  try {
    res.json(success(getMessageTemplates()));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/config/message-templates - 更新消息模板配置
router.put('/message-templates', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const {
      bookingSuccessTemplateId,
      classReminderTemplateId,
      bookingCancelTemplateId,
      waitlistAvailableTemplateId,
      packageExpiringTemplateId,
      packageActivatedTemplateId,
      countCardLowRemindTemplateId,
      memberInactiveRemindTemplateId,
      phoneAuditResultTemplateId
    } = req.body;

    if (!bookingSuccessTemplateId && !classReminderTemplateId) {
      return res.status(400).json({ code: 400, message: '请至少填写一个模板ID', data: null });
    }

    setMessageTemplates({
      bookingSuccessTemplateId,
      classReminderTemplateId,
      bookingCancelTemplateId,
      waitlistAvailableTemplateId,
      packageExpiringTemplateId,
      packageActivatedTemplateId,
      countCardLowRemindTemplateId,
      memberInactiveRemindTemplateId,
      phoneAuditResultTemplateId
    });

    const templateConfigs = [
      { key: 'tpl_bookingSuccessTemplateId', value: bookingSuccessTemplateId || '', description: '预约成功通知模板ID' },
      { key: 'tpl_classReminderTemplateId', value: classReminderTemplateId || '', description: '上课提醒模板ID' },
      { key: 'tpl_bookingCancelTemplateId', value: bookingCancelTemplateId || '', description: '取消预约通知模板ID' },
      { key: 'tpl_waitlistAvailableTemplateId', value: waitlistAvailableTemplateId || '', description: '候补成功通知模板ID' },
      { key: 'tpl_packageExpiringTemplateId', value: packageExpiringTemplateId || '', description: '套餐即将到期模板ID' },
      { key: 'tpl_packageActivatedTemplateId', value: packageActivatedTemplateId || '', description: '套餐已激活模板ID' },
      { key: 'tpl_countCardLowRemindTemplateId', value: countCardLowRemindTemplateId || '', description: '次卡低次数提醒模板ID' },
      { key: 'tpl_memberInactiveRemindTemplateId', value: memberInactiveRemindTemplateId || '', description: '会员不活跃提醒模板ID' },
      { key: 'tpl_phoneAuditResultTemplateId', value: phoneAuditResultTemplateId || '', description: '手机号审核结果通知模板ID' }
    ];

    for (const config of templateConfigs) {
      await Config.findOneAndUpdate(
        { key: config.key },
        { $set: { value: config.value, description: config.description } },
        { upsert: true, new: true }
      );
    }

    res.json(success(getMessageTemplates(), '配置更新成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/config/reminder-settings - 获取提醒设置配置
router.get('/reminder-settings', auth, checkModulePermission('config'), async (req, res, next) => {
  try {
    res.json(success(getReminderSettings()));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/config/reminder-settings - 更新提醒设置配置
router.put('/reminder-settings', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const {
      package_expire_remind_days,
      count_card_low_remind,
      inactive_remind_days,
      reminder_send_time
    } = req.body;

    setReminderSettings({
      package_expire_remind_days,
      count_card_low_remind,
      inactive_remind_days,
      reminder_send_time
    });

    // 同时更新数据库配置
    const configs = [
      { key: 'package_expire_remind_days', value: String(package_expire_remind_days || 8), description: '套餐到期提前提醒天数' },
      { key: 'count_card_low_remind', value: String(count_card_low_remind || 5), description: '次卡剩余次数低于此值时提醒' },
      { key: 'inactive_remind_days', value: String(inactive_remind_days || 10), description: '会员未预约课程提醒天数' },
      { key: 'reminder_send_time', value: reminder_send_time || '14:00', description: '套餐提醒推送时间' }
    ];

    for (const config of configs) {
      await Config.findOneAndUpdate(
        { key: config.key },
        { $set: { value: config.value, description: config.description } },
        { upsert: true, new: true }
      );
    }

    res.json(success(getReminderSettings(), '提醒设置更新成功'));
  } catch (err) {
    next(err);
  }
});

// 获取当前生效的模板配置（供内部服务调用，无需认证）
router.get('/active-templates', async (req, res, next) => {
  try {
    res.json(success(getMessageTemplates()));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/config/:key - 获取指定配置（必须在所有静态路由之后）
router.get('/:key', auth, checkModulePermission('config'), async (req, res, next) => {
  try {
    const config = await Config.findOne({ key: req.params.key });
    if (!config) {
      return res.status(404).json({ code: 404, message: '配置不存在', data: null });
    }
    res.json(success(config));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/config/:key - 更新指定配置（必须在所有静态路由之后）
router.put('/:key', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const { config_value, description } = req.body;
    let config = await Config.findOne({ key: req.params.key });
    
    if (config) {
      config.value = config_value;
      if (description) config.description = description;
      await config.save();
    } else {
      config = await Config.create({
        key: req.params.key,
        value: config_value,
        description: description || ''
      });
    }
    
    res.json(success(config, '配置更新成功'));
  } catch (err) {
    next(err);
  }
});

// 导出路由和初始化函数
module.exports = router;
module.exports.initDefaultConfigs = initDefaultConfigs;
