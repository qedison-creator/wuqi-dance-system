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
    // 点击锁：同一张卡不重复响应；800ms 自动返回期间忽略后续点击，避免产生多个返回
    if (!id || id === this.data.currentId || this._leaving) return;
    // 写入本地偏好（resolveSkin 内部含异常回落，永不写入非法值）；写入失败则不提示"已切换"
    if (!skin.setSkinId(id)) {
      wx.showToast({ title: '切换失败，请重试', icon: 'none' });
      return;
    }
    this._leaving = true;
    this.refresh();
    this.applyNav();
    // 新皮肤的字体按需加载（classic 用户此前不会加载）
    if (id === 'paper') skin.ensurePaperFont();
    if (id === 'volt') skin.ensureVoltFonts();
    const target = skin.getSkin();
    wx.showToast({ title: '已切换：' + target.name, icon: 'none', duration: 1500 });
    // 轻震动反馈
    try { wx.vibrateShort({ type: 'light', fail: function () {} }); } catch (e) { /* 忽略 */ }
    // 选择完成后自动返回"我的"页面（toast 为原生层，返回后仍持续显示）
    this._backTimer = setTimeout(() => {
      this._backTimer = null;
      wx.navigateBack({
        fail: function () {
          // 非栈内进入（如开发工具直接编译到本页）：兜底切回"我的" tab
          wx.switchTab({ url: '/pages/profile/profile' });
        }
      });
    }, 800);
  },

  // 用户在 800ms 内手动返回时清掉延时器，避免页面销毁后仍触发返回、误关后续页面
  onUnload() {
    if (this._backTimer) {
      clearTimeout(this._backTimer);
      this._backTimer = null;
    }
  }
});
