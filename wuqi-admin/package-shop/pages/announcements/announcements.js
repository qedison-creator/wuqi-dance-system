const app = getApp();
const { request } = require('../../../utils/request');

Page({
  data: {
    loading: true,
    showModal: false,
    editingItem: null,
    announcements: [],
    // 表单门店选择
    storeOptions: [],
    formTitle: '',
    formContent: '',
    formStoreIndex: 0,
    formStoreName: '全部',
    formStoreId: '',
    formStatus: 'active',
    deleting: false, // 防抖标志位
    isSingleStoreRole: false,
    isSuperAdmin: false
  },

  onShow() {
    if (!app.checkAuth()) return;
    const userInfo = app.globalData.userInfo;
    this.setData({
      isSingleStoreRole: app.isSingleStoreRole(),
      isSuperAdmin: !!(userInfo && userInfo.role === 'super_admin')
    });
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      let allStores = app.globalData.storeList || [];

      if (allStores.length === 0) {
        try {
          const storesRes = await request({ url: '/stores', method: 'GET' });
          allStores = storesRes.data && storesRes.data.list ? storesRes.data.list : (Array.isArray(storesRes.data) ? storesRes.data : []);
          app.globalData.storeList = allStores;
        } catch (e) {
          console.error('加载门店列表失败', e);
        }
      }

      // 按角色过滤门店列表
      let storeList = allStores;
      const allowedStoreIds = app.getAllowedStoreIds();
      if (allowedStoreIds !== null) {
        storeList = allStores.filter(s => allowedStoreIds.includes(String(s._id)));
      }

      // 表单门店选项：单门店角色不显示"全部"（仅显示所属门店）；其他角色显示"全部"+所属门店
      let storeOptions;
      if (app.isSingleStoreRole()) {
        storeOptions = [...storeList];
      } else {
        storeOptions = [{ _id: '', name: '全部' }, ...storeList];
      }

      this.setData({ storeOptions });

      await this.loadAnnouncements();
    } catch (err) {
      console.error('加载失败', err);
      this.setData({ loading: false });
    }
  },

  async loadAnnouncements() {
    try {
      // 从全局统一门店选择读取
      const shopStoreId = app.globalData.shopStoreId || '';
      const query = shopStoreId ? '?store_id=' + shopStoreId : '';

      const res = await request({ url: '/announces' + query, method: 'GET' });
      const rawList = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      // 标记每条公告的可操作性
      const list = rawList.map(item => {
        const storeId = item.store_id ? (item.store_id._id || item.store_id) : '';
        const storeName = item.store_id && item.store_id.name ? item.store_id.name : '';
        const isGlobal = !storeId;
        let canOperate = true;
        if (app.globalData.userInfo && app.globalData.userInfo.role !== 'super_admin' && app.globalData.userInfo.role !== 'reviewer') {
          if (isGlobal) {
            canOperate = false;
          } else {
            const allowed = app.getAllowedStoreIds();
            if (allowed && !allowed.includes(String(storeId))) canOperate = false;
          }
        }
        return {
          ...item,
          store_id: storeId,
          store_name: storeName,
          is_global: isGlobal,
          store_label: isGlobal ? '全部门店' : (storeName || '指定门店'),
          can_operate: canOperate
        };
      });
      this.setData({ announcements: list, loading: false });
    } catch (err) {
      console.error('加载公告失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onShowAddModal() {
    // 默认使用全局统一门店选择；单门店角色固定所属门店
    let formStoreIndex = 0;
    let formStoreId = '';
    let formStoreName = '全部';

    const shopStoreId = app.globalData.shopStoreId || '';
    const defaultStoreId = shopStoreId || (app.isSingleStoreRole() ? app.getDefaultStoreId() : '');

    if (defaultStoreId) {
      const idx = this.data.storeOptions.findIndex(s => String(s._id) === String(defaultStoreId));
      if (idx >= 0) {
        formStoreIndex = idx;
        formStoreId = defaultStoreId;
        formStoreName = this.data.storeOptions[idx].name;
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
    if (item.can_operate === false) {
      wx.showToast({ title: '全部门店公告仅超级管理员可编辑', icon: 'none' });
      return;
    }
    const storeId = item.store_id || '';
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
    const { formTitle, formContent, formStoreId, formStatus, editingItem, isSingleStoreRole } = this.data;

    if (!formTitle.trim()) {
      wx.showToast({ title: '请输入公告标题', icon: 'none' });
      return;
    }
    if (!formContent.trim()) {
      wx.showToast({ title: '请输入公告内容', icon: 'none' });
      return;
    }
    // 单门店角色不能创建全部门店公告
    if (isSingleStoreRole && !formStoreId) {
      wx.showToast({ title: '请选择所属门店', icon: 'none' });
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
    const { id, status, index } = e.currentTarget.dataset;
    const item = this.data.announcements[index];
    if (item && item.can_operate === false) {
      wx.showToast({ title: '全部门店公告仅超级管理员可操作', icon: 'none' });
      return;
    }
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

    const { id, index } = e.currentTarget.dataset;
    const item = this.data.announcements[index];
    if (item && item.can_operate === false) {
      wx.showToast({ title: '全部门店公告仅超级管理员可删除', icon: 'none' });
      return;
    }
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
  },

  // 全部门店公告对非超管禁用操作的提示
  onDisabledAnnouncementAction() {
    wx.showToast({ title: '全部门店公告仅超级管理员可操作', icon: 'none' });
  }
});
