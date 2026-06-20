const app = getApp();
const { request } = require('../../../utils/request');
const auth = require('../../../utils/auth');
const config = require('../../../config/index.js');
const { normalizeImageUrl } = require('../../../utils/util');
const SERVER_BASE = config.serverBase;

Page({
  data: {
    coaches: [],
    loading: true,
    loadError: false,
    imageErrors: {}
  },

  onLoad() {
    this.loadCoaches();
  },

  onPullDownRefresh() {
    this.loadCoaches().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  loadCoaches() {
    this.setData({ loading: true, loadError: false });
    const storeId = app.globalData.currentStore ? app.globalData.currentStore._id : '';

    return request({ url: '/home/coaches', data: { store_id: storeId } }).then(res => {
      const data = res.data || {};
      const list = Array.isArray(data) ? data : (data.data || data.list || []);

      const coaches = list.map(coach => ({
        ...coach,
        avatar_url: normalizeImageUrl(coach.avatar_url, SERVER_BASE),
        danceNames: coach.dance_style_names
          ? coach.dance_style_names.split(/[,，、]/).map(s => s.trim()).filter(Boolean)
          : []
      }));

      this.setData({ coaches, loading: false, loadError: false });
    }).catch((err) => {
      console.error('加载教练列表失败:', err);
      this.setData({ loading: false, loadError: true });
    });
  },

  onRetry() {
    this.loadCoaches();
  },

  onCoachTap(e) {
    if (!auth.requireLogin()) return;
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({
      url: `/package-sub/pages/coach-detail/coach-detail?id=${id}`
    });
  },

  onImgError(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    if (!type || !id) return;
    this.setData({ ['imageErrors.' + type + '_' + id]: true });
  }
});
