/**
 * iPhone 风格时间选择器组件
 * 用法：
 * <time-picker visible="{{visible}}" value="{{time}}" title="选择时间" bind:confirm="onConfirm" bind:cancel="onCancel" />
 * confirm 事件返回 { value: "HH:mm" }
 */
Component({
  properties: {
    visible: { type: Boolean, value: false },
    value: { type: String, value: '' }, // HH:mm
    title: { type: String, value: '选择时间' }
  },

  data: {
    hours: [],
    minutes: [],
    pickerValue: [0, 0],
    currentHour: 0,
    currentMinute: 0
  },

  observers: {
    'visible': function (visible) {
      if (visible) {
        this.initPicker();
      }
    }
  },

  lifetimes: {
    attached() {
      this.buildHours();
      this.buildMinutes();
    }
  },

  methods: {
    noop() {},

    buildHours() {
      const hours = [];
      for (let h = 0; h <= 23; h++) {
        hours.push(String(h).padStart(2, '0'));
      }
      this.setData({ hours });
    },

    buildMinutes() {
      const minutes = [];
      for (let m = 0; m <= 59; m++) {
        minutes.push(String(m).padStart(2, '0'));
      }
      this.setData({ minutes });
    },

    initPicker() {
      let hour = this.data.currentHour;
      let minute = this.data.currentMinute;

      // 解析传入的 value
      if (this.properties.value && /^\d{2}:\d{2}$/.test(this.properties.value)) {
        const parts = this.properties.value.split(':');
        hour = Number(parts[0]) || 0;
        minute = Number(parts[1]) || 0;
      } else {
        // 默认当前北京时间
        const now = new Date();
        hour = now.getHours();
        minute = now.getMinutes();
      }

      this.setData({
        currentHour: hour,
        currentMinute: minute,
        pickerValue: [hour, minute]
      });
    },

    onPickerChange(e) {
      const val = e.detail.value;
      const hour = val[0] || 0;
      const minute = val[1] || 0;

      this.setData({
        currentHour: hour,
        currentMinute: minute
      });
    },

    onCancel() {
      this.triggerEvent('cancel');
    },

    onMaskTap() {
      this.triggerEvent('cancel');
    },

    onConfirm() {
      const { currentHour, currentMinute } = this.data;
      const hour = String(currentHour).padStart(2, '0');
      const minute = String(currentMinute).padStart(2, '0');
      const timeStr = `${hour}:${minute}`;
      this.triggerEvent('confirm', { value: timeStr });
    }
  }
});
