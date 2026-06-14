const { adminLogin } = require('../../utils/auth');

Page({
  data: {
    username: '',
    password: '',
    rememberMe: false,
    agreed: false,
    loading: false
  },

  onLoad() {
    // 加载已保存的账号密码（设备ID稳定存在于 storage，无需额外比对）
    const savedUsername = wx.getStorageSync('saved_username');
    const savedPassword = wx.getStorageSync('saved_password');
    if (savedUsername) {
      this.setData({
        username: savedUsername,
        password: savedPassword || '',
        rememberMe: true
      });
    }
  },

  onUnload() {
    if (this._switchTabTimer) {
      clearTimeout(this._switchTabTimer);
      this._switchTabTimer = null;
    }
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onToggleRemember() {
    this.setData({ rememberMe: !this.data.rememberMe });
  },

  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  onOpenPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  async onLogin() {
    const { username, password, agreed } = this.data;

    if (!agreed) {
      wx.showToast({ title: '请先阅读并同意隐私保护指引和用户服务协议', icon: 'none' });
      return;
    }

    if (!username) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    this.setData({ loading: true });

    try {
      const res = await adminLogin(username, password);
      wx.setStorageSync('admin_token', res.data.token);
      getApp().globalData.token = res.data.token;
      getApp().globalData.userInfo = res.data.admin;

      // 记住密码
      if (this.data.rememberMe) {
        wx.setStorageSync('saved_username', username);
        wx.setStorageSync('saved_password', password);
      } else {
        wx.removeStorageSync('saved_username');
        wx.removeStorageSync('saved_password');
      }

      wx.showToast({ title: '登录成功', icon: 'success' });
      this._switchTabTimer = setTimeout(() => {
        this._switchTabTimer = null;
        wx.switchTab({ url: '/pages/dashboard/dashboard' });
      }, 1500);
    } catch (err) {
      const msg = (err && err.message) ? err.message : '登录失败，请检查账号密码';
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
      console.error('登录失败', err);
    } finally {
      this.setData({ loading: false });
    }
  }
});