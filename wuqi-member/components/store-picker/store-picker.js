Component({
  options: {
    pureDataPattern: /^_/
  },

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
      const { index } = e.currentTarget.dataset;
      const store = this.data.storeList[index];
      this.triggerEvent('change', { store });
      this.setData({ showPicker: false });
    },
    onMaskTap() {
      this.setData({ showPicker: false });
    },
    onModalTap() {}
  }
});
