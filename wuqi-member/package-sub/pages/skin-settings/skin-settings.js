// 皮肤外观选择页：三套皮肤即点即换，偏好仅存本地（member_skin_id）
const skin = require('../../../utils/skin.js');

Page({
  data: {
    skins: [],
    currentId: 'classic'
  },

  onShow() {
    const skin = require('../../../utils/skin.js');
    this.setData({ skinId: skin.getSkinId() });
    this.refresh();
    this.applyNav();
  },

  refresh() {
    const currentId = skin.getSkinId();
    this.setData({
      currentId: currentId,
      skins: skin.skinList()
    });
  },

  applyNav() {
    const s = skin.getSkin();
    try {
      wx.setNavigationBarColor({
        frontColor: '#000000',
        backgroundColor: s.nav.bg,
        fail: function () { /* 忽略 */ }
      });
    } catch (e) { /* 忽略 */ }
  },

  onPickSkin(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.currentId) return;
    // 写入本地偏好（resolveSkin 内部含异常回落，永不写入非法值）
    skin.setSkinId(id);
    this.refresh();
    this.applyNav();
    const target = skin.getSkin();
    wx.showToast({ title: '已切换：' + target.name, icon: 'none', duration: 1500 });
    // 轻震动反馈
    try { wx.vibrateShort({ type: 'light', fail: function () {} }); } catch (e) { /* 忽略 */ }
  }
});
