const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const { success } = require('../utils/response');
const { getMessageTemplates, setMessageTemplates, getReminderSettings, setReminderSettings, getCancelReasons } = require('../config/messageConfig');
const Config = require('../models/Config');
const TemplateFieldMapping = require('../models/TemplateFieldMapping');

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

    const currentTemplates = getMessageTemplates();

    const templateConfigs = [
      { key: 'tpl_bookingSuccessTemplateId', value: currentTemplates.bookingSuccessTemplateId || '', description: '预约成功通知模板ID' },
      { key: 'tpl_classReminderTemplateId', value: currentTemplates.classReminderTemplateId || '', description: '上课提醒模板ID' },
      { key: 'tpl_bookingCancelTemplateId', value: currentTemplates.bookingCancelTemplateId || '', description: '取消预约通知模板ID' },
      { key: 'tpl_waitlistAvailableTemplateId', value: currentTemplates.waitlistAvailableTemplateId || '', description: '候补成功通知模板ID' },
      { key: 'tpl_packageExpiringTemplateId', value: currentTemplates.packageExpiringTemplateId || '', description: '套餐即将到期模板ID' },
      { key: 'tpl_packageActivatedTemplateId', value: currentTemplates.packageActivatedTemplateId || '', description: '套餐已激活模板ID' },
      { key: 'tpl_countCardLowRemindTemplateId', value: currentTemplates.countCardLowRemindTemplateId || '', description: '次卡低次数提醒模板ID' },
      { key: 'tpl_memberInactiveRemindTemplateId', value: currentTemplates.memberInactiveRemindTemplateId || '', description: '会员不活跃提醒模板ID' },
      { key: 'tpl_phoneAuditResultTemplateId', value: currentTemplates.phoneAuditResultTemplateId || '', description: '手机号审核结果通知模板ID' }
    ];

    for (const config of templateConfigs) {
      const existing = await Config.findOne({ key: config.key });
      if (!existing && config.value) {
        await Config.create(config);
        console.log(`初始化模板配置: ${config.key} = ${config.value}`);
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
        bookingSuccessTemplateId: savedTemplates.bookingSuccessTemplateId || currentTemplates.bookingSuccessTemplateId || '',
        classReminderTemplateId: savedTemplates.classReminderTemplateId || currentTemplates.classReminderTemplateId || '',
        bookingCancelTemplateId: savedTemplates.bookingCancelTemplateId || currentTemplates.bookingCancelTemplateId || '',
        waitlistAvailableTemplateId: savedTemplates.waitlistAvailableTemplateId || currentTemplates.waitlistAvailableTemplateId || '',
        packageExpiringTemplateId: savedTemplates.packageExpiringTemplateId || currentTemplates.packageExpiringTemplateId || '',
        packageActivatedTemplateId: savedTemplates.packageActivatedTemplateId || currentTemplates.packageActivatedTemplateId || '',
        countCardLowRemindTemplateId: savedTemplates.countCardLowRemindTemplateId || currentTemplates.countCardLowRemindTemplateId || '',
        memberInactiveRemindTemplateId: savedTemplates.memberInactiveRemindTemplateId || currentTemplates.memberInactiveRemindTemplateId || '',
        phoneAuditResultTemplateId: savedTemplates.phoneAuditResultTemplateId || currentTemplates.phoneAuditResultTemplateId || ''
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

    // 初始化默认字段映射（仅在不存在时创建）
    const defaultMappings = [
      {
        template_key: 'bookingSuccess',
        template_name: '课程预约成功通知',
        description: '用户在小程序中预约课程成功后，系统自动推送微信订阅消息，告知用户预约已生效。消息中将展示课程名称、授课教练、上课门店及具体上课时间，帮助用户快速确认预约详情。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'courseName', example_value: '拉伸课' },
          { wx_field: 'phrase2', biz_field: 'coachName', example_value: '张三' },
          { wx_field: 'thing3', biz_field: 'storeName', example_value: '微信健身馆' },
          { wx_field: 'time4', biz_field: 'courseTime', example_value: '2018-07-08 11:00~12:00' },
          { wx_field: 'time16', biz_field: 'bookingTime', example_value: '2024年10月17日15:01' }
        ]
      },
      {
        template_key: 'classReminder',
        template_name: '上课提醒',
        description: '课程开始前，系统自动向已预约该课程的用户推送上课提醒通知。消息中将展示课程名称、上课时间及具体教室位置，避免用户遗忘或跑错教室，提升学员出勤体验。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'courseName', example_value: '爵士舞入门' },
          { wx_field: 'time2', biz_field: 'courseTime', example_value: '2026-06-01 19:00' },
          { wx_field: 'thing3', biz_field: 'classroom', example_value: '固戍店A教室' }
        ]
      },
      {
        template_key: 'bookingCancel',
        template_name: '课程预约取消通知',
        description: '用户在小程序中取消已预约的课程后，系统自动推送取消确认通知。消息中将展示取消的课程名称、教练、门店及取消时间，并附带取消原因说明，让用户清晰了解取消结果。',
        mappings: [
          { wx_field: 'thing3', biz_field: 'courseName', example_value: '普拉提' },
          { wx_field: 'thing10', biz_field: 'coachName', example_value: 'John' },
          { wx_field: 'const5', biz_field: 'cancelReason', example_value: '恶劣天气' },
          { wx_field: 'thing1', biz_field: 'storeName', example_value: '瑜伽馆' },
          { wx_field: 'time12', biz_field: 'cancelTime', example_value: '2022年11月22日 16:00' }
        ]
      },
      {
        template_key: 'waitlistAvailable',
        template_name: '候补成功通知',
        description: '当已满员的课程有名额空出时，系统自动向候补队列中的用户推送通知，提醒用户当前可预约该课程。消息中将展示课程名称、上课时间，引导用户尽快完成预约。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'courseName', example_value: '有氧舞蹈' },
          { wx_field: 'time2', biz_field: 'courseTime', example_value: '2026-06-02 10:00' },
          { wx_field: 'thing3', biz_field: 'tipMessage', example_value: '有名额空出，请尽快预约' }
        ]
      },
      {
        template_key: 'packageExpiring',
        template_name: '套餐即将到期',
        description: '当用户的舞蹈课程套餐即将到期时，系统自动推送到期提醒通知。消息中将展示套餐名称、到期日期及续费提示，帮助用户及时续费避免权益中断。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'packageName', example_value: '月卡套餐' },
          { wx_field: 'date2', biz_field: 'expireDate', example_value: '2026-06-30' },
          { wx_field: 'thing3', biz_field: 'tipMessage', example_value: '您的套餐即将到期，请及时续费' }
        ]
      },
      {
        template_key: 'packageActivated',
        template_name: '套餐已激活',
        description: '用户成功购买或激活舞蹈课程套餐后，系统自动推送激活确认通知。消息中将展示套餐名称、有效期截止日期及引导语，鼓励用户立即开始预约课程。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'packageName', example_value: '次卡30次' },
          { wx_field: 'date2', biz_field: 'expireDate', example_value: '2026-12-31' },
          { wx_field: 'thing3', biz_field: 'tipMessage', example_value: '套餐已激活，快来预约课程吧' }
        ]
      },
      {
        template_key: 'countCardLowRemind',
        template_name: '次卡低次数提醒',
        description: '当用户的次卡剩余可用次数低于设定阈值时，系统自动推送低次数提醒通知。消息中将展示套餐名称、剩余次数及续费引导语，提醒用户及时补充次卡以免影响正常上课。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'packageName', example_value: '次卡20次' },
          { wx_field: 'number2', biz_field: 'remainCount', example_value: '3' },
          { wx_field: 'thing3', biz_field: 'tipMessage', example_value: '剩余次数不足，请及时续费' }
        ]
      },
      {
        template_key: 'memberInactiveRemind',
        template_name: '会员不活跃提醒',
        description: '当会员连续多日未在小程序中预约任何课程时，系统自动推送不活跃提醒通知。消息中将展示会员昵称、未活跃天数及暖心引导语，鼓励学员重新回到课堂，提升会员活跃度和留存率。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'memberNickname', example_value: '小明' },
          { wx_field: 'number2', biz_field: 'inactiveDays', example_value: '30' },
          { wx_field: 'thing3', biz_field: 'tipMessage', example_value: '好久不见，快来跳舞吧' }
        ]
      },
      {
        template_key: 'phoneAuditResult',
        template_name: '手机号审核结果',
        description: '当用户在小程序中提交手机号修改申请并完成审核后，系统自动推送审核结果通知。消息中将展示审核事项、审核结果及备注说明，使用户第一时间了解手机号变更的处理结果。',
        mappings: [
          { wx_field: 'thing1', biz_field: 'auditItem', example_value: '预留手机号修改' },
          { wx_field: 'phrase2', biz_field: 'auditResult', example_value: '审核通过' },
          { wx_field: 'thing3', biz_field: 'remark', example_value: '手机号已更新成功' }
        ]
      }
    ];

    for (const dm of defaultMappings) {
      const exists = await TemplateFieldMapping.findOne({ template_key: dm.template_key });
      if (!exists) {
        await TemplateFieldMapping.create(dm);
        console.log(`[Config] 初始化字段映射: ${dm.template_key}`);
      }
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

// 获取取消原因枚举值（无需认证）
router.get('/cancel-reasons', async (req, res, next) => {
  try {
    res.json(success(getCancelReasons()));
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