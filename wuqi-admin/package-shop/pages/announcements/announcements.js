const app = getApp();
const { request } = require('../../../utils/request');

Page({
  data: {
    loading: true,
    showModal: false,
    editingItem: null,
    announcements: [],
    storeList: [],
    storeOptions: [],
    storeIndex: 0,
    currentStoreFilter: '全部',
    filterStoreId: '',
    formTitle: '',
    formContent: '',
    formStoreIndex: 0,
    formStoreName: '全部',
    formStoreId: '',
    formStatus: 'active',
    deleting: false // 防抖标志位
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const userInfo = app.globalData.userInfo;
      let allStores = app.globalData.storeList || [];

      if (allStores.length === 0) {
        try {
          const storesRes = await request({ url: '/stores', method: 'GET' });
          allStores = Array.isArray(storesRes.data) ? storesRes.data : (storesRes.data && storesRes.data.data) || [];
          app.globalData.storeList = allStores;
        } catch (e) {
          console.error('加载门店列表失败', e);
        }
      }

      let storeList = allStores;
      if (userInfo && userInfo.role === 'store_manager' && userInfo.store_id) {
        storeList = allStores.filter(s => s._id === userInfo.store_id);
      }

      const storeNames = storeList.map(s => s.name);
      const storeOptions = [{ _id: '', name: '全部' }, ...storeList];

      this.setData({
        storeList,
        storeOptions,
        storeIdxList: storeNames,
        filterStoreId: '',
        currentStoreFilter: '全部',
        storeIndex: 0,
        formStoreIndex: 0,
        formStoreName: '全部',
        formStoreId: ''
      });

      await this.loadAnnouncements();
    } catch (err) {
      console.error('加载失败', err);
      this.setData({ loading: false });
    }
  },

  async loadAnnouncements() {
    try {
      const parts = [];
      if (this.data.filterStoreId) parts.push('store_id=' + this.data.filterStoreId);
      const query = parts.length > 0 ? '?' + parts.join('&') : '';

      const res = await request({ url: '/announces' + query, method: 'GET' });
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({ announcements: list, loading: false });
    } catch (err) {
      console.error('加载公告失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onStoreChange(e) {
    const idx = Number(e.detail.value);
    const store = this.data.storeOptions[idx];
    const filterStoreId = (store && store._id) || '';
    this.setData({
      storeIndex: idx,
      currentStoreFilter: store ? store.name : '全部',
      filterStoreId
    });
    this.loadAnnouncements();
  },

  onShowAddModal() {
    const currentStore = app.globalData.currentStore;
    let formStoreIndex = 0;
    let formStoreId = '';
    let formStoreName = '全部';

    if (currentStore) {
      const idx = this.data.storeOptions.findIndex(s => s._id === currentStore._id);
      if (idx >= 0) {
        formStoreIndex = idx;
        formStoreId = currentStore._id;
        formStoreName = currentStore.name;
      }
    }

    this.setData({
      showModal: true,
      editingItem: null,
      formTitle: '',
      formContent: '',
      formStoreIndex,
      formStoreId,
      formStoreName,
      formStatus: 'active'
    });
  },

  onShowEditModal(e) {
    const item = e.currentTarget.dataset.item;
    const storeId = item.store_id ? (item.store_id._id || item.store_id) : '';
    const idx = this.data.storeOptions.findIndex(s => s._id === storeId);

    this.setData({
      showModal: true,
      editingItem: item,
      formTitle: item.title || '',
      formContent: item.content || '',
      formStoreIndex: idx >= 0 ? idx : 0,
      formStoreId: storeId || '',
      formStoreName: idx >= 0 ? this.data.storeOptions[idx].name : '全部',
      formStatus: item.status || 'active'
    });
  },

  onCloseModal() {
    this.setData({ showModal: false });
  },

  onModalTap() {},

  onTitleInput(e) {
    this.setData({ formTitle: e.detail.value });
  },

  onContentInput(e) {
    this.setData({ formContent: e.detail.value });
  },

  onFormStoreChange(e) {
    const idx = Number(e.detail.value);
    const store = this.data.storeOptions[idx];
    this.setData({
      formStoreIndex: idx,
      formStoreId: (store && store._id) || '',
      formStoreName: store ? store.name : '全部'
    });
  },

  onToggleFormStatus(e) {
    this.setData({ formStatus: e.currentTarget.dataset.status });
  },

  async onSubmit() {
    const { formTitle, formContent, formStoreId, formStatus, editingItem } = this.data;

    if (!formTitle.trim()) {
      wx.showToast({ title: '请输入公告标题', icon: 'none' });
      return;
    }
    if (!formContent.trim()) {
      wx.showToast({ title: '请输入公告内容', icon: 'none' });
      return;
    }

    try {
      const payload = {
        title: formTitle.trim(),
        content: formContent.trim(),
        store_id: formStoreId || null,
        status: formStatus
      };

      if (editingItem) {
        await request({ url: `/announces/${editingItem._id}`, method: 'PUT', data: payload });
        wx.showToast({ title: '更新成功', icon: 'success' });
      } else {
        await request({ url: '/announces', method: 'POST', data: payload });
        wx.showToast({ title: '创建成功', icon: 'success' });
      }

      this.setData({ showModal: false });
      this.loadAnnouncements();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  async onToggleStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    try {
      await request({ url: `/announces/${id}`, method: 'PUT', data: { status } });
      wx.showToast({ title: status === 'active' ? '已启用' : '已停用', icon: 'success' });
      this.loadAnnouncements();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  onDelete(e) {
    // 防抖处理：如果正在删除中，则直接返回

    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }
    
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定继续？',
      success: async (modalRes) => {
        if (!modalRes.confirm) {
          // 用户取消删除，重置防抖标志位

          this.setData({ deleting: false });
          return;
        }
        try {
          // 设置防抖标志位

          this.setData({ deleting: true });
          await request({ url: `/announces/${id}`, method: 'DELETE' });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadAnnouncements();
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        } finally {
          // 无论成功或失败，都重置防抖标志位

          this.setData({ deleting: false });
        }
      },
      fail: () => {
        // 用户取消删除，重置防抖标志位

        this.setData({ deleting: false });
      }
    });
  }
});