Component({
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
