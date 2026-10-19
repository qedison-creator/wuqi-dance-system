Page({
  onShow() {
    // 皮肤状态（纯前端偏好，仅影响外观）
    const skin = require('../../../utils/skin.js');
    this.setData(skin.pageState());
  },

  data: {}
});