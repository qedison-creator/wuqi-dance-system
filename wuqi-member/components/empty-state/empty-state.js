Component({
  lifetimes: {
    attached() {
      try {
        const skinId = wx.getStorageSync('member_skin_id');
        this.setData({ skinId: skinId === 'paper' || skinId === 'volt' ? skinId : 'classic' });
      } catch (e) { /* 忽略 */ }
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
    onActionTap() {
      this.triggerEvent('action');
    }
  }
});
