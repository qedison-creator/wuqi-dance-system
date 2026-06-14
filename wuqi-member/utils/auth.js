const app = getApp();
const { request } = require('./request');

// 微信登录（支持传入store_id）
const wxLogin = (storeId) => {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        const postData = { code: loginRes.code };
        if (storeId) postData.store_id = storeId;
        request({
          url: '/auth/wx-login',
          method: 'POST',
          data: postData
        }).then(res => {
          const { token, userInfo } = res.data;
          wx.setStorageSync('token', token);
          getApp().globalData.token = token;
          getApp().globalData.userInfo = userInfo;
          
          // 登录成功后，如果选择了门店，记住这个门店
          if (storeId && getApp().globalData.storeList && getApp().globalData.storeList.length > 0) {
            const selectedStore = getApp().globalData.storeList.find(s => s._id === storeId);
            if (selectedStore) {
              getApp().setStore(selectedStore);
            }
          }
          
          resolve(userInfo);
        }).catch(reject);
      },
      fail: reject
    });
  });
};

// 检查登录状态
const checkLogin = () => {
  const token = wx.getStorageSync('token');
  return !!token;
};

// 要求登录，未登录时弹窗引导
const requireLogin = (onGoLogin) => {
  if (checkLogin()) return true;
  wx.showModal({
    title: '提示',
    content: '请先登录',
    cancelText: '暂不',
    confirmText: '去登录',
    showCancel: true,
    confirmColor: '#D4786E',
    success: (res) => {
      if (res.confirm) {
        if (onGoLogin) {
          onGoLogin();
        } else {
          wx.switchTab({ url: '/pages/profile/profile' });
        }
      }
    }
  });
  return false;
};

// 要求正式会员身份（已登录+审核通过），否则提示
const requireMember = (callback, onGoLogin) => {
  if (!requireLogin(onGoLogin)) return false;
  const userInfo = app.globalData.userInfo;
  if (!userInfo || userInfo.member_status !== 'official') {
    wx.showModal({
      title: '提示',
      content: '咨询门店工作人员成为正式会员',
      cancelText: '知道了',
      showCancel: true,
      confirmColor: '#D4786E'
    });
    return false;
  }
  if (callback) callback();
  return true;
};

// 退出登录
const logout = () => {
  wx.removeStorageSync('token');
  getApp().globalData.token = '';
  getApp().globalData.userInfo = null;
};

module.exports = { wxLogin, checkLogin, requireLogin, requireMember, logout };
