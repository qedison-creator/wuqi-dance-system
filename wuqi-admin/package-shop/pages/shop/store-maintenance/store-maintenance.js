const app = getApp();
const { request } = require('../../../../utils/request');

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
    gettingLocation: false,
    isSingleStoreRole: false, // 单门店角色隐藏新增门店按钮
    selectedStoreId: '',      // 全局统一门店选择高亮
  },

  onShow() {
    // 单门店角色不允许新增门店
    this.setData({ isSingleStoreRole: app.isSingleStoreRole() });
    this.loadStoreList();
  },

  async loadStoreList() {
    try {
      // 门店维护为门店级功能：只显示当前选中门店的信息
      let shopStoreId = app.globalData.shopStoreId || '';
      // 单门店角色使用所属门店
      if (app.isSingleStoreRole()) {
        shopStoreId = app.getDefaultStoreId() || '';
      }
      if (!shopStoreId) {
        wx.showToast({ title: '请先在店务管理选择门店', icon: 'none' });
        this.setData({ storeList: [], selectedStoreId: '' });
        return;
      }

      // 优先从全局缓存中查找门店信息
      let storeList = app.globalData.storeList || [];
      let targetStore = storeList.find(s => String(s._id) === String(shopStoreId));

      // 缓存未命中时从 API 加载全部门店后筛选
      if (!targetStore) {
        const res = await request({ url: '/stores', method: 'GET' });
        const allList = res.data && res.data.list
          ? res.data.list
          : (Array.isArray(res.data) ? res.data : []);
        app.globalData.storeList = allList;
        targetStore = allList.find(s => String(s._id) === String(shopStoreId));
      }

      // 单门店角色不允许查看非所属门店
      if (app.isSingleStoreRole()) {
        const allowed = app.getAllowedStoreIds();
        if (allowed && !allowed.includes(String(shopStoreId))) {
          wx.showToast({ title: '无权限查看该门店', icon: 'none' });
          this.setData({ storeList: [], selectedStoreId: '' });
          return;
        }
      }

      this.setData({
        storeList: targetStore ? [targetStore] : [],
        selectedStoreId: shopStoreId,
      });
    } catch (err) {
      wx.showToast({ title: '加载门店信息失败', icon: 'none' });
    }
  },

  onAddStore() {
    // 新增门店：清空表单

    this.setData({
      editingStore: { _id: 'new' }, // 使用特殊ID标识新增模式
      editForm: {
        name: '',
        address: '',
        phone: '',
        nav_name: '',
        latitude: '',
        longitude: '',
      },
    });
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

    const saveData = {
      name: editForm.name.trim(),
      address: editForm.address.trim(),
      phone: editForm.phone.trim(),
      nav_name: editForm.nav_name.trim(),
    };

    if (!isNaN(lat) && !isNaN(lng)) {
      saveData.location = { latitude: lat, longitude: lng };
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    
    try {
      let res;
      let storeList = [...this.data.storeList];
      
      if (editingStore._id === 'new') {
        // 新增门店
        res = await request({
          url: '/stores',
          method: 'POST',
          data: saveData,
        });
        
        const newStore = res.data || {};
        storeList.push(newStore);
        wx.showToast({ title: '新增成功', icon: 'success' });
      } else {
        // 更新门店
        res = await request({
          url: `/stores/${editingStore._id}`,
          method: 'PUT',
          data: saveData,
        });

        const updatedStore = res.data || {};
        storeList = storeList.map(s =>
          s._id === editingStore._id ? updatedStore : s
        );

        app.globalData.storeList = storeList;
        if (app.globalData.currentStore && app.globalData.currentStore._id === editingStore._id) {
          app.globalData.currentStore = updatedStore;
        }
        wx.showToast({ title: '保存成功', icon: 'success' });
      }

      wx.hideLoading();
      this.setData({ storeList, editingStore: null, saving: false });
    } catch (err) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },
});