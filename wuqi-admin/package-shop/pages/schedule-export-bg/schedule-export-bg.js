const app = getApp();
const { request } = require('../../../utils/request');
const { fixImageUrl } = require('../../../utils/util');

Page({
  data: {
    bgList: [],
    activeBg: null,
    loading: true,
    uploading: false
  },

  onShow() {
    this.loadBackgrounds();
  },

  async loadBackgrounds() {
    this.setData({ loading: true });
    try {
      const res = await request({
        url: '/schedule-export/backgrounds',
        method: 'GET'
      });
      const list = res.data || [];
      const active = list.find(item => item.is_active);
      // 预处理图片URL
      list.forEach(item => {
        item.background_full_url = this._fixImageUrl(item.background_url);
      });
      this.setData({
        bgList: list,
        activeBg: active || null,
        loading: false
      });
    } catch (err) {
      console.error('加载背景图列表失败', err);
      this.setData({ loading: false });
    }
  },

  async onChooseImage() {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      });
      const filePath = chooseRes.tempFiles[0].tempFilePath;
      await this.uploadImage(filePath);
    } catch (err) {
      if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
      console.error('选择图片失败', err);
    }
  },

  async uploadImage(filePath) {
    this.setData({ uploading: true });
    wx.showLoading({ title: '上传中...' });

    try {
      const token = wx.getStorageSync('admin_token') || '';
      const baseUrl = app.globalData.baseUrl;
      const uploadRes = await new Promise((resolve, reject) => {
        wx.uploadFile({
          url: baseUrl + '/upload/image?type=schedule_background',
          filePath: filePath,
          name: 'image',
          header: { 'Authorization': 'Bearer ' + token },
          success: resolve,
          fail: reject
        });
      });

      const data = JSON.parse(uploadRes.data);
      if (data.code !== 200) {
        throw new Error(data.message || '上传失败');
      }

      const relativePath = data.data.path;
      const fileName = data.data.filename;

      // 设置为激活背景图
      await request({
        url: '/schedule-export/background',
        method: 'POST',
        data: {
          background_url: relativePath,
          background_name: fileName
        }
      });

      wx.showToast({ title: '上传成功', icon: 'success' });
      this.loadBackgrounds();
    } catch (err) {
      console.error('上传背景图失败', err);
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false });
      wx.hideLoading();
    }
  },

  async onActivate(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await request({
        url: `/schedule-export/background/${id}/activate`,
        method: 'PUT'
      });
      wx.showToast({ title: '已设为当前背景', icon: 'success' });
      this.loadBackgrounds();
    } catch (err) {
      console.error('激活失败', err);
      wx.showToast({ title: '激活失败', icon: 'none' });
    }
  },

  async onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const res = await wx.showModal({
      title: '确认删除',
      content: '确定要删除这张背景图吗？',
      confirmColor: '#E8785A'
    });
    if (!res.confirm) return;

    try {
      await request({
        url: `/schedule-export/background/${id}`,
        method: 'DELETE'
      });
      wx.showToast({ title: '删除成功', icon: 'success' });
      this.loadBackgrounds();
    } catch (err) {
      console.error('删除失败', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  _fixImageUrl(url) {
    return fixImageUrl(url);
  }
});
