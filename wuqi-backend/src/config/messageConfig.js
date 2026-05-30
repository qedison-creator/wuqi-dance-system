/**
 * 共享配置模块
 * 供 config.routes.js 和 wechat-message.service.js 共享使用
 */

let messageTemplates = {
  bookingSuccessTemplateId: 'mVdMRIYRRDRzk789Rw3Y6xUSo6fkkbTHuA1oicTlobE',
  classReminderTemplateId: '',
  bookingCancelTemplateId: 'UICX8hELSZ_TCGg1Jdnd3nGkrn9dlk6qep6H9grWLgo',
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

const CANCEL_REASONS = [
  '不足开课人数',
  '恶劣天气',
  '教练突发状况',
  '放假',
  '其他'
];

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

exports.getCancelReasons = () => CANCEL_REASONS;
