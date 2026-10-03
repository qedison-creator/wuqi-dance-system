// 公告弹窗组件：会员端首页自动弹出的公告
// 一般弹窗/永久弹窗：点关闭立即关；重要弹窗：读秒 5 秒后才能关闭
const READ_SECONDS = 5;

Component({
  options: {
    pureDataPattern: /^_/
  },

  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    announce: {
      type: Object,
      value: null
    }
  },

  data: {
    locked: false, // 重要弹窗读秒期间锁定关闭
    countdown: 0   // 剩余秒数
  },

  observers: {
    'visible': function (newVal) {
      if (newVal && this.data.announce && this.data.announce.popup_type === 'important') {
        this._startCountdown();
      }
      if (!newVal) {
        this._stopCountdown();
      }
    }
  },

  lifetimes: {
    detached() {
      this._stopCountdown();
    }
  },

  methods: {
    _startCountdown() {
      this._stopCountdown();
      // 按目标时间戳计算剩余秒数：小程序切后台计时挂起、恢复后仍准确
      this._countdownEnd = Date.now() + READ_SECONDS * 1000;
      this.setData({ locked: true, countdown: READ_SECONDS });
      this._countdownTimer = setInterval(() => {
        const left = Math.ceil((this._countdownEnd - Date.now()) / 1000);
        if (left > 0) {
          this.setData({ countdown: left });
        } else {
          this._stopCountdown();
          this.setData({ locked: false, countdown: 0 });
        }
      }, 200);
    },

    _stopCountdown() {
      if (this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
    },

    onClose() {
      if (this.data.locked) return;
      this._stopCountdown();
      this.triggerEvent('close');
    },

    onPreventMove() {
      return;
    }
  }
});
