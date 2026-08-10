const app = getApp();
const { request } = require('../../../utils/request');

Page({
  data: {
    loading: true,
    showModal: false,
    editingItem: null,
    announcements: [],
    formTitle: '',
    formContent: '',
    formStatus: 'active',
    deleting: false, // 防抖标志位
    canOperate: false // 当前用户是否可操作（仅超级管理员/审核员）
  },

  onShow() {
    if (!app.checkAuth()) return;
    const userInfo = app.globalData.userInfo;
    const role = userInfo && userInfo.role;
    // 仅超级管理员(super_admin)和审核员(reviewer)可操作全平台公告
    const canOperate = role === 'super_admin' || role === 'reviewer';
    this.setData({ canOperate });
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      await this.loadAnnouncements();
    } catch (err) {
      console.error('加载失败', err);
      this.setData({ loading: false });
    }
  },

  async loadAnnouncements() {
    try {
      // 调用 GET /announces 加载全部公告，前端过滤 store_id 为空（全平台公告）
      const res = await request({ url: '/announces', method: 'GET' });
      const rawList = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const canOperate = this.data.canOperate;
      // 过滤全平台公告（store_id 为空），并标记每条公告的可操作性
      let list = rawList
        .filter(item => {
          const storeId = item.store_id ? (item.store_id._id || item.store_id) : '';
          return !storeId;
        })
        .map(item => ({
          ...item,
          store_id: '',
          store_name: '',
          is_global: true,
          store_label: '全平台公告',
          can_operate: canOperate
        }));
      this.setData({ announcements: list, loading: false });
    } catch (err) {
      console.error('加载公告失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onShowAddModal() {
    // 非超管/审核员不允许新增
    if (!this.data.canOperate) {
      wx.showToast({ title: '仅超级管理员/审核员可操作', icon: 'none' });
      return;
    }
    // 全平台公告：store_id 固定为空
    this.setData({
      showModal: true,
      editingItem: null,
      formTitle: '',
      formContent: '',
      formStatus: 'active'
    });
  },

  onShowEditModal(e) {
    // 非超管/审核员不允许编辑
    if (!this.data.canOperate) {
      wx.showToast({ title: '仅超级管理员/审核员可编辑', icon: 'none' });
      return;
    }
    const item = e.currentTarget.dataset.item;
    this.setData({
      showModal: true,
      editingItem: item,
      formTitle: item.title || '',
      formContent: item.content || '',
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

  onToggleFormStatus(e) {
    this.setData({ formStatus: e.currentTarget.dataset.status });
  },

  async onSubmit() {
    const { formTitle, formContent, formStatus, editingItem } = this.data;

    if (!formTitle.trim()) {
      wx.showToast({ title: '请输入公告标题', icon: 'none' });
      return;
    }
    if (!formContent.trim()) {
      wx.showToast({ title: '请输入公告内容', icon: 'none' });
      return;
    }

    try {
      // store_id 固定为 null（全平台公告）
      const payload = {
        title: formTitle.trim(),
        content: formContent.trim(),
        store_id: null,
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
    // 非超管/审核员不允许切换状态
    if (!this.data.canOperate) {
      wx.showToast({ title: '仅超级管理员/审核员可操作', icon: 'none' });
      return;
    }
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
    // 非超管/审核员不允许删除
    if (!this.data.canOperate) {
      wx.showToast({ title: '仅超级管理员/审核员可删除', icon: 'none' });
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
  },

  // 非超管/审核员点击操作按钮的置灰提示
  onDisabledAnnouncementAction() {
    wx.showToast({ title: '仅超级管理员/审核员可操作', icon: 'none' });
  }
});
