const app = getApp();
const { request } = require('../../../../utils/request');

Page({
  data: {
    bookingWindowDays: '7',
    savedDays: '7',      // 上次保存的值，用于判断是否已修改
    saveStatus: '',      // '' | 'saved' | 'modified' | 'saving'
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
        const days = String(config.value);
        this.setData({
          bookingWindowDays: days,
          savedDays: days,
          saveStatus: 'saved',
        });
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

      // 判断当前值是否与已保存值不同
      const isModified = value !== this.data.savedDays;
      this.setData({
        bookingWindowDays: value,
        saveStatus: isModified ? 'modified' : 'saved',
      });
    }
  },

  async onSave() {
    if (this.data.saveStatus === 'saving') return;

    const days = parseInt(this.data.bookingWindowDays, 10);
    if (isNaN(days) || days < 1) {
      wx.showToast({ title: '请输入有效的天数（至少 1 天）', icon: 'none' });
      return;
    }

    this.setData({ saveStatus: 'saving' });

    try {
      await request({
        url: '/config/booking_window_days',
        method: 'PUT',
        data: { config_value: String(days), description: '预约开放窗口（天）' }
      });
      this.setData({
        savedDays: String(days),
        saveStatus: 'saved',
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      this.setData({ saveStatus: 'modified' });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
