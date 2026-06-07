Component({
  properties: {
    coach: {
      type: Object,
      value: {}
    }
  },
  data: {
    imageErrors: {}
  },
  methods: {
    onCoachTap() {
      this.triggerEvent('coachtap', { coach: this.data.coach });
    },
    onImgError(e) {
      const type = e.currentTarget.dataset.type;
      const id = e.currentTarget.dataset.id;
      if (!type || !id) return;
      this.setData({ ['imageErrors.' + type + '_' + id]: true });
    }
  }
});
