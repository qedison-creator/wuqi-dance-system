Component({
  properties: {
    course: {
      type: Object,
      value: {}
    }
  },
  methods: {
    onViewBookings() {
      this.triggerEvent('viewbookings', { course: this.data.course });
    },
    onMarkAttendance() {
      this.triggerEvent('markattendance', { course: this.data.course });
    },
    onCancelCourse() {
      this.triggerEvent('cancelcourse', { course: this.data.course });
    },
    onEditCourse() {
      this.triggerEvent('editcourse', { course: this.data.course });
    }
  }
});