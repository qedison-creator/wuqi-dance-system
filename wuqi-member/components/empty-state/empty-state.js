Component({
  lifetimes: {
    attached() {
      this._syncSkin();
    }
  },

  // 页面每次显示时重读皮肤偏好：跨页切换皮肤后，空状态不再停留在旧皮肤
  pageLifetimes: {
    show() {
      this._syncSkin();
    }
  },

  options: {
    pureDataPattern: /^_/
  },

  properties: {
    icon: {
      type: String,
      value: ''
    },
    text: {
      type: String,
      value: '暂无数据'
    },
    hint: {
      type: String,
      value: ''
    },
    iconText: {
      type: Boolean,
      value: false
    },
    showAction: {
      type: Boolean,
      value: false
    },
    actionText: {
      type: String,
      value: '去看看'
    }
  },
  methods: {
    // 读取本地皮肤偏好（非法值回落 classic）
    _syncSkin() {
      try {
        const skinId = wx.getStorageSync('member_skin_id');
        const next = skinId === 'paper' || skinId === 'volt' ? skinId : 'classic';
        if (next !== this.data.skinId) this.setData({ skinId: next });
      } catch (e) { /* 忽略 */ }
    },

    onActionTap() {
      this.triggerEvent('action');
    }
  }
});
