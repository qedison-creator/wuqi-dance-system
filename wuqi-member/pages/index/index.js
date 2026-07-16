const app = getApp();
const { request } = require('../../utils/request');
const config = require('../../config/index.js');
const SERVER_BASE = config.serverBase;
const { getBeijingDate } = require('../../utils/helpers');
const { normalizeImageUrl } = require('../../utils/util');
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
    images: [],
    imageUrls: [],
    announces: [],
    hasMultipleAnnounces: false,
    showAnnounceModal: false,
    announceSwiperIndex: 0,
    announceBarIndex: 0,
    announceNextIndex: 1,
    announceAnimPhase: '',
    showStoreModal: false,
    showLoginModal: false,
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
    _lastStoreId: '',
    isOfficial: false
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
    // 更新正式会员状态（控制课程时间等敏感信息显示）
    const userInfo = app.globalData.userInfo || {};
    this.setData({
      isOfficial: userInfo.member_status === 'official',
      storeList: app.globalData.storeList,
      currentStore: app.globalData.currentStore
    });
    if (!this.data.currentStore && this.data.storeList.length > 0) {
      app.globalData.currentStore = this.data.storeList[0];
      this.setData({ currentStore: this.data.storeList[0] });
    }
    this.updateGreeting();
    this.updateContentPadding();
    const currentStoreId = this.data.currentStore ? this.data.currentStore._id : '';
    // 检测登录状态变化（登录/退出登录/切换账号），变化时强制刷新首页数据
    const loginStateToken = app.globalData.loginStateToken || 0;
    const loginStateChanged = this._lastLoginStateToken !== loginStateToken;
    if (loginStateChanged) {
      this._lastLoginStateToken = loginStateToken;
    }
    // 从其他 tab 切回时，若课程数据为空则重新加载（修复游客切换 tab 后卡片消失）

    if (this.data._dataLoaded && this.data._lastStoreId === currentStoreId && (!this.data.recentCourses || this.data.recentCourses.length === 0)) {
      this.setData({ _lastStoreId: currentStoreId });
      this.loadHomeData();
      this.startAnnounceFlip();
      // 已授权用户：静默重新定位匹配最近门店（每次进入首页都获取最新位置）
      this.checkPendingRelocate();
      return;
    }
    // 仅首次加载、切换门店或登录状态变化时请求数据，避免从其他页面返回时重复请求

    if (!this.data._dataLoaded || this.data._lastStoreId !== currentStoreId || loginStateChanged) {
      this.setData({ _dataLoaded: true, _lastStoreId: currentStoreId });
      this.loadHomeData();
    }
    this.checkLocationAuth();
    this.startAnnounceFlip();
  },

  onHide() {
    this.stopAnnounceFlip();
  },

  onReady() {
    this._onReadyFired = true;
    // 页面首帧渲染完成后，再加载非首屏的画廊数据
    if (this.data._dataLoaded) {
      this.loadGalleryImages();
    }
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
    }, 3000);
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
    if (hour >= 5 && hour < 9)   greeting = { text: '晨间好', emoji: '🌤️', sub: '今天也要元气满满' };
    else if (hour >= 9 && hour < 11)  greeting = { text: '上午好', emoji: '☀️', sub: '舒展身体，准备起舞' };
    else if (hour >= 11 && hour < 14) greeting = { text: '午后好', emoji: '🌞', sub: '午后的舞蹈时光' };
    else if (hour >= 14 && hour < 18) greeting = { text: '下午好', emoji: '🌈', sub: '喝杯茶，再来跳舞' };
    else if (hour >= 18 && hour < 19) greeting = { text: '傍晚好', emoji: '🌅', sub: '下班后的舞动时刻' };
    else if (hour >= 19 && hour < 23) greeting = { text: '晚间好', emoji: '🌙', sub: '夜晚的律动最迷人' };
    else if (hour >= 23)              greeting = { text: '夜深了', emoji: '🌃', sub: '早点休息' };
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
    // 已有数据时静默刷新，不再显示加载动画（避免切 tab 回来一闪而过的 loading）
    const hasExistingData = (this.data.banners && this.data.banners.length > 0) ||
                            (this.data.hotCoaches && this.data.hotCoaches.length > 0) ||
                            (this.data.recentCourses && this.data.recentCourses.length > 0);
    if (!hasExistingData) {
      this.setData({ loading: true });
    }
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const today = getBeijingDate();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 5);
    const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    // 错峰加载：公告和假期延迟 300ms，避免与 Promise.all 中首页核心数据并发
    setTimeout(() => {
      this.loadAnnounces();
      this.loadHolidays();
    }, 300);

    // 并行加载首页核心数据（silent: 冷启动失败不弹 toast，避免游客被"网络连接失败"打扰；loading 动画仍由页面控制）
    return Promise.all([
      request({ url: '/home/banners', data: { store_id: storeId }, silent: true }),
      request({ url: '/home/coaches', data: { store_id: storeId, limit: 6 }, silent: true }),
      request({ url: '/schedules', data: { store_id: storeId, limit: 10 }, silent: true })
    ]).then(([bannerRes, coachRes, scheduleRes]) => {
      // 处理轮播图/ 教练头像 / 课程封面 / 视频封面：统一使用 SERVER_BASE
      // 注意：服务器返回的 URL 可能是 http 或完整 https 地址，这里统一规范化为 /uploads/xxx 格式
      // 当图片加载失败时，binderror 会触发 fallback 到本地默认图

      const banners = (Array.isArray(bannerRes.data) ? bannerRes.data : (bannerRes.data && bannerRes.data.data) || [])
        .map(b => ({ ...b, image_url: normalizeImageUrl(b.image_url, SERVER_BASE) }));

      // 处理热门教练

      const coachData = coachRes.data || {};
      const rawCoaches = Array.isArray(coachData) ? coachData : (coachData.data || coachData.list || []);
      const coaches = rawCoaches.map(c => ({
        ...c,
        avatar_url: normalizeImageUrl(c.avatar_url, SERVER_BASE) || ''
      }));

      // 处理近期课程（同时处理 cover 字段， 已取消下架的不展示

      const scheduleData = scheduleRes.data || {};
      const courses = Array.isArray(scheduleData) ? scheduleData : (scheduleData.data || scheduleData.list || []);
      const recentCourses = courses
        .filter(course => {
          if (!course.date) return false;
          if (course.status === 'cancelled' || course.status === 'offline') return false;
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
            danceTagText: tagColor.text,
            cover: normalizeImageUrl(course.cover, SERVER_BASE) || '',
            timeDisplay: this.data.isOfficial
              ? `${course.start_time || ''} - ${course.end_time || ''}`
              : '??:?? - ??:??'
          };
        });

      // 先渲染首屏核心数据，画廊数据在 onReady 中延迟加载，降低首屏 LCP
      this.setData({ banners, hotCoaches: coaches, recentCourses, loading: false }, () => {
        // 核心数据渲染完成后，异步加载画廊（如 onReady 尚未触发，由 onReady 负责调度）
        if (this._onReadyFired) {
          this.loadGalleryImages();
        }
        // 首屏数据返回后再静默重新定位，避免与核心请求竞争网络/系统资源
        this.checkPendingRelocate();
      });

    }).catch((err) => {
      console.error('加载首页数据失败:', err);
      this.setData({ loading: false });
    });
  },

  async loadHolidays() {
    try {
      const storeId = this.data.currentStore ? this.data.currentStore._id : '';
      const res = await request({ url: '/holidays', method: 'GET', silent: true });
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

  // 画廊图片非首屏核心数据，延迟到 onReady 后加载，避免阻塞首屏渲染
  async loadGalleryImages() {
    if (this._galleryLoading || this._galleryLoaded) return;
    this._galleryLoading = true;
    try {
      const res = await request({ url: '/home/images', silent: true });
      const rawImages = res.data || [];
      const imageList = Array.isArray(rawImages) ? rawImages : (rawImages.data || rawImages.list || []);
      const images = imageList.map(img => {
        const width = Number(img.width) || 0;
        const height = Number(img.height) || 0;
        let orientation = 'square';
        let ratio = 1;
        if (width > 0 && height > 0) {
          ratio = width / height;
          if (ratio > 1.1) orientation = 'landscape';
          else if (ratio < 0.9) orientation = 'portrait';
          else orientation = 'square';
        }
        return {
          ...img,
          image_url: normalizeImageUrl(img.image_url, SERVER_BASE),
          thumbnail_url: normalizeImageUrl(img.thumbnail_url, SERVER_BASE),
          orientation,
          ratio,
          coachName: img.coach_ids && img.coach_ids.length > 0 ? img.coach_ids[0].name : ''
        };
      });
      const imageUrls = images.map(img => img.image_url);
      this.setData({ images, imageUrls });
      this._galleryLoaded = true;
    } catch (err) {
      console.error('加载画廊数据失败', err);
    } finally {
      this._galleryLoading = false;
    }
  },

  onStoreTap() {
    const that = this;
    // 先检查 scope.userFuzzyLocation 授权状态

    wx.getSetting({
      success(settingRes) {
        if (settingRes.authSetting['scope.userFuzzyLocation'] === false) {
          // 用户之前拒绝过，引导去设置页开启

          wx.showModal({
            title: '需要位置权限',
            content: '用于为您匹配最近的门店，请在设置中开启位置信息',
            confirmText: '去设置',
            confirmColor: '#D4956B',
            success(modalRes) {
              if (modalRes.confirm) {
                wx.openSetting({
                  success(openRes) {
                    if (openRes.authSetting['scope.userFuzzyLocation']) {
                      that._getFuzzyLocationAndShowStores();
                    } else {
                      that.setData({ showStoreModal: true });
                    }
                  },
                  fail() {
                    that.setData({ showStoreModal: true });
                  }
                });
              } else {
                that.setData({ showStoreModal: true });
              }
            }
          });
        } else {
          // 未拒绝过，直接调用
          that._getFuzzyLocationAndShowStores();
        }
      },
      fail() {
        // 获取设置失败，直接调用
        that._getFuzzyLocationAndShowStores();
      }
    });
  },

  _getFuzzyLocationAndShowStores() {
    const that = this;
    wx.getFuzzyLocation({
      type: 'gcj02',
      success(res) {
        // 缓存用户坐标，下次启动自动匹配最近门店
        wx.setStorageSync('userCoords', {
          latitude: res.latitude,
          longitude: res.longitude
        });
        // 计算各门店距离
        const storesWithDist = app.calcStoresWithDist(res.latitude, res.longitude, that.data.storeList);
        // 按距离从近到远排序（无距离的门店排在后面）
        const sortedStores = storesWithDist.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
        app.globalData.storeList = sortedStores;
        that.setData({
          storeList: sortedStores,
          showStoreModal: true
        });
      },
      fail() {
        // 获取位置失败，直接显示门店列表（无距离信息）
        that.setData({ showStoreModal: true });
      }
    });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  onLoginModalClose() {
    this.setData({ showLoginModal: false });
  },

  onLoginSuccess() {
    // 登录/认领成功后，globalData.currentStore 已按会员门店重新匹配
    // 先同步到页面数据，再加载首页数据
    const userInfo = app.globalData.userInfo || {};
    this.setData({
      showLoginModal: false,
      isOfficial: userInfo.member_status === 'official',
      currentStore: app.globalData.currentStore
    });
    // 同步登录状态令牌，避免下次 onShow 因令牌变化重复刷新
    this._lastLoginStateToken = app.globalData.loginStateToken || 0;
    // 登录成功后刷新页面数据
    this.loadHomeData();
  },

  checkLocationAuth() {
    if (app.globalData.pendingLocationAuth) {
      this.setData({ showLocationAuthModal: true });
    }
  },

  // 已授权用户：静默重新定位匹配最近门店（无弹窗，每次进入首页获取最新位置）
  // 但用户手动选择门店后，本次运行期间不再自动匹配
  checkPendingRelocate() {
    if (app.globalData.userManuallySelectedStore) return;
    if (!app.globalData.pendingRelocate) return;
    app.globalData.pendingRelocate = false;
    const that = this;
    wx.getFuzzyLocation({
      type: 'gcj02',
      success(res) {
        wx.setStorageSync('userCoords', {
          latitude: res.latitude,
          longitude: res.longitude
        });
        // 匹配最近门店（优先使用候选门店列表，如套餐会员的套餐门店）
        const candidates = app.globalData.storeMatchCandidates || app.globalData.storeList;
        const nearest = app._findNearestStoreByCoords(res.latitude, res.longitude, candidates);
        if (nearest && (!app.globalData.currentStore || app.globalData.currentStore._id !== nearest._id)) {
          app.globalData.currentStore = nearest;
          wx.setStorageSync('currentStore', nearest);
          that.setData({ currentStore: nearest });
          that.loadHomeData();
        }
      },
      fail() {
        // 静默失败，保持当前门店
      }
    });
  },

  onLocationAuthCancel() {
    this.setData({ showLocationAuthModal: false });
    app.globalData.pendingLocationAuth = false;
  },

  onLocationAuthConfirm() {
    this.setData({ showLocationAuthModal: false });
    app.globalData.pendingLocationAuth = false;
    // 用户确认开启位置，调用 wx.getFuzzyLocation 获取坐标后自动匹配最近门店
    const that = this;
    wx.getFuzzyLocation({
      type: 'gcj02',
      success(res) {
        wx.setStorageSync('userCoords', {
          latitude: res.latitude,
          longitude: res.longitude
        });
        // 匹配最近门店并自动切换（优先使用候选门店列表，如套餐会员的套餐门店）
        const candidates = app.globalData.storeMatchCandidates || app.globalData.storeList;
        const nearest = app._findNearestStoreByCoords(res.latitude, res.longitude, candidates);
        if (nearest) {
          app.globalData.currentStore = nearest;
          wx.setStorageSync('currentStore', nearest);
          that.setData({ currentStore: nearest });
          that.loadHomeData();
        }
      },
      fail() {
        // 获取位置失败，提示用户
        wx.showToast({ title: '获取位置失败，可稍后在切换门店时重试', icon: 'none' });
      }
    });
  },

  onModalTap() {},

  onSelectStore(e) {
    const { store } = e.currentTarget.dataset;
    if (!store || !store._id) return;
    app.globalData.currentStore = store;
    app.globalData.userManuallySelectedStore = true;  // 标记本次运行期间不再自动匹配
    app.globalData.pendingRelocate = false;
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
    // 游客点击教练头像：静默不跳转，不弹登录窗（符合微信审核规范）
    if (!auth.checkLogin()) return;
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/package-sub/pages/coach-detail/coach-detail?id=${id}`
    });
  },

  onCourseTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/package-sub/pages/course-detail/course-detail?id=${id}`
    });
  },

  onImageTap(e) {
    const { url, urls } = e.currentTarget.dataset;
    wx.previewImage({
      current: url,
      urls: urls || [url]
    });
  },

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    console.warn('图片加载失败:', id);
    if (id) {
      this.setData({ ['imageErrors.gallery_' + id]: true });
    }
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
      url: '/package-sub/pages/coach-list/coach-list'
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
    if (!auth.requireLogin(() => this.setData({ showLoginModal: true }))) return;
    wx.navigateTo({ url });
  },

  async loadAnnounces() {
    try {
      const storeId = this.data.currentStore ? this.data.currentStore._id : '';
      const res = await request({ url: `/announces?store_id=${storeId}&status=active`, method: 'GET', silent: true });
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

  // 公告只对舞栖会员开放，游客无权查看
  onAnnounceTap() {
    if (!auth.checkLogin()) return;
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

  // Haversine 公式计算两点间距离（米）
  _haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = v => v * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
      * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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