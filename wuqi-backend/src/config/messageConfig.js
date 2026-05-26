/**
 * 共享配置模块
 * 供 config.routes.js 和 wechat-message.service.js 共享使用
 */

let messageTemplates = {
  bookingSuccessTemplateId: '',
  classReminderTemplateId: '',
  bookingCancelTemplateId: '',
  waitlistAvailableTemplateId: '',
  packageExpiringTemplateId: '',
  packageActivatedTemplateId: '',
  countCardLowRemindTemplateId: '',
  memberInactiveRemindTemplateId: '',
  phoneAuditResultTemplateId: '',
};

let reminderSettings = {
  package_expire_remind_days: 8,
  count_card_low_remind: 5,
  inactive_remind_days: 10,
  reminder_send_time: '14:00',
};

// 获取消息模板配置
exports.getMessageTemplates = () => messageTemplates;

// 设置消息模板配置
exports.setMessageTemplates = (templates) => {
  messageTemplates = {
    bookingSuccessTemplateId: templates.bookingSuccessTemplateId || '',
    classReminderTemplateId: templates.classReminderTemplateId || '',
    bookingCancelTemplateId: templates.bookingCancelTemplateId || '',
    waitlistAvailableTemplateId: templates.waitlistAvailableTemplateId || '',
    packageExpiringTemplateId: templates.packageExpiringTemplateId || '',
    packageActivatedTemplateId: templates.packageActivatedTemplateId || '',
    countCardLowRemindTemplateId: templates.countCardLowRemindTemplateId || '',
    memberInactiveRemindTemplateId: templates.memberInactiveRemindTemplateId || '',
    phoneAuditResultTemplateId: templates.phoneAuditResultTemplateId || '',
  };
};

// 获取提醒设置
exports.getReminderSettings = () => reminderSettings;

// 设置提醒设置
exports.setReminderSettings = (settings) => {
  reminderSettings = {
    package_expire_remind_days: parseInt(settings.package_expire_remind_days) || 8,
    count_card_low_remind: parseInt(settings.count_card_low_remind) || 5,
    inactive_remind_days: parseInt(settings.inactive_remind_days) || 10,
    reminder_send_time: settings.reminder_send_time || '14:00',
  };
};
