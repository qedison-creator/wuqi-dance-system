const app = getApp();
const { request } = require('../../../../utils/request');

Page({
  data: {
    bookingWindowDays: '7',
    saved: false
  },

  onLoad() {
    if (!app.checkAuth()) return;
    this.loadConfig();
  },

  async loadConfig() {
    try {
      const res = await request({ url: '/config/booking_window_days', method: 'GET' });
      const config = res.data;
      if (config && config.value !== undefined) {
        this.setData({ bookingWindowDays: String(config.value) });
      }
    } catch (err) {
      console.error('加载配置失败', err);
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    if (field === 'bookingWindowDays') {
      // 限制最小值为 1

      const num = parseInt(value, 10);
      if (value !== '' && (isNaN(num) || num < 1)) {
        wx.showToast({ title: '最小为 1 天', icon: 'none' });
        this.setData({ bookingWindowDays: '1' });
        return;
      }
      this.setData({ bookingWindowDays: value });
    }
  },

  async onSave() {
    const days = parseInt(this.data.bookingWindowDays, 10);
    if (isNaN(days) || days < 1) {
      wx.showToast({ title: '请输入有效的天数（至少 1 天）', icon: 'none' });
      return;
    }
    try {
      await request({
        url: '/config/booking_window_days',
        method: 'PUT',
        data: { config_value: String(days), description: '预约开放窗口（天）' }
      });
      this.setData({ saved: true });
      setTimeout(() => {
        this.setData({ saved: false });
      }, 2000);
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  onToastTap() {
    this.setData({ saved: false });
  }
});