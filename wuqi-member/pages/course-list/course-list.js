const app = getApp();
const { request } = require('../../utils/request');
const auth = require('../../utils/auth');
const { normalizeImageUrl } = require('../../utils/util');
const config = require('../../config/index.js');
const SERVER_BASE = config.serverBase;

Page({
  data: {
    courses: [],
    loading: true,
    imageErrors: {}
  },

  onLoad() {
    this.loadCourses();
  },

  onPullDownRefresh() {
    this.loadCourses().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  loadCourses() {
    this.setData({ loading: true });
    const storeId = app.globalData.currentStore ? app.globalData.currentStore._id : '';

    return request({
      url: '/home/courses',
      data: { store_id: storeId }
    }).then(res => {
      const data = res.data || {};
      const list = Array.isArray(data) ? data : (data.courses || data.data || data.list || []);
      // 规范化封面图URL
      const courses = list.map(c => ({
        ...c,
        cover: normalizeImageUrl(c.cover, SERVER_BASE)
      }));

      this.setData({ courses, loading: false });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  onCourseTap(e) {
    if (!auth.requireLogin()) return;
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({
      url: '/package-sub/pages/coach-detail/coach-detail?id=' + id
    });
  },

  onImgError(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    if (!type || !id) return;
    this.setData({ ['imageErrors.' + type + '_' + id]: true });
  }
});