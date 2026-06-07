Component({
  properties: {
    video: {
      type: Object,
      value: {}
    }
  },
  data: {
    imageErrors: {}
  },
  methods: {
    onVideoTap() {
      this.triggerEvent('videotap', { video: this.data.video });
    },
    onImgError(e) {
      const type = e.currentTarget.dataset.type;
      const id = e.currentTarget.dataset.id;
      if (!type || !id) return;
      this.setData({ ['imageErrors.' + type + '_' + id]: true });
    }
  }
});
