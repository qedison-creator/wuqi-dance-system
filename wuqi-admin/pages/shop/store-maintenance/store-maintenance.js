const app = getApp();
const { request } = require('../../../utils/request');

Page({
  data: {
    storeList: [],
    editingStore: null,
    editForm: {
      name: '',
      address: '',
      phone: '',
      nav_name: '',
      latitude: '',
      longitude: '',
    },
    saving: false,
  },

  onShow() {
    this.loadStoreList();
  },

  async loadStoreList() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      this.setData({ storeList: list });
    } catch (err) {
      wx.showToast({ title: '加载门店列表失败', icon: 'none' });
    }
  },

  onEditStore(e) {
    const { store } = e.currentTarget.dataset;
    if (!store) return;
    const loc = store.location || {};
    this.setData({
      editingStore: store,
      editForm: {
        name: store.name || '',
        address: store.address || '',
        phone: store.phone || '',
        nav_name: store.nav_name || '',
        latitude: loc.latitude !== undefined ? String(loc.latitude) : '',
        longitude: loc.longitude !== undefined ? String(loc.longitude) : '',
      },
    });
  },

  onCancelEdit() {
    this.setData({ editingStore: null });
  },

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    const editForm = { ...this.data.editForm };
    editForm[field] = e.detail.value;
    this.setData({ editForm });
  },

  async onSave() {
    const { editingStore, editForm } = this.data;
    if (!editingStore) return;
    if (!editForm.name.trim()) {
      wx.showToast({ title: '请输入门店名称', icon: 'none' });
      return;
    }

    const lat = editForm.latitude ? Number(editForm.latitude) : undefined;
    const lng = editForm.longitude ? Number(editForm.longitude) : undefined;

    if ((editForm.latitude && isNaN(lat)) || (editForm.longitude && isNaN(lng))) {
      wx.showToast({ title: '经纬度格式不正确', icon: 'none' });
      return;
    }

    const updateData = {
      name: editForm.name.trim(),
      address: editForm.address.trim(),
      phone: editForm.phone.trim(),
      nav_name: editForm.nav_name.trim(),
    };

    if (!isNaN(lat) && !isNaN(lng)) {
      updateData.location = { latitude: lat, longitude: lng };
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    try {
      const res = await request({
        url: `/stores/${editingStore._id}`,
        method: 'PUT',
        data: updateData,
      });

      const updatedStore = res.data || {};
      const storeList = this.data.storeList.map(s =>
        s._id === editingStore._id ? updatedStore : s
      );

      app.globalData.storeList = storeList;
      if (app.globalData.currentStore && app.globalData.currentStore._id === editingStore._id) {
        app.globalData.currentStore = updatedStore;
      }

      wx.hideLoading();
      this.setData({ storeList, editingStore: null, saving: false });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },
});