const { request } = require('../../../../utils/request');
const wsClient = require('../../../../utils/websocket-client');

Page({
  data: {
    accounts: [],
    stores: [],
    currentUserRole: '',
    currentUserId: '',
    showModal: false,
    editingAccount: null,
    roleIndex: 1,
    roles: [
      { id: 'super_admin', name: '超级管理员' },
      { id: 'store_manager', name: '店长' },
      { id: 'staff', name: '员工' },
      { id: 'reviewer', name: '审核员' }
    ],
    formData: {
      name: '',
      username: '',
      password: '',
      role: 'staff',
      store_ids: []
    },
    storeCheckboxes: [],
    storeSelectAll: false,
    deleting: false, // 防抖标志位
    onlineStatusMap: {} // userId -> isOnline（仅超管维护，用于在线状态小圆点）
  },

  onShow() {
    this.loadStores();
    this.loadAccounts();
    this.getCurrentUserRole();
    // 超管订阅账号在线状态推送
    this._subscribeOnlineStatus();
  },

  onHide() {
    this._unsubscribeOnlineStatus();
  },

  onUnload() {
    this._unsubscribeOnlineStatus();
  },

  getCurrentUserRole() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (userInfo) {
      this.setData({
        currentUserRole: userInfo.role,
        currentUserId: userInfo._id || userInfo.id || ''
      });
    }
  },

  // ========== 在线状态实时订阅（仅超管） ==========
  _subscribeOnlineStatus() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo || userInfo.role !== 'super_admin') return;

    // 首次加载：通过 HTTP 接口获取所有账号初始在线状态
    this._fetchInitialOnlineStatus();

    // 订阅 WebSocket 在线状态变化事件
    wsClient.connect({
      onMessage: {
        account_online_status: (data) => {
          this._applyOnlineStatusUpdate(data);
        }
      },
      onFallback: () => {
        // WebSocket 不可用时降级为重新拉取一次全量在线状态
        this._fetchInitialOnlineStatus();
      }
    });
  },

  _unsubscribeOnlineStatus() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo || userInfo.role !== 'super_admin') return;
    wsClient.disconnect();
  },

  // 拉取初始在线状态映射，并合并到 accounts 列表
  _fetchInitialOnlineStatus() {
    request({ url: '/accounts/online-status', method: 'GET' }).then(res => {
      const list = (res.data && Array.isArray(res.data)) ? res.data : [];
      const onlineMap = {};
      list.forEach(item => {
        onlineMap[String(item.userId)] = !!item.isOnline;
      });
      this.setData({ onlineStatusMap: onlineMap });
      // 同步更新已加载的 accounts 列表中的 is_online 字段
      this._syncOnlineStatusToAccounts();
    }).catch(() => {});
  },

  // 收到 WebSocket 推送的在线状态变化，局部更新 onlineStatusMap 和对应 account
  _applyOnlineStatusUpdate(data) {
    if (!data || !data.userId) return;
    const userId = String(data.userId);
    const isOnline = !!data.isOnline;

    // 更新 onlineStatusMap
    this.setData({
      [`onlineStatusMap.${userId}`]: isOnline
    });

    // 同步更新 accounts 列表中对应账号的 is_online 字段（局部更新，避免整列表刷新）
    const accounts = this.data.accounts;
    const idx = accounts.findIndex(a => String(a._id) === userId);
    if (idx >= 0) {
      this.setData({ [`accounts[${idx}].is_online`]: isOnline });
    }
  },

  // 将 onlineStatusMap 同步到已加载的 accounts 列表
  _syncOnlineStatusToAccounts() {
    const onlineMap = this.data.onlineStatusMap;
    const accounts = this.data.accounts;
    if (!accounts || accounts.length === 0) return;

    // 找出所有 is_online 字段需要更新的账号，批量 setData
    const updates = {};
    accounts.forEach((acc, idx) => {
      const newStatus = !!onlineMap[String(acc._id)];
      if (acc.is_online !== newStatus) {
        updates[`accounts[${idx}].is_online`] = newStatus;
      }
    });
    if (Object.keys(updates).length > 0) {
      this.setData(updates);
    }
  },

  loadStores() {
    request({ url: '/stores', method: 'GET' }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (res.data || []);
      this.setData({ stores: list });
    }).catch(() => {});
  },

  loadAccounts() {
    request({ url: '/accounts', method: 'GET' }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (res.data || []);
      const roleMap = {
        'super_admin': '超级管理员',
        'store_manager': '店长',
        'staff': '员工',
        'reviewer': '审核员'
      };
      const onlineMap = this.data.onlineStatusMap;
      const processedList = list.map(item => ({
        ...item,
        roleName: roleMap[item.role] || item.role,
        storeNames: (item.role === 'super_admin' || item.role === 'reviewer')
          ? ''
          : (item.store_ids && item.store_ids.length > 0
            ? item.store_ids.map(s => s.name || '未知').join('、')
            : (item.store_id ? (item.store_id.name || '未知') : '')),
        permCount: (item.role === 'super_admin' || item.role === 'reviewer')
          ? '全部'
          : (item.permissions && item.permissions.length > 0
            ? (item.permissions[0] === '*' ? '全部' : item.permissions.length + '项')
            : '未配置'),
        // 在线状态：仅超管角色才显示，其他角色统一为 false（不渲染）
        is_online: !!onlineMap[String(item._id)]
      }));
      this.setData({ accounts: processedList });
    }).catch(() => {});
  },

  onAddAccount() {
    const allStoreIds = this.data.stores.map(s => s._id);
    const allChecked = this.data.stores.map(() => true);
    this.setData({
      showModal: true,
      editingAccount: null,
      roleIndex: 1,
      'formData.name': '',
      'formData.username': '',
      'formData.password': '',
      'formData.role': 'staff',
      'formData.store_ids': allStoreIds,
      storeCheckboxes: allChecked,
      storeSelectAll: allStoreIds.length > 0
    });
  },

  onEditAccount(e) {
    const { index } = e.currentTarget.dataset;
    const account = this.data.accounts[index];
    const roleIndex = this.data.roles.findIndex(r => r.id === account.role);
    // 处理门店多选：优先使用 store_ids，兼容旧的 store_id

    let storeIds = [];
    if (account.store_ids && account.store_ids.length > 0) {
      storeIds = account.store_ids.map(s => typeof s === 'object' ? s._id : s);
    } else if (account.store_id) {
      const sid = typeof account.store_id === 'object' ? account.store_id._id : account.store_id;
      if (sid) storeIds = [sid];
    }
    const checkboxes = this.data.stores.map(s => storeIds.includes(s._id));
    const allChecked = this.data.stores.length > 0 && checkboxes.every(c => c);
    this.setData({
      showModal: true,
      editingAccount: account,
      roleIndex: roleIndex >= 0 ? roleIndex : 1,
      'formData.name': account.nick_name || account.name || '',
      'formData.username': account.username || '',
      'formData.password': '',
      'formData.role': account.role || 'staff',
      'formData.store_ids': storeIds,
      storeCheckboxes: checkboxes,
      storeSelectAll: allChecked
    });
  },

  onCloseModal() {
    this.setData({ showModal: false });
  },

  onModalTap() {},

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`formData.${field}`]: e.detail.value });
  },

  onRoleChange(e) {
    const index = e.detail.value;
    const newRole = this.data.roles[index].id;
    if (newRole === 'super_admin' || newRole === 'reviewer') {
      // 超级管理员和审核员不绑定门店

      this.setData({
        roleIndex: index,
        'formData.role': newRole,
        'formData.store_ids': [],
        storeCheckboxes: this.data.stores.map(() => false),
        storeSelectAll: false
      });
    } else {
      // 店长、员工默认全部门店

      const allStoreIds = this.data.stores.map(s => s._id);
      const allChecked = this.data.stores.map(() => true);
      this.setData({
        roleIndex: index,
        'formData.role': newRole,
        'formData.store_ids': allStoreIds,
        storeCheckboxes: allChecked,
        storeSelectAll: allStoreIds.length > 0
      });
    }
  },

  onStoreToggle(e) {
    const { index } = e.currentTarget.dataset;
    const checkboxes = [...this.data.storeCheckboxes];
    checkboxes[index] = !checkboxes[index];
    const storeIds = this.data.stores
      .filter((s, i) => checkboxes[i])
      .map(s => s._id);
    const allChecked = this.data.stores.length > 0 && checkboxes.every(c => c);
    this.setData({
      storeCheckboxes: checkboxes,
      'formData.store_ids': storeIds,
      storeSelectAll: allChecked
    });
  },

  onStoreToggleAll() {
    const newAll = !this.data.storeSelectAll;
    const checkboxes = this.data.stores.map(() => newAll);
    const storeIds = newAll ? this.data.stores.map(s => s._id) : [];
    this.setData({
      storeCheckboxes: checkboxes,
      'formData.store_ids': storeIds,
      storeSelectAll: newAll
    });
  },

  onSubmit() {
    const { formData, editingAccount, currentUserRole } = this.data;
    if (!formData.name || !formData.username) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    if (!editingAccount && !formData.password) {
      wx.showToast({ title: '请设置密码', icon: 'none' });
      return;
    }

    let data;
    if (editingAccount) {
      data = {
        nick_name: formData.name
      };
      if (formData.role !== 'super_admin' && formData.role !== 'reviewer') {
        data.store_ids = formData.store_ids;
      } else {
        data.store_ids = [];
      }
      if (currentUserRole === 'super_admin') {
        data.role = formData.role;
      }
    } else {
      data = {
        username: formData.username,
        nick_name: formData.name,
        user_type: formData.role === 'store_manager' ? 'admin' : 'staff',
        role: formData.role,
        password: formData.password,
        store_ids: (formData.role !== 'super_admin' && formData.role !== 'reviewer') ? formData.store_ids : []
      };
    }

    const url = editingAccount ? `/accounts/${editingAccount._id}` : '/accounts';
    const method = editingAccount ? 'PUT' : 'POST';

    request({ url, method, data }).then(() => {
      wx.showToast({ title: editingAccount ? '修改成功' : '添加成功', icon: 'success' });
      this.setData({ showModal: false });
      this.loadAccounts();
    }).catch(err => {
      // 审核员只读 403：request.js 已统一提示，此处不再重复弹 toast
      if (err && err.statusCode === 403) return;
      const msg = err && err.data && err.data.message ? err.data.message : '操作失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  onToggleAccount(e) {
    const { index } = e.currentTarget.dataset;
    const account = this.data.accounts[index];
    const newStatus = account.status === 'active' ? 'disabled' : 'active';
    request({
      url: `/accounts/${account._id}/status`,
      method: 'PUT',
      data: { status: newStatus }
    }).then(() => {
      this.setData({ [`accounts[${index}].status`]: newStatus });
    }).catch(err => {
      // 审核员只读 403：request.js 已统一提示，此处不再重复弹 toast
      if (err && err.statusCode === 403) return;
      const msg = err && err.data && err.data.message ? err.data.message : '操作失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  onDeleteAccount(e) {
    // 防抖处理：如果正在删除中，则直接返回

    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }

    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '确认删除此账号？',
      success: (res) => {
        if (res.confirm) {
          // 设置防抖标志位

          this.setData({ deleting: true });
          request({
            url: `/accounts/${id}`,
            method: 'DELETE'
          }).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadAccounts();
            // 重置防抖标志位

            this.setData({ deleting: false });
          }).catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' });
            // 重置防抖标志位

            this.setData({ deleting: false });
          });
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
  },

  onGoToRoles() {
    wx.navigateTo({ url: '/package-settings/pages/settings/roles/roles' });
  },
});
