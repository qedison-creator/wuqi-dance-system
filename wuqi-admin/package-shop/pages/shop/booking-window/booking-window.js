const app = getApp();
const { request } = require('../../../../utils/request');

Page({
  data: {
    bookingWindowDays: '7',
    savedDays: '7',      // 上次保存的值，用于判断是否已修改
    saveStatus: '',      // '' | 'saved' | 'modified' | 'saving'
    storeId: '',         // 当前门店ID
    storeName: '',       // 当前门店名称
    isInherited: false,  // 是否继承全局配置
    scope: 'global',     // 'global' | 'store'
  },

  onLoad() {
    if (!app.checkAuth()) return;
    // 从全局状态读取当前选中门店
    const storeId = app.getShopStoreId() || '';
    const storeName = app.getShopStoreName ? (app.getShopStoreName() || '') : '';
    this.setData({ storeId, storeName });
    this.loadConfig();
  },

  async loadConfig() {
    try {
      const { storeId } = this.data;
      const url = storeId
        ? `/config/booking-window-days?store_id=${storeId}`
        : '/config/booking-window-days';
      const res = await request({ url, method: 'GET' });
      const config = res.data;
      if (config && config.value !== undefined) {
        const days = String(config.value);
        this.setData({
          bookingWindowDays: days,
          savedDays: days,
          saveStatus: 'saved',
          isInherited: !!config.is_inherited,
          scope: config.scope || 'global',
          storeName: config.store_name || this.data.storeName,
        });
      }
    } catch (err) {
      console.error('加载配置失败', err);
      wx.showToast({ title: err.message || '加载配置失败', icon: 'none' });
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
      const { storeId } = this.data;
      const data = { config_value: String(days), description: '预约开放窗口（天）' };
      if (storeId) {
        data.store_id = storeId;
      }
      await request({
        url: '/config/booking-window-days',
        method: 'PUT',
        data
      });
      this.setData({
        savedDays: String(days),
        saveStatus: 'saved',
        isInherited: false,
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      this.setData({ saveStatus: 'modified' });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },
});
