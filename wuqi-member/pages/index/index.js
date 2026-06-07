const app = getApp();
const { request } = require('../../utils/request');
const config = require('../../config/index.js');
const SERVER_BASE = config.serverBase;
const { getBeijingDate } = require('../../utils/helpers');
const auth = require('../../utils/auth');

function getDanceTagColor(styleName) {
  if (!styleName) return { bg: '#9B89FF', text: '#FFFFFF' };
  if (styleName.indexOf('古典舞') !== -1 || styleName === '古典舞') {
    return { bg: '#F8D57E', text: '#6B5B2E' };
  }
  if (styleName.indexOf('韩舞') !== -1 || styleName === '韩舞') {
    return { bg: '#FF9EC5', text: '#FFFFFF' };
  }
  if (styleName.indexOf('街舞') !== -1 || styleName === '街舞') {
    return { bg: '#FF8A7A', text: '#FFFFFF' };
  }
  if (styleName.indexOf('流行舞') !== -1 || styleName === '流行舞') {
    return { bg: '#A0D4FF', text: '#FFFFFF' };
  }
  var hash = 0;
  for (var i = 0; i < styleName.length; i++) {
    hash = ((hash << 5) - hash) + styleName.charCodeAt(i);
    hash = hash & hash;
  }
  hash = Math.abs(hash);
  var TAG_COLORS = [
    '#9B89FF',
    '#8DD0C9',
    '#D4A6FF',
    '#FFCE8A',
    '#A0D4FF',
    '#B8E5A8',
    '#FFC4D0',
    '#C8C6FF'
  ];
  return { bg: TAG_COLORS[hash % TAG_COLORS.length], text: '#FFFFFF' };
}

Page({
  data: {
    statusBarHeight: 44,
    contentPaddingTop: 400,
    greeting: { text: '晨间好', emoji: '🌤', sub: '今天也要元气满满' },
    bannerCurrent: 0,
    storeList: [],
    currentStore: null,
    banners: [],
    hotCoaches: [],
    recentCourses: [],
    videos: [],
    announces: [],
    hasMultipleAnnounces: false,
    showAnnounceModal: false,
    announceSwiperIndex: 0,
    announceBarIndex: 0,
    announceNextIndex: 1,
    announceAnimPhase: '',
    showStoreModal: false,
    showLocationAuthModal: false,
    loading: true,
    activeHolidays: [],
    imageErrors: {},
    cardOffsetX: 0,
    cardOpacity: 1,
    isDragging: false,
    stackEdgeWidth: 0,
    stackShift: 0,
    returnCardVisible: false,
    returnCardOffsetX: 0,
    _dataLoaded: false,
    _lastStoreId: ''
  },

  onLoad() {
    const statusBarHeight = wx.getWindowInfo().statusBarHeight || 44;
    this.setData({ statusBarHeight });
    this.updateContentPadding();
    this.updateGreeting();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0, active: 'index' });
    }
    this.setData({
      storeList: app.globalData.storeList,
      currentStore: app.globalData.currentStore
    });
    if (!this.data.currentStore && this.data.storeList.length > 0) {
      app.globalData.currentStore = this.data.storeList[0];
      this.setData({ currentStore: this.data.storeList[0] });
    }
    this.updateGreeting();
    this.updateContentPadding();
    // 仅首次加载或切换门店时请求数据，避免从其他页面返回时重复请求
    const currentStoreId = this.data.currentStore ? this.data.currentStore._id : '';
    if (!this.data._dataLoaded || this.data._lastStoreId !== currentStoreId) {
      this.setData({ _dataLoaded: true, _lastStoreId: currentStoreId });
      this.loadHomeData();
    }
    this.checkLocationAuth();
    this.startAnnounceFlip();
  },

  onHide() {
    this.stopAnnounceFlip();
  },

  onUnload() {
    this.stopAnnounceFlip();
  },

  startAnnounceFlip() {
    this.stopAnnounceFlip();
    if (this.data.announces.length <= 1) return;
    this._announceTimer = setInterval(() => {
      const total = this.data.announces.length;
      const nextIdx = (this.data.announceBarIndex + 1) % total;
      // Phase 1: 当前标题向上滑出
      this.setData({ announceAnimPhase: 'out' });
      setTimeout(() => {
        // Phase 2: 切换文本，新标题从下方滑入
        this.setData({
          announceBarIndex: nextIdx,
          announceAnimPhase: 'in'
        });
        setTimeout(() => {
          this.setData({ announceAnimPhase: '' });
        }, 400);
      }, 400);
    }, 2000);
  },

  stopAnnounceFlip() {
    if (this._announceTimer) {
      clearInterval(this._announceTimer);
      this._announceTimer = null;
    }
  },

  updateGreeting() {
    const hour = new Date().getHours();
    let greeting;
    if (hour >= 5 && hour < 9)   greeting = { text: '晨间好', emoji: '🌤', sub: '今天也要元气满满' };
    else if (hour >= 9 && hour < 11)  greeting = { text: '上午好', emoji: '☀️', sub: '舒展身体，准备起舞' };
    else if (hour >= 11 && hour < 14) greeting = { text: '午后好', emoji: '🌞', sub: '午后的舞蹈时光' };
    else if (hour >= 14 && hour < 18) greeting = { text: '下午好', emoji: '🌈', sub: '喝杯茶，再来跳舞' };
    else if (hour >= 18 && hour < 19) greeting = { text: '傍晚好', emoji: '🌅', sub: '下班后的舞动时刻' };
    else if (hour >= 19 && hour < 23) greeting = { text: '晚间好', emoji: '🌙', sub: '夜晚的律动最迷人' };
    else if (hour >= 23)              greeting = { text: '夜深了', emoji: '🌃', sub: '早点睡' };
    else                             greeting = { text: '还没睡呢', emoji: '🌠', sub: '好梦，明天见' };
    this.setData({ greeting });
  },

  updateContentPadding() {
    this.setData({ contentPaddingTop: 400 });
  },

  onBannerChange(e) {
    this.setData({ bannerCurrent: e.detail.current });
  },

  loadHomeData() {
    this.setData({ loading: true });
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';

    request({ url: '/home/banners', data: { store_id: storeId } }).then(res => {
      const banners = Array.isArray(res.data) ? res.data : (res.data && res.data.data) || [];
      this.setData({ banners });
    }).catch((err) => {
      console.error('加载轮播图失败:', err);
    });

    request({ url: '/home/coaches', data: { store_id: storeId, limit: 6 } }).then(res => {
      const data = res.data || {};
      const rawCoaches = Array.isArray(data) ? data : (data.data || data.list || []);
      const coaches = rawCoaches.map(c => ({
        ...c,
        avatar_url: c.avatar_url
          ? (c.avatar_url.startsWith('http') ? c.avatar_url : SERVER_BASE + c.avatar_url)
          : ''
      }));
      this.setData({ hotCoaches: coaches });
    }).catch((err) => {
      console.error('加载热门教练失败:', err);
    });

    request({ url: '/schedules', data: { store_id: storeId, limit: 50 } }).then(res => {
      const data = res.data || {};
      const courses = Array.isArray(data) ? data : (data.data || data.list || []);
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const today = getBeijingDate();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 5);
      const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

      const recentCourses = courses
        .filter(course => {
          if (!course.date) return false;
          const d = typeof course.date === 'string' ? course.date.substring(0, 10) : course.date;
          return d >= todayStr && d <= endStr;
        })
        .slice(0, 10)
        .map(course => {
          let weekday = '';
          if (course.date) {
            const d = getBeijingDate(course.date);
            weekday = weekdays[d.getDay()];
          }
          const danceStyleName = course.dance_style_id && course.dance_style_id.name ? course.dance_style_id.name : '舞蹈';
          const tagColor = getDanceTagColor(danceStyleName);
          return {
            ...course,
            weekday,
            danceStyleName,
            danceTagBg: tagColor.bg,
            danceTagText: tagColor.text
          };
        });

      this.setData({ recentCourses });
    }).catch((err) => {
      console.error('加载近期课程失败:', err);
    });

    request({ url: '/home/videos', data: { limit: 3 } }).then(res => {
      const data = res.data || {};
      const videos = Array.isArray(data) ? data : (data.data || data.list || []);
      this.setData({ videos, loading: false });
    }).catch((err) => {
      console.error('加载视频失败:', err);
      this.setData({ loading: false });
    });

    this.loadAnnounces();
    this.loadHolidays();
  },

  async loadHolidays() {
    try {
      const storeId = this.data.currentStore ? this.data.currentStore._id : '';
      const res = await request({ url: '/holidays', method: 'GET' });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const activeHolidays = list.filter(h => {
        if (h.status !== 'active') return false;
        const hEnd = h.end_date || h.date;
        return h.date <= todayStr && hEnd >= todayStr;
      });
      this.setData({ activeHolidays });
    } catch (err) {
      console.error('加载假期信息失败', err);
    }
  },

  onStoreTap() {
    // 尝试获取位置以显示距离
    const that = this;
    wx.getSetting({
      success(settingRes) {
        if (settingRes.authSetting['scope.userLocation']) {
          wx.getLocation({
            type: 'gcj02',
            altitude: true,
            highAccuracyExpireTime: 10000,
            success(locRes) {
              const { request } = require('../../utils/request');
              request({
                url: `/stores/nearest?latitude=${locRes.latitude}&longitude=${locRes.longitude}`
              }).then(res => {
                if (res.data && res.data.stores) {
                  app.globalData.storeList = res.data.stores;
                  that.setData({
                    storeList: res.data.stores,
                    showStoreModal: true
                  });
                } else {
                  that.setData({ showStoreModal: true });
                }
              }).catch(() => {
                that.setData({ showStoreModal: true });
              });
            },
            fail() {
              that.setData({ showStoreModal: true });
            }
          });
        } else {
          that.setData({ showStoreModal: true });
        }
      },
      fail() {
        that.setData({ showStoreModal: true });
      }
    });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  checkLocationAuth() {
    if (app.globalData.pendingLocationAuth) {
      this.setData({ showLocationAuthModal: true });
    }
  },

  onLocationAuthCancel() {
    this.setData({ showLocationAuthModal: false });
    app.globalData.pendingLocationAuth = false;
  },

  onLocationAuthConfirm() {
    this.setData({ showLocationAuthModal: false });
    app.globalData.pendingLocationAuth = false;
    wx.authorize({
      scope: 'scope.userLocation',
      success: () => {
        app.requestLocationForNearestStore(app.globalData.storeList);
      },
      fail: () => {
        wx.showModal({
          title: '提示',
          content: '您可以在小程序设置中开启位置权限，以便获取最近门店',
          confirmText: '去设置',
          confirmColor: '#D4786E',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          }
        });
      }
    });
  },

  onModalTap() {},

  onSelectStore(e) {
    const { store } = e.currentTarget.dataset;
    if (!store || !store._id) return;
    app.globalData.currentStore = store;
    wx.setStorageSync('currentStore', store);
    this.setData({ currentStore: store, showStoreModal: false });
    this.loadHomeData();
  },

  onStoreCall() {
    const store = this.data.currentStore;
    if (!store || !store.phone) {
      wx.showToast({ title: '暂无门店电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: store.phone,
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '拨号失败', icon: 'none' });
        }
      }
    });
  },

  onCoachTap(e) {
    if (!auth.requireLogin()) return;
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/coach-detail/coach-detail?id=${id}`
    });
  },

  onCourseTap(e) {
    if (!auth.requireLogin()) return;
    auth.requireMember(() => {
      const { id } = e.currentTarget.dataset;
      wx.navigateTo({
        url: `/pages/course-detail/course-detail?id=${id}`
      });
    });
  },

  onVideoTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/video-player/video-player?id=${id}`
    });
  },

  onNavTap() {
    const store = this.data.currentStore;
    if (!store) {
      wx.showToast({ title: '请先选择门店', icon: 'none' });
      return;
    }
    const loc = store.location;
    let lat, lng;
    if (loc && loc.latitude !== undefined && loc.longitude !== undefined) {
      lat = Number(loc.latitude);
      lng = Number(loc.longitude);
    } else if (loc && loc.coordinates && loc.coordinates.length >= 2) {
      lng = Number(loc.coordinates[0]);
      lat = Number(loc.coordinates[1]);
    }
    if (!isNaN(lat) && !isNaN(lng)) {
      wx.openLocation({
        latitude: lat,
        longitude: lng,
        name: store.nav_name || store.name || '',
        address: store.address || '',
        scale: 16
      });
    } else if (store.address) {
      wx.setClipboardData({
        data: store.address,
        success: () => {
          wx.showToast({ title: '地址已复制，请粘贴到地图App中搜索', icon: 'success' });
        }
      });
    } else {
      wx.showToast({ title: '暂无地址信息', icon: 'none' });
    }
  },

  goCoachList() {
    wx.navigateTo({
      url: '/pages/coach-list/coach-list'
    });
  },

  goBooking() {
    if (!auth.requireLogin()) return;
    auth.requireMember(() => {
      wx.switchTab({
        url: '/pages/booking/booking'
      });
    });
  },

  onQuickNav(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    if (!auth.requireLogin()) return;
    wx.navigateTo({ url });
  },

  onPullDownRefresh() {
    this.setData({ _dataLoaded: false });
    this.loadHomeData();
    wx.stopPullDownRefresh();
  },

  async loadAnnounces() {
    try {
      const storeId = this.data.currentStore ? this.data.currentStore._id : '';
      const res = await request({ url: `/announces?store_id=${storeId}`, method: 'GET' });
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const announces = list.map(a => ({
        ...a,
        createdAtDisplay: a.created_at ? new Date(a.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }) : ''
      }));
      const hasMultipleAnnounces = announces.length > 1;
      this.setData({
        announces,
        hasMultipleAnnounces,
        announceBarIndex: 0,
        announceNextIndex: hasMultipleAnnounces ? 1 : 0,
        announceAnimPhase: ''
      });
      this.updateStackLayout();
      // 公告数据加载后启动翻页定时器
      this.startAnnounceFlip();
    } catch (err) {
      console.error('加载公告信息失败', err);
    }
  },

  onAnnounceTap() {
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.setData({ showAnnounceModal: true, announceSwiperIndex: 0 });
    this.updateStackLayout();
  },

  onCloseAnnounceModal() {
    this.setData({ showAnnounceModal: false });
  },

  onPreventMove() {
    return;
  },

  onAnnounceSwiperChange(e) {
    this.setData({ announceSwiperIndex: e.detail.current });
  },

  onAnnounceDotTap(e) {
    this.setData({ announceSwiperIndex: Number(e.currentTarget.dataset.index) });
  },

  onAnnouncePrev() {
    if (this.data.announceSwiperIndex > 0) {
      this.setData({ announceSwiperIndex: this.data.announceSwiperIndex - 1 });
    }
  },

  onAnnounceNext() {
    if (this.data.announceSwiperIndex < this.data.announces.length - 1) {
      this.setData({ announceSwiperIndex: this.data.announceSwiperIndex + 1 });
    }
  },

  updateStackLayout() {
    const total = this.data.announces.length;
    const totalEdgeArea = 50;
    if (total > 1) {
      this.setData({
        stackEdgeWidth: totalEdgeArea / (total - 1),
        stackShift: -totalEdgeArea / 2
      });
    } else {
      this.setData({ stackEdgeWidth: 0, stackShift: 0 });
    }
  },

  onCardTouchStart(e) {
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._swipeDirection = null;
    this.setData({ isDragging: true });
  },

  onCardTouchMove(e) {
    const deltaX = e.touches[0].clientX - this._touchStartX;
    const deltaY = e.touches[0].clientY - this._touchStartY;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

    // 首次判定方向
    if (!this._swipeDirection && Math.abs(deltaX) > 10) {
      this._swipeDirection = deltaX > 0 ? 'right' : 'left';
      // 右滑且不是第一张：显示回滑卡片
      if (this._swipeDirection === 'right' && this.data.announceSwiperIndex > 0) {
        this.setData({ returnCardVisible: true, returnCardOffsetX: -600 });
      }
    }

    if (this._swipeDirection === 'left') {
      // 左滑：当前卡片向左滑出，变透明
      if (this.data.announceSwiperIndex === this.data.announces.length - 1) return;
      const dist = Math.abs(deltaX);
      let opacity = 1;
      if (dist > 100) {
        opacity = Math.max(0.1, 1 - (dist - 100) / 200);
      }
      this.setData({ cardOffsetX: deltaX, cardOpacity: opacity });
    } else if (this._swipeDirection === 'right') {
      // 右滑：上一张卡片从左侧滑入覆盖，当前卡片不动
      if (this.data.announceSwiperIndex === 0) return;
      const offset = -600 + deltaX;
      const clampedOffset = Math.min(0, Math.max(-600, offset));
      this.setData({ returnCardOffsetX: clampedOffset });
    }
  },

  onCardTouchEnd(e) {
    const deltaX = e.changedTouches[0].clientX - this._touchStartX;
    const threshold = 80;

    if (this._swipeDirection === 'left') {
      // 左滑结束
      if (this.data.announceSwiperIndex === this.data.announces.length - 1) {
        this.setData({ isDragging: false, cardOffsetX: 0, cardOpacity: 1 });
        this._swipeDirection = null;
        return;
      }
      if (Math.abs(deltaX) > threshold) {
        // 卡片滑出：先动画滑出
        this.setData({ isDragging: false, cardOffsetX: -600, cardOpacity: 0 });
        setTimeout(() => {
          // 合并所有状态变更到一次setData，避免中间渲染导致抖动
          this.setData({
            announceSwiperIndex: this.data.announceSwiperIndex + 1,
            cardOffsetX: 0,
            cardOpacity: 1,
            isDragging: true
          });
          setTimeout(() => { this.setData({ isDragging: false }); }, 30);
        }, 300);
      } else {
        // 回弹
        this.setData({ isDragging: false, cardOffsetX: 0, cardOpacity: 1 });
      }
    } else if (this._swipeDirection === 'right') {
      // 右滑结束
      if (this.data.announceSwiperIndex === 0) {
        this.setData({ isDragging: false, returnCardVisible: false });
        this._swipeDirection = null;
        return;
      }
      if (deltaX > threshold) {
        // 回滑完成：动画到0位置
        this.setData({ isDragging: false, returnCardOffsetX: 0 });
        setTimeout(() => {
          // 合并所有状态变更到一次setData，避免中间渲染导致抖动
          this.setData({
            announceSwiperIndex: this.data.announceSwiperIndex - 1,
            returnCardVisible: false,
            returnCardOffsetX: -600
          });
        }, 300);
      } else {
        // 回弹：动画回-600
        this.setData({ isDragging: false, returnCardOffsetX: -600 });
        setTimeout(() => {
          this.setData({ returnCardVisible: false });
        }, 300);
      }
    } else {
      // 没有明确方向
      this.setData({ isDragging: false, cardOffsetX: 0, cardOpacity: 1 });
    }
    this._swipeDirection = null;
  },

  onProgressTap(e) {
    // 保留但不再在wxml中使用
    const index = Number(e.currentTarget.dataset.index);
    if (index !== this.data.announceSwiperIndex) {
      this.setData({ announceSwiperIndex: index });
    }
  },

  onShareAppMessage() {
    const store = this.data.currentStore;
    const storeName = store ? store.name : '';
    return {
      title: storeName ? `舞栖舞蹈社 - ${storeName}` : '舞栖舞蹈社 - 专业舞蹈培训',
      path: '/pages/index/index',
      imageUrl: ''
    };
  },

  onShareTimeline() {
    const store = this.data.currentStore;
    const storeName = store ? store.name : '';
    return {
      title: storeName ? `舞栖舞蹈社 - ${storeName}` : '舞栖舞蹈社 - 专业舞蹈培训',
      query: ''
    };
  },

  onImgError(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    if (!type || !id) return;
    this.setData({ ['imageErrors.' + type + '_' + id]: true });
  }
});