// 站内信弹窗组件：未读站内信（最多3条）自动弹出
// 「知道了/已知悉」仅关闭并记录本批已弹（不置已读）；点单条消息由页面跳转并标已读
Component({
  options: {
    pureDataPattern: /^_/
  },

  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    messages: {
      type: Array,
      value: []
    },
    skinId: {
      type: String,
      value: 'classic'
    }
  },

  data: {
    // 组件内不需要额外状态，样式随 skinId property 自动更新
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    onItemTap(e) {
      const index = e.currentTarget.dataset.index;
      this.triggerEvent('itemtap', { index });
    },

    onPreventMove() {
      return;
    }
  }
});
