const app = getApp();
const { request } = require('../../../utils/request');
const { requireLogin } = require('../../../utils/auth');
const wsClient = require('../../../utils/websocket-client');

Page({
  data: {
    userInfo: null,
    editing: false,
    editForm: {
      real_name: '',
      phone: '',
      gender: 0
    },
    changeRequestStatus: 'none',
    pendingFields: {},
    submitting: false
  },

  onLoad() {
    if (!requireLogin()) return;
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadUserInfo();
    // 预加载订阅消息模板，确保后续在 tap 事件中调用 wx.requestSubscribeMessage 时模板已缓存
    try {
      const { fetchTemplates } = require('../../../utils/subscribe-message');
      fetchTemplates(true).catch(() => {});
    } catch (e) {}
    // 连接 WebSocket，监听审核结果实时推送
    this._connectWS();
  },

  onHide() {
    wsClient.disconnect();
  },

  onUnload() {
    wsClient.disconnect();
  },

  _connectWS() {
    const self = this;
    wsClient.connect({
      onMessage: {
        phone_audit_result: function() {
          self.loadUserInfo();
        },
        info_change_result: function() {
          self.loadUserInfo();
        }
      }
    });
  },

  loadUserInfo() {
    request({ url: '/auth/me', silent: true }).then(res => {
      if (res.data) {
        const userInfo = res.data;
        const baseUrl = app && app.globalData && app.globalData.baseUrl;
        const serverBase = require('../../../config/index.js').serverBase;
        // 头像URL补全（静态文件在服务器根路径，非API路径下）
        if (userInfo.avatar && userInfo.avatar.startsWith('/')) {
          userInfo.avatar = serverBase + userInfo.avatar;
        }
        app.globalData.userInfo = userInfo;
        const changeRequestStatus = userInfo.info_change_request ? userInfo.info_change_request.status : 'none';
        // 提取各字段的待审核值，只对有修改的字段显示审核中状态
        const pendingData = (userInfo.info_change_request && userInfo.info_change_request.status === 'pending')
          ? (userInfo.info_change_request.pending_data || {})
          : {};
        const pendingFields = {};
        if (pendingData.real_name !== undefined) pendingFields.real_name = pendingData.real_name;
        if (pendingData.phone !== undefined) pendingFields.phone = pendingData.phone;
        if (pendingData.gender !== undefined) pendingFields.gender = pendingData.gender;
        this.setData({
          userInfo,
          changeRequestStatus,
          pendingFields,
          editForm: {
            real_name: userInfo.real_name || '',
            phone: userInfo.reserve_phone || userInfo.phone || '',
            gender: userInfo.gender || 0
          }
        });
      }
    }).catch(() => {});
  },

  onEditTap() {
    this.setData({ editing: true });
  },

  onCancelEdit() {
    const { userInfo } = this.data;
    this.setData({
      editing: false,
      editForm: {
        real_name: userInfo.real_name || '',
        phone: userInfo.reserve_phone || userInfo.phone || '',
        gender: userInfo.gender || 0
      }
    });
  },

  onRealNameInput(e) {
    this.setData({ 'editForm.real_name': e.detail.value });
  },

  onPhoneInput(e) {
    this.setData({ 'editForm.phone': e.detail.value });
  },

  onGenderSelect(e) {
    const gender = parseInt(e.currentTarget.dataset.gender);
    this.setData({ 'editForm.gender': gender });
  },

  onSubmitChange() {
    const { editForm, userInfo } = this.data;

    // 收集需要审核的字段（姓名、手机号、性别）
    const auditChanges = {};
    if (editForm.real_name !== (userInfo.real_name || '')) auditChanges.real_name = editForm.real_name;
    if (editForm.phone !== (userInfo.reserve_phone || userInfo.phone || '')) auditChanges.phone = editForm.phone;
    if (editForm.gender !== (userInfo.gender || 0)) auditChanges.gender = editForm.gender;

    const hasAuditChange = Object.keys(auditChanges).length > 0;

    if (!hasAuditChange) {
      wx.showToast({ title: '没有修改任何信息', icon: 'none', duration: 2000 });
      this.setData({ editing: false });
      return;
    }

    // 校验必填
    const realName = editForm.real_name.trim();
    if (!realName) { wx.showToast({ title: '请输入真实姓名', icon: 'none' }); return; }
    if (!/^1[3-9]\d{9}$/.test(editForm.phone)) { wx.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
    if (editForm.gender !== 1 && editForm.gender !== 2) { wx.showToast({ title: '请选择性别', icon: 'none' }); return; }

    // 请求审核结果订阅授权（模板已在 onShow 预加载，此处直接调用不触发网络请求）
    try {
      const { requestPhoneAuditSubscribe } = require('../../../utils/subscribe-message');
      requestPhoneAuditSubscribe().catch(function(e) {
        console.log('[MemberInfo] 请求审核订阅授权失败:', e.message);
      });
    } catch (e) {
      console.log('[MemberInfo] 请求审核订阅授权失败:', e.message);
    }

    this.setData({ submitting: true });
    request({
      url: '/members/info-change/request',
      method: 'POST',
      data: auditChanges
    }).then(() => {
      this.setData({ submitting: false, editing: false, changeRequestStatus: 'pending' });
      wx.showToast({ title: '修改申请已提交', icon: 'success' });
      this.loadUserInfo();
    }).catch(err => {
      this.setData({ submitting: false });
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    });
  }
});
