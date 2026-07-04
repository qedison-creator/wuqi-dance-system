/**
 * iPhone 风格日期选择器组件
 * 用法：
 * <date-picker visible="{{visible}}" value="{{date}}" bind:confirm="onConfirm" bind:cancel="onCancel" />
 */
Component({
  options: {
    pureDataPattern: /^_/
  },
  properties: {
    visible: { type: Boolean, value: false },
    value: { type: String, value: '' }, // YYYY-MM-DD
    title: { type: String, value: '选择日期' },
    minYear: { type: Number, value: 2020 },
    maxYear: { type: Number, value: 2099 }
  },

  data: {
    years: [],
    months: [],
    days: [],
    pickerValue: [0, 0, 0],
    currentYear: 2026,
    currentMonth: 1,
    currentDay: 1
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
      this.buildYears();
      this.buildMonths();
      this.buildDays(this.data.currentYear, this.data.currentMonth);
    }
  },

  methods: {
    noop() {},

    buildYears() {
      const years = [];
      for (let y = this.properties.minYear; y <= this.properties.maxYear; y++) {
        years.push(y);
      }
      this.setData({ years });
    },

    buildMonths() {
      const months = [];
      for (let m = 1; m <= 12; m++) {
        months.push(m);
      }
      this.setData({ months });
    },

    buildDays(year, month) {
      const dayCount = new Date(year, month, 0).getDate();
      const days = [];
      for (let d = 1; d <= dayCount; d++) {
        days.push(d);
      }
      this.setData({ days });
    },

    initPicker() {
      let year = this.data.currentYear;
      let month = this.data.currentMonth;
      let day = this.data.currentDay;

      // 解析传入的 value
      if (this.properties.value) {
        const parts = String(this.properties.value).split('-');
        if (parts.length === 3) {
          year = Number(parts[0]) || year;
          month = Number(parts[1]) || month;
          day = Number(parts[2]) || day;
        }
      } else {
        // 默认今天
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
        day = now.getDate();
      }

      this.buildDays(year, month);

      const yearIdx = Math.max(0, this.data.years.indexOf(year));
      const monthIdx = month - 1;
      const dayIdx = day - 1;

      this.setData({
        currentYear: year,
        currentMonth: month,
        currentDay: day,
        pickerValue: [yearIdx, monthIdx, dayIdx]
      });
    },

    onPickerChange(e) {
      const val = e.detail.value;
      const yearIdx = val[0];
      const monthIdx = val[1];
      const dayIdx = val[2];

      const year = this.data.years[yearIdx] || this.data.currentYear;
      const month = this.data.months[monthIdx] || this.data.currentMonth;

      // 月份变化时重建天数
      if (month !== this.data.currentMonth || year !== this.data.currentYear) {
        this.buildDays(year, month);
      }

      const days = this.data.days;
      let day = days[dayIdx] || 1;
      // 如果当前日大于新月份的天数，取最后一天
      if (dayIdx >= days.length) {
        day = days[days.length - 1];
      }

      this.setData({
        currentYear: year,
        currentMonth: month,
        currentDay: day
      });
    },

    onCancel() {
      this.triggerEvent('cancel');
    },

    onMaskTap() {
      this.triggerEvent('cancel');
    },

    onConfirm() {
      const { currentYear, currentMonth, currentDay } = this.data;
      const month = String(currentMonth).padStart(2, '0');
      const day = String(currentDay).padStart(2, '0');
      const dateStr = `${currentYear}-${month}-${day}`;
      this.triggerEvent('confirm', { value: dateStr });
    }
  }
});
