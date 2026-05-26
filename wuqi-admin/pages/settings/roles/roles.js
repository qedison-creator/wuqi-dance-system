const { request } = require('../../../utils/request');

Page({
  data: {
    roles: [],
    permissionModules: [],
    showPermModal: false,
    editingRole: null,
    editingPermissions: [],
    displayModules: [],
    loading: false,
  },

  onShow() {
    this.loadRoles();
    this.loadPermissionModules();
  },

  async loadRoles() {
    this.setData({ loading: true });
    try {
      const res = await request({ url: '/accounts/roles', method: 'GET' });
      const roles = res.data || [];
      this.setData({ roles, loading: false });
    } catch (err) {
      console.error('加载角色失败', err);
      this.setData({ loading: false });
    }
  },

  async loadPermissionModules() {
    try {
      const res = await request({ url: '/accounts/permission-modules', method: 'GET' });
      const modules = res.data || [];
      this.setData({ permissionModules: modules });
    } catch (err) {
      console.error('加载权限模块失败', err);
    }
  },

  _refreshDisplayModules() {
    const { permissionModules, editingPermissions } = this.data;
    const displayModules = permissionModules.map(m => ({
      ...m,
      checked: editingPermissions.indexOf(m.id) >= 0,
    }));
    this.setData({ displayModules });
  },

  onEditPermissions(e) {
    const role = this.data.roles[e.currentTarget.dataset.index];
    if (role.id === 'super_admin') {
      wx.showToast({ title: '超级管理员拥有全部权限', icon: 'none' });
      return;
    }

    const editingPermissions = [...(role.permissions || [])];
    this.setData({
      showPermModal: true,
      editingRole: role,
      editingPermissions,
    }, () => {
      this._refreshDisplayModules();
    });
  },

  onCloseModal() {
    this.setData({ showPermModal: false, editingRole: null, editingPermissions: [], displayModules: [] });
  },

  onModalTap() {},

  onTogglePermission(e) {
    const moduleId = e.currentTarget.dataset.id;
    const editingPermissions = [...this.data.editingPermissions];
    const index = editingPermissions.indexOf(moduleId);

    if (index >= 0) {
      editingPermissions.splice(index, 1);
    } else {
      editingPermissions.push(moduleId);
    }

    this.setData({ editingPermissions }, () => {
      this._refreshDisplayModules();
    });
  },

  onSelectAll() {
    const editingPermissions = this.data.permissionModules.map(m => m.id);
    this.setData({ editingPermissions }, () => {
      this._refreshDisplayModules();
    });
  },

  onClearAll() {
    this.setData({ editingPermissions: [] }, () => {
      this._refreshDisplayModules();
    });
  },

  async onSavePermissions() {
    const { editingRole, editingPermissions } = this.data;
    if (!editingRole) return;

    wx.showLoading({ title: '保存中...' });
    try {
      await request({
        url: `/accounts/roles/${editingRole.id}`,
        method: 'PUT',
        data: {
          permissions: editingPermissions,
        },
      });

      wx.hideLoading();
      wx.showToast({ title: '权限已更新', icon: 'success' });
      this.setData({ showPermModal: false, editingRole: null, editingPermissions: [], displayModules: [] });
      this.loadRoles();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },
});
