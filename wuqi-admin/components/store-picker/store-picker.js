Component({
  properties: {
    storeList: {
      type: Array,
      value: []
    },
    currentStore: {
      type: Object,
      value: null
    }
  },
  data: {
    showPicker: false
  },
  methods: {
    onStoreTap() {
      this.setData({ showPicker: true });
    },
    onClose() {
      this.setData({ showPicker: false });
    },
    onSelectStore(e) {
      const { store } = e.currentTarget.dataset;
      // store 为空字符串表示"全部门店"
      this.triggerEvent('change', { store: store || null });
      this.setData({ showPicker: false });
    },
    onMaskTap() {
      this.setData({ showPicker: false });
    },
    onModalTap() {}
  }
});
