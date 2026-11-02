// 自定义 TabBar：随皮肤切换配色（classic 原样 / paper / volt）
// volt 皮肤「原生动画生长」动效（wx.createAnimation）：
// - 胶囊永远静态停在自己 tab（无过渡，首帧即正确），不做跨页滑动
// - 不用 CSS @keyframes：CSS 动画从「样式生效」开始计时，隐藏页会提前跑完，
//   第二次起就被吞掉。改用 wx.createAnimation，每次切换新建一份动画数据，
//   由数据变更触发播放，第几次切换都必然从起点完整播放
// - 切页前把目标页胶囊摆成缩小起点（瞬时、无动画），页面显示时才播放生长，
//   首个可见帧不是满尺寸旧胶囊，不会回缩
const skin = require('../utils/skin.js');

const TAB_INDEX = { index: 0, booking: 1, profile: 2 };
const TAB_ROUTES = ['pages/index/index', 'pages/booking/booking', 'pages/profile/profile'];

Component({
  data: {
    selected: 0,
    active: 'index',
    skinId: 'classic',
    pillIndex: 0, // 胶囊停靠位（恒等于 active 对应序号，瞬时切换无过渡）
    pillDir: '',  // 生长锚点：'left' 从左边缘向右展开 / 'right' 从右边缘向左展开
    pillAnim: null // 原生动画数据（wx.createAnimation().export()）
  },

  pageLifetimes: {
    show() {
      // 仅兜底同步皮肤；动效由 onTabTap 卸载 + syncTab 挂载驱动
      this.syncSkin();
    }
  },

  lifetimes: {
    attached() {
      // 首帧绘制前：确定选中态并把胶囊摆到自己 tab（静态落位）
      this.initFromRoute();
      const app = getApp();
      const idx = TAB_INDEX[this.data.active] != null ? TAB_INDEX[this.data.active] : 0;
      const pending = app.globalData.tabBarPending;
      const patch = { pillIndex: idx };
      if (pending && pending.idx === idx && pending.from !== idx) {
        // 本页是切换目标且此前未创建：首帧即摆成缩小的生长起点（瞬时、无动画），
        // onShow 时再播放生长，不会先闪出满尺寸胶囊
        patch.pillDir = idx > pending.from ? 'dir-left' : 'dir-right';
        patch.pillAnim = this.smallPillAnim();
      } else {
        patch.pillDir = '';
        patch.pillAnim = this.staticPillAnim();
        // 全局首个实例（冷启动）初始化全局位置，避免冷启动误播动效
        if (typeof app.globalData.tabBarPillIndex !== 'number') {
          app.globalData.tabBarPillIndex = idx;
        }
      }
      this.setData(patch);
      this.syncSkin();
    }
  },

  methods: {
    initFromRoute() {
      try {
        const pages = getCurrentPages();
        const route = pages.length ? (pages[pages.length - 1].route || '') : '';
        const map = {
          'pages/index/index': { selected: 0, active: 'index' },
          'pages/booking/booking': { selected: 1, active: 'booking' },
          'pages/profile/profile': { selected: 2, active: 'profile' }
        };
        const init = map[route];
        if (init && (init.active !== this.data.active || init.selected !== this.data.selected)) {
          this.setData(init);
        }
      } catch (e) {
        // 兜底：维持默认值，页面 onShow 仍会纠正
      }
    },

    // 页面 onShow 显式调用：此刻页面已可见，在这里写入动画数据。
    // 每次都是新建的一份动画数据，播放由数据变更触发，与 CSS 动画时钟无关，
    // 所以第几次切换都从缩小的起点完整播放
    syncTab(selected, name, skinId) {
      const app = getApp();
      const idx = TAB_INDEX[name] != null ? TAB_INDEX[name] : 0;
      const pending = app.globalData.tabBarPending;
      const from = pending && pending.idx === idx ? pending.from : null;
      const patch = { selected, active: name, pillIndex: idx };
      if (this._growTimer) { clearTimeout(this._growTimer); this._growTimer = null; }
      if (from !== null && from !== idx) {
        patch.pillDir = idx > from ? 'dir-left' : 'dir-right';
        patch.pillAnim = this.growPillAnim();
        // 保底：动画结束后把胶囊钉在满尺寸。动画正常时这是无操作（已在 100%）；
        // 动画若被系统吞掉，这里兜底回正中，胶囊绝不会停留在缩小态（歪）
        this._growTimer = setTimeout(() => {
          this._growTimer = null;
          this.setData({ pillAnim: this.staticPillAnim() });
        }, 500);
      } else {
        // 非 onTabTap 触发的显示（冷启动 / 从二级页返回）：直接落到满尺寸，不播动画
        patch.pillDir = '';
        patch.pillAnim = this.staticPillAnim();
      }
      if (pending && pending.idx === idx) app.globalData.tabBarPending = null;
      app.globalData.tabBarPillIndex = idx;
      if (skinId && skinId !== this.data.skinId) patch.skinId = skinId;
      this.setData(patch);
    },

    // 起点态：横向缩到 72%，瞬时生效、无动画（预置到隐藏页作为静态起点）
    smallPillAnim() {
      const ani = wx.createAnimation({ duration: 0, timingFunction: 'linear' });
      ani.scaleX(0.72).step();
      return ani.export();
    },

    // 静止态：满尺寸，瞬时生效
    staticPillAnim() {
      const ani = wx.createAnimation({ duration: 0, timingFunction: 'linear' });
      ani.scaleX(1).step();
      return ani.export();
    },

    // 入场生长：从预置的 72% 起点长到 100%，360ms 缓出。
    // 关键：export 里只放一个 step——多 step 动画数据在真机上实测只应用
    // 第一个动作，胶囊会停在缩小态（上一版按钮歪的根因）
    growPillAnim() {
      const ani = wx.createAnimation({ duration: 360, timingFunction: 'ease-out' });
      ani.scaleX(1).step();
      return ani.export();
    },

    syncSkin() {
      const id = skin.getSkinId();
      if (id !== this.data.skinId) {
        this.setData({ skinId: id });
      }
    },

    switchTab(e) {
      wx.switchTab({ url: e.currentTarget.dataset.path });
    },

    onTabTap(e) {
      const d = e.currentTarget.dataset;
      const idx = Number(d.index);
      const app = getApp();
      const from = app.globalData.tabBarPillIndex;
      if (d.index != null && idx !== from) {
        // 记录本次切换的来源与目标；并把目标页胶囊先摆成缩小的起点（瞬时）
        app.globalData.tabBarPending = { idx, from };
        this.primeTarget(idx, from);
      } else {
        app.globalData.tabBarPending = null;
      }
      wx.switchTab({ url: d.path });
    },

    // 预置起点：找到目标页的 tabBar 实例（该页此前访问过、实例已存在），
    // 在其仍隐藏时把胶囊摆到目标位并缩成起点（瞬时、无动画）。
    // 这样页面显示的首个可见帧就是「起点胶囊」，onShow 播放生长时不存在回缩。
    // 实例不存在（首次访问）时不处理：该页 attached 会按 pending 做同样的事
    primeTarget(idx, from) {
      const route = TAB_ROUTES[idx];
      const dir = idx > from ? 'dir-left' : 'dir-right';
      const anim = this.smallPillAnim();
      const pages = getCurrentPages() || [];
      pages.forEach(p => {
        try {
          if (!p || p.route !== route || typeof p.getTabBar !== 'function') return;
          const tb = p.getTabBar();
          if (!tb || tb === this) return;
          // 清掉目标实例上可能的旧保底定时器，防止它在预置后把起点态改回满尺寸
          if (tb._growTimer) { clearTimeout(tb._growTimer); tb._growTimer = null; }
          tb.setData({ pillIndex: idx, pillDir: dir, pillAnim: anim });
        } catch (e2) {
          // 忽略：由 attached / onShow 兜底
        }
      });
    }
  }
});
