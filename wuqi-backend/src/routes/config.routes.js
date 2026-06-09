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
  { key: 'reminder_send_time', value: '14:00', description: '套餐提醒推送时间' },
  { key: 'expire_remind_interval', value: '2', description: '套餐到期重复提醒间隔天数' },
  { key: 'low_count_remind_interval', value: '3', description: '次卡低次数重复提醒间隔天数' },
  { key: 'inactive_remind_interval', value: '5', description: '不活跃重复提醒间隔天数' }
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

    const reminderKeys = ['package_expire_remind_days', 'count_card_low_remind', 'inactive_remind_days', 'reminder_send_time', 'expire_remind_interval', 'low_count_remind_interval', 'inactive_remind_interval'];
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
        template_title: '预约成功通知',
        template_name: '预约成功通知',
        description: '用户在小程序中预约课程成功后，系统自动推送微信订阅消息，告知用户预约已生效。消息中将展示课程名称、授课教练、上课门店及具体上课时间，帮助用户快速确认预约详情。',
        mappings: [
          { field_name: '课程名称', wx_field: 'thing1', biz_field: 'courseName', example_value: '爵士舞入门' },
          { field_name: '上课时间', wx_field: 'time2', biz_field: 'courseTime', example_value: '2026-06-09 19:00' },
          { field_name: '教练', wx_field: 'thing3', biz_field: 'coachName', example_value: '小张' },
          { field_name: '门店', wx_field: 'thing4', biz_field: 'storeName', example_value: '固戍店' }
        ]
      },
      {
        template_key: 'classReminder',
        template_title: '课程即将开始提醒',
        template_name: '上课提醒',
        template_id: 'gdyNSKNqL1o44tUE1o16x6gzd0aeCEI21CH73o4lgr8',
        description: '课程开始前，系统自动向已预约该课程的用户推送上课提醒通知。消息中将展示课程名称、上课时间、教练、地址及温馨提醒，避免用户遗忘或跑错教室。',
        mappings: [
          { field_name: '课程名称', wx_field: 'thing1', biz_field: 'courseName', example_value: '爵士舞入门' },
          { field_name: '开始时间', wx_field: 'date2', biz_field: 'courseTime', example_value: '2026-06-09 19:00' },
          { field_name: '教练', wx_field: 'thing7', biz_field: 'coachName', example_value: '小张' },
          { field_name: '温馨提醒', wx_field: 'thing4', biz_field: 'tipMessage', example_value: '请准时到场，记得带水杯哟' },
          { field_name: '地址', wx_field: 'thing3', biz_field: 'classroom', example_value: '固戍店A教室' }
        ]
      },
      {
        template_key: 'bookingCancel',
        template_title: '预约取消通知',
        template_name: '预约取消通知',
        description: '用户在小程序中取消已预约的课程后，系统自动推送取消确认通知。消息中将展示取消的课程名称及取消原因，让用户清晰了解取消结果。',
        mappings: [
          { field_name: '课程名称', wx_field: 'thing1', biz_field: 'courseName', example_value: '爵士舞入门' },
          { field_name: '取消时间', wx_field: 'date2', biz_field: 'cancelTime', example_value: '2026-06-09 20:00' },
          { field_name: '取消原因', wx_field: 'thing3', biz_field: 'cancelReason', example_value: '个人时间安排有变' }
        ]
      },
      {
        template_key: 'waitlistAvailable',
        template_title: '团课有位提醒',
        template_name: '候补成功通知',
        template_id: 'igNOuX0hvk2rytUCaa1NcED3wSU9LrNzCtIvb5nDo-U',
        description: '当用户加入候补队列，且有已预约用户取消导致名额释放时，系统自动推送候补成功通知。消息中将展示课程名称、上课时间、上课门店及温馨提示。',
        mappings: [
          { field_name: '预约课程', wx_field: 'thing2', biz_field: 'courseName', example_value: '垫上普拉提' },
          { field_name: '上课时间', wx_field: 'time4', biz_field: 'courseTime', example_value: '9月28日 10:00-12:00' },
          { field_name: '上课门店', wx_field: 'thing5', biz_field: 'storeName', example_value: '固戍店' },
          { field_name: '温馨提示', wx_field: 'thing6', biz_field: 'tipMessage', example_value: '候补成功！记得准时去上课哦' }
        ]
      },
      {
        template_key: 'packageExpiring',
        template_title: '会员卡状态提醒',
        template_name: '套餐即将到期',
        template_id: '8aYQBsrmJ-01NuYizZILTB6fbgcx2CkJxbfcpEKr3hw',
        description: '当用户的舞蹈课程套餐即将到期时，系统自动推送到期提醒通知。消息中将展示会员卡类型、提醒类型、到期原因及续费提示，帮助用户及时续费避免权益中断。使用模板：会员卡状态提醒。',
        mappings: [
          { field_name: '会员卡类型', wx_field: 'thing2', biz_field: 'packageType', example_value: '时间卡3个月' },
          { field_name: '提醒类型', wx_field: 'short_thing1', biz_field: 'remindType', example_value: '到期提醒' },
          { field_name: '提醒原因', wx_field: 'thing3', biz_field: 'remindReason', example_value: '您的套餐还30天到期' },
          { field_name: '温馨提示', wx_field: 'thing4', biz_field: 'tipMessage', example_value: '还有30天到期，记得续费哦' }
        ]
      },
      {
        template_key: 'packageActivated',
        template_title: '会员卡状态提醒',
        template_name: '套餐已激活',
        template_id: '8aYQBsrmJ-01NuYizZILTB6fbgcx2CkJxbfcpEKr3hw',
        description: '用户成功购买或激活舞蹈课程套餐后，系统自动推送激活确认通知。消息中将展示会员卡类型、提醒类型及引导语，鼓励用户立即开始预约课程。使用模板：会员卡状态提醒。',
        mappings: [
          { field_name: '会员卡类型', wx_field: 'thing2', biz_field: 'packageType', example_value: '次卡30次' },
          { field_name: '提醒类型', wx_field: 'short_thing1', biz_field: 'remindType', example_value: '激活提醒' },
          { field_name: '提醒原因', wx_field: 'thing3', biz_field: 'remindReason', example_value: '您的新套餐已激活' },
          { field_name: '温馨提示', wx_field: 'thing4', biz_field: 'tipMessage', example_value: '解锁跳舞权限！快来约课吧' }
        ]
      },
      {
        template_key: 'countCardLowRemind',
        template_title: '会员卡状态提醒',
        template_name: '次卡低次数提醒',
        template_id: '8aYQBsrmJ-01NuYizZILTB6fbgcx2CkJxbfcpEKr3hw',
        description: '当用户的次卡剩余可用次数低于设定阈值时，系统自动推送低次数提醒通知。消息中将展示会员卡类型、提醒类型及续费引导语，提醒用户及时补充次卡。使用模板：会员卡状态提醒。',
        mappings: [
          { field_name: '会员卡类型', wx_field: 'thing2', biz_field: 'packageType', example_value: '次卡20次' },
          { field_name: '提醒类型', wx_field: 'short_thing1', biz_field: 'remindType', example_value: '次数不足提醒' },
          { field_name: '提醒原因', wx_field: 'thing3', biz_field: 'remindReason', example_value: '剩余次数仅剩3次' },
          { field_name: '温馨提示', wx_field: 'thing4', biz_field: 'tipMessage', example_value: '跳舞次数快用完啦，赶紧囤卡哟' }
        ]
      },
      {
        template_key: 'memberInactiveRemind',
        template_title: '会员卡状态提醒',
        template_name: '会员不活跃提醒',
        template_id: '8aYQBsrmJ-01NuYizZILTB6fbgcx2CkJxbfcpEKr3hw',
        description: '当会员连续多日未在小程序中预约任何课程时，系统自动推送不活跃提醒通知。消息中将展示会员卡类型、提醒类型及暖心引导语，鼓励学员重新回到课堂。使用模板：会员卡状态提醒。',
        mappings: [
          { field_name: '会员卡类型', wx_field: 'thing2', biz_field: 'packageType', example_value: '时间卡3个月' },
          { field_name: '提醒类型', wx_field: 'short_thing1', biz_field: 'remindType', example_value: '不活跃提醒' },
          { field_name: '提醒原因', wx_field: 'thing3', biz_field: 'remindReason', example_value: '您已超过30天未预约课程' },
          { field_name: '温馨提示', wx_field: 'thing4', biz_field: 'tipMessage', example_value: '舞蹈社想你啦，快来跳支舞吧' }
        ]
      },
      {
        template_key: 'phoneAuditResult',
        template_title: '审核通过提醒',
        template_name: '手机号审核结果',
        template_id: '5XXIA0wMTBDrqMMteN80EFvvooQKTqv5p2XIESRazus',
        description: '当用户提交手机号修改申请，管理员审核通过或驳回后，系统自动推送审核结果通知。消息中将展示审核事项、审核结果及审核意见，帮助用户及时了解申请进度。',
        mappings: [
          { field_name: '审核事项', wx_field: 'thing39', biz_field: 'auditItem', example_value: '手机号修改' },
          { field_name: '审核结果', wx_field: 'phrase1', biz_field: 'auditResult', example_value: '通过' },
          { field_name: '审核意见', wx_field: 'thing29', biz_field: 'remark', example_value: '您的预留手机号已更新成功' }
        ]
      }
    ];

    for (const dm of defaultMappings) {
      const existing = await TemplateFieldMapping.findOne({ template_key: dm.template_key });
      if (existing) {
        // 已存在：跳过，由管理员在管理端自行维护
        continue;
      }
      await TemplateFieldMapping.create(dm);
      console.log(`[Config] 初始化字段映射: ${dm.template_key}`);
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
      reminder_send_time,
      expire_remind_interval,
      low_count_remind_interval,
      inactive_remind_interval
    } = req.body;

    setReminderSettings({
      package_expire_remind_days,
      count_card_low_remind,
      inactive_remind_days,
      reminder_send_time,
      expire_remind_interval,
      low_count_remind_interval,
      inactive_remind_interval
    });

    // 同时更新数据库配置
    const configs = [
      { key: 'package_expire_remind_days', value: String(package_expire_remind_days || 8), description: '套餐到期提前提醒天数' },
      { key: 'count_card_low_remind', value: String(count_card_low_remind || 5), description: '次卡剩余次数低于此值时提醒' },
      { key: 'inactive_remind_days', value: String(inactive_remind_days || 10), description: '会员未预约课程提醒天数' },
      { key: 'reminder_send_time', value: reminder_send_time || '14:00', description: '套餐提醒推送时间' },
      { key: 'expire_remind_interval', value: String(expire_remind_interval || 2), description: '套餐到期重复提醒间隔天数' },
      { key: 'low_count_remind_interval', value: String(low_count_remind_interval || 3), description: '次卡低次数重复提醒间隔天数' },
      { key: 'inactive_remind_interval', value: String(inactive_remind_interval || 5), description: '不活跃重复提醒间隔天数' }
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
    // 从 TemplateFieldMapping 数据库表读取最新的模板ID
    const mappings = await TemplateFieldMapping.find();
    const templates = {};
    
    // 把 template_key 映射为 camelCase 的字段名
    const keyMap = {
      'bookingSuccess': 'bookingSuccessTemplateId',
      'classReminder': 'classReminderTemplateId',
      'bookingCancel': 'bookingCancelTemplateId',
      'waitlistAvailable': 'waitlistAvailableTemplateId',
      'packageExpiring': 'packageExpiringTemplateId',
      'packageActivated': 'packageActivatedTemplateId',
      'countCardLowRemind': 'countCardLowRemindTemplateId',
      'memberInactiveRemind': 'memberInactiveRemindTemplateId',
      'phoneAuditResult': 'phoneAuditResultTemplateId'
    };
    
    mappings.forEach(m => {
      const targetKey = keyMap[m.template_key];
      if (targetKey && m.template_id) {
        templates[targetKey] = m.template_id;
      }
    });
    
    console.log('[active-templates] 返回模板配置:', templates);
    res.json(success(templates));
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