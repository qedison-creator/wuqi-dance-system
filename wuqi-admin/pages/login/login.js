const { adminLogin } = require('../../utils/auth');

Page({
  data: {
    username: '',
    password: '',
    rememberMe: false,
    loading: false
  },

  onLoad() {
    // 加载已保存的账号密码（验证设备指纹）
    const savedFingerprint = wx.getStorageSync('saved_device_fingerprint');
    const currentFingerprint = getApp().globalData.deviceFingerprint;
    if (savedFingerprint && savedFingerprint === currentFingerprint) {
      const savedUsername = wx.getStorageSync('saved_username');
      const savedPassword = wx.getStorageSync('saved_password');
      if (savedUsername) {
        this.setData({
          username: savedUsername,
          password: savedPassword || '',
          rememberMe: true
        });
      }
    } else {
      // 设备不匹配，清除可能残留的凭据
      wx.removeStorageSync('saved_username');
      wx.removeStorageSync('saved_password');
      wx.removeStorageSync('saved_device_fingerprint');
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

  async onLogin() {
    const { username, password } = this.data;

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
        wx.setStorageSync('saved_device_fingerprint', getApp().globalData.deviceFingerprint);
      } else {
        wx.removeStorageSync('saved_username');
        wx.removeStorageSync('saved_password');
        wx.removeStorageSync('saved_device_fingerprint');
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