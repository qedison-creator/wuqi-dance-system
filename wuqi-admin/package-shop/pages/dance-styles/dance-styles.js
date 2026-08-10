const app = getApp();
const { request } = require('../../../utils/request');

Page({
  data: {
    // 舞种列表
    danceStyles: [],
    // 是否为超级管理员（仅超管可增删改舞种，其他角色只读）
    isSuperAdmin: false,
    // 新增/编辑舞种弹窗
    showDanceStyleModal: false,
    danceStyleForm: {
      _id: '',
      name: '',
      sort_order: 0
    },
    deleting: false // 防抖标志位
  },

  onShow() {
    if (!app.checkAuth()) return;
    // 标记当前用户是否为超级管理员（用于控制舞种增删改按钮显示）
    const userInfo = app.globalData.userInfo;
    this.setData({
      isSuperAdmin: userInfo && userInfo.role === 'super_admin'
    });
    this.loadDanceStyles();
  },

  async loadDanceStyles() {
    try {
      const res = await request({
        url: '/dance-styles',
        method: 'GET'
      });
      // 后端返回 paginate 格式: { list: [...], total, page, pageSize }
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      // 按 sort_order 升序排序（数字越小越靠前）
      const sortedList = list.slice().sort((a, b) => {
        const sa = Number(a.sort_order) || 0;
        const sb = Number(b.sort_order) || 0;
        return sa - sb;
      });
      this.setData({ danceStyles: sortedList });
    } catch (err) {
      console.error('加载舞种列表失败', err);
    }
  },

  // 阻止弹窗内部点击冒泡到遮罩层
  onModalTap() {},

  // ==================== 舞种管理 ====================
  onAddDanceStyle() {
    this.setData({
      showDanceStyleModal: true,
      danceStyleForm: {
        _id: '',
        name: '',
        sort_order: this.data.danceStyles.length
      }
    });
  },

  onEditDanceStyle(e) {
    const index = e.currentTarget.dataset.index;
    const ds = this.data.danceStyles[index];
    this.setData({
      showDanceStyleModal: true,
      danceStyleForm: {
        _id: ds._id,
        name: ds.name,
        sort_order: ds.sort_order || 0
      }
    });
  },

  onCloseDanceStyleModal() {
    this.setData({ showDanceStyleModal: false });
  },

  onDanceStyleInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`danceStyleForm.${field}`]: e.detail.value });
  },

  async onSubmitDanceStyle() {
    const { danceStyleForm } = this.data;
    if (!danceStyleForm.name) {
      wx.showToast({ title: '请输入舞种名称', icon: 'none' });
      return;
    }

    try {
      if (danceStyleForm._id) {
        await request({
          url: `/dance-styles/${danceStyleForm._id}`,
          method: 'PUT',
          data: { name: danceStyleForm.name, sort_order: Number(danceStyleForm.sort_order) || 0 }
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/dance-styles',
          method: 'POST',
          data: { name: danceStyleForm.name, sort_order: Number(danceStyleForm.sort_order) || 0 }
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showDanceStyleModal: false });
      this.loadDanceStyles();
    } catch (err) {
      console.error('保存舞种失败', err);
    }
  },

  async onDeleteDanceStyle(e) {
    // 防抖处理：如果正在删除中，则直接返回
    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }

    const index = e.currentTarget.dataset.index;
    const ds = this.data.danceStyles[index];
    wx.showModal({
      title: '确认删除',
      content: `确定要删除舞种「${ds.name}」吗？删除后关联的教练擅长舞种将不再显示该舞种。`,
      success: async (res) => {
        if (res.confirm) {
          try {
            // 设置防抖标志位
            this.setData({ deleting: true });
            await request({
              url: `/dance-styles/${ds._id}`,
              method: 'DELETE'
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadDanceStyles();
          } catch (err) {
            console.error('删除舞种失败', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          } finally {
            // 无论成功或失败，都重置防抖标志位
            this.setData({ deleting: false });
          }
        } else {
          // 用户取消删除，重置防抖标志位
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
