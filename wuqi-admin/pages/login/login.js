const { adminLogin } = require('../../utils/auth');

Page({
  data: {
    username: '',
    password: '',
    loading: false
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