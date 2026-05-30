const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
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
      // 加载提醒设置配置
      const reminderRes = await request({ url: '/config/reminder-settings', method: 'GET' });
      const reminderConfig = reminderRes.data || {};

      this.setData({
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
      packageExpireRemindDays,
      countCardLowRemind,
      inactiveRemindDays,
      reminderSendTime
    } = this.data;

    wx.showLoading({ title: '保存中...' });
    try {
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
      content: '确认重置提醒设置为默认值？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            packageExpireRemindDays: '8',
            countCardLowRemind: '5',
            inactiveRemindDays: '10',
            reminderSendTime: '14:00',
            saved: false
          });
        }
      }
    });
  }
});
