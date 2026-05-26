Component({
  properties: {
    member: {
      type: Object,
      value: {}
    }
  },
  methods: {
    onReview() {
      wx.vibrateShort({ type: 'light' });
      this.triggerEvent('review', { member: this.data.member });
    },
    onReject() {
      wx.vibrateShort({ type: 'light' });
      const detail = { member: this.data.member };
      this.triggerEvent('reject', detail);
    },
    onAddPackage() {
      wx.vibrateShort({ type: 'light' });
      this.triggerEvent('addpackage', { member: this.data.member });
    },
    onViewDetail() {
      wx.vibrateShort({ type: 'light' });
      this.triggerEvent('viewdetail', { member: this.data.member });
    },
    onSendMessage() {
      this.triggerEvent('sendmessage', { member: this.data.member });
    }
  }
});