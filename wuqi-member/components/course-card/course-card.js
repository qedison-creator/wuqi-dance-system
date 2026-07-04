Component({
  options: {
    pureDataPattern: /^_/
  },

  properties: {
    course: {
      type: Object,
      value: {}
    }
  },
  data: {
    imageErrors: {}
  },
  methods: {
    onBookTap() {
      this.triggerEvent('book', { course: this.data.course });
    },
    onCourseTap() {
      this.triggerEvent('coursetap', { course: this.data.course });
    },
    onImgError(e) {
      const type = e.currentTarget.dataset.type;
      const id = e.currentTarget.dataset.id;
      if (!type || !id) return;
      this.setData({ ['imageErrors.' + type + '_' + id]: true });
    }
  }
});
