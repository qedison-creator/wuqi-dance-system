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
    },
    // 当前皮肤（页面响应式传入）：组件常驻首页，若仅靠 attached 读 storage，
    // 切换皮肤后不会重新 attached，弹窗会一直用切换前的皮肤样式（颜色对调观感）
    skinId: {
      type: String,
      value: 'classic'
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
    // 注意：skinId 为 property，值变化会自动同步到 this.data 并驱动视图更新；
    // 切勿在 observer 中对同名字段 setData（会触发 observer 无限循环导致页面白屏死机）
  },

  lifetimes: {
    attached() {
      // 兜底：页面未传 skinId 时自行读取本地偏好
      const current = this.data.skinId;
      if (current !== 'paper' && current !== 'volt' && current !== 'classic') {
        try {
          const skinId = wx.getStorageSync('member_skin_id');
          this.setData({ skinId: skinId === 'paper' || skinId === 'volt' ? skinId : 'classic' });
        } catch (e) { /* 忽略 */ }
      }
    },
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
