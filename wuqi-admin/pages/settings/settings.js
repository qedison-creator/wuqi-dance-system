const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    // 预约成功通知
    bookingSuccessTemplateId: '',
    // 上课提醒
    classReminderTemplateId: '',
    // 取消预约通知
    bookingCancelTemplateId: '',
    // 候补成功通知
    waitlistAvailableTemplateId: '',
    // 套餐即将到期
    packageExpiringTemplateId: '',
    // 套餐已激活
    packageActivatedTemplateId: '',
    // 次卡低次数提醒模板
    countCardLowRemindTemplateId: '',
    // 会员不活跃提醒模板
    memberInactiveRemindTemplateId: '',
    phoneAuditResultTemplateId: '',
    // 套餐到期提醒天数
    packageExpireRemindDays: '8',
    // 次卡低次数提醒
    countCardLowRemind: '5',
    // 不活跃提醒天数
    inactiveRemindDays: '10',
    // 提醒推送时间
    reminderSendTime: '14:00',
    saved: false
  },

  onLoad() {
    this.loadConfig();
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      // 加载消息模板配置
      const templateRes = await request({ url: '/config/message-templates', method: 'GET' });
      const templateConfig = templateRes.data || {};

      // 加载提醒设置配置
      const reminderRes = await request({ url: '/config/reminder-settings', method: 'GET' });
      const reminderConfig = reminderRes.data || {};

      this.setData({
        bookingSuccessTemplateId: templateConfig.bookingSuccessTemplateId || '',
        classReminderTemplateId: templateConfig.classReminderTemplateId || '',
        bookingCancelTemplateId: templateConfig.bookingCancelTemplateId || '',
        waitlistAvailableTemplateId: templateConfig.waitlistAvailableTemplateId || '',
        packageExpiringTemplateId: templateConfig.packageExpiringTemplateId || '',
        packageActivatedTemplateId: templateConfig.packageActivatedTemplateId || '',
        countCardLowRemindTemplateId: templateConfig.countCardLowRemindTemplateId || '',
        memberInactiveRemindTemplateId: templateConfig.memberInactiveRemindTemplateId || '',
        phoneAuditResultTemplateId: templateConfig.phoneAuditResultTemplateId || '',
        packageExpireRemindDays: reminderConfig.package_expire_remind_days || '8',
        countCardLowRemind: reminderConfig.count_card_low_remind || '5',
        inactiveRemindDays: reminderConfig.inactive_remind_days || '10',
        reminderSendTime: reminderConfig.reminder_send_time || '14:00',
        loading: false,
        saved: true
      });
    } catch (err) {
      this.setData({ loading: false, saved: true });
      console.error('加载配置失败', err);
    }
  },

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value, saved: false });
  },

  onTimeChange(e) {
    this.setData({
      reminderSendTime: e.detail.value,
      saved: false
    });
  },

  async onSave() {
    const {
      bookingSuccessTemplateId,
      classReminderTemplateId,
      bookingCancelTemplateId,
      waitlistAvailableTemplateId,
      packageExpiringTemplateId,
      packageActivatedTemplateId,
      countCardLowRemindTemplateId,
      memberInactiveRemindTemplateId,
      phoneAuditResultTemplateId,
      packageExpireRemindDays,
      countCardLowRemind,
      inactiveRemindDays,
      reminderSendTime
    } = this.data;

    if (!bookingSuccessTemplateId && !classReminderTemplateId) {
      wx.showToast({ title: '请至少填写一个模板ID', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    try {
      // 保存消息模板配置
      await request({
        url: '/config/message-templates',
        method: 'PUT',
        data: {
          bookingSuccessTemplateId,
          classReminderTemplateId,
          bookingCancelTemplateId,
          waitlistAvailableTemplateId,
          packageExpiringTemplateId,
          packageActivatedTemplateId,
          countCardLowRemindTemplateId,
          memberInactiveRemindTemplateId,
          phoneAuditResultTemplateId
        }
      });

      // 保存提醒设置配置
      await request({
        url: '/config/reminder-settings',
        method: 'PUT',
        data: {
          package_expire_remind_days: packageExpireRemindDays,
          count_card_low_remind: countCardLowRemind,
          inactive_remind_days: inactiveRemindDays,
          reminder_send_time: reminderSendTime
        }
      });

      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({ saved: true });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  onReset() {
    wx.showModal({
      title: '重置配置',
      content: '确认重置所有配置为空？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            bookingSuccessTemplateId: '',
            classReminderTemplateId: '',
            bookingCancelTemplateId: '',
            waitlistAvailableTemplateId: '',
            packageExpiringTemplateId: '',
            packageActivatedTemplateId: '',
            countCardLowRemindTemplateId: '',
            memberInactiveRemindTemplateId: '',
            phoneAuditResultTemplateId: '',
            packageExpireRemindDays: '8',
            countCardLowRemind: '5',
            inactiveRemindDays: '10',
            reminderSendTime: '14:00',
            saved: false
          });
        }
      }
    });
  },

  onViewGuide() {
    wx.showModal({
      title: '如何获取模板ID',
      content: '1. 登录微信公众平台 mp.weixin.qq.com\n2. 进入"功能"->"订阅消息"\n3. 点击"添加模板"\n4. 搜索并添加需要的模板\n5. 在"我的模板"中复制模板ID',
      showCancel: false,
      confirmText: '知道了'
    });
  },
});
