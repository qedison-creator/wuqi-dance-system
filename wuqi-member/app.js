const config = require('./config/index.js');

App({
  globalData: {
    userInfo: null,
    userInfoLastFetch: 0,  // 上次获取用户信息的时间戳
    token: '',
    currentStore: null,
    storeList: [],
    baseUrl: config.baseUrl,
    defaultStoreSet: false,
    pendingLocationAuth: false,
    locationAuthorized: false,  // 用户是否已授权位置
    privacyResolve: null,
    scene: null,
    fromServiceAccount: false
  },
  onLaunch(options) {
    this.silenceUnsupportedApi();
    this.registerPrivacyHandler();
    this._updateEntryScene(options);
    const { fetchTemplates } = require('./utils/subscribe-message');
    fetchTemplates();
    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
      // 记录初始化 Promise，供页面等待 getUserInfo 完成
      this.globalData._initPromise = this.getUserInfo();
    } else {
      this.globalData._initPromise = Promise.resolve();
    }
    this.getStoreList();
  },

  onShow(options) {
    this._updateEntryScene(options);
    // 热启动时检查是否需要刷新用户信息（5分钟缓存控制）
    if (this.globalData.token) {
      const now = Date.now();
      if (!this.globalData.userInfo ||
          (now - this.globalData.userInfoLastFetch > 5 * 60 * 1000)) {
        this.getUserInfo();
      }
    }
  },

  // 识别是否来自服务号等公众号跳转的场景
  _isServiceAccountScene(scene) {
    const serviceScenes = [1035, 1043, 1058, 1067, 1074, 1082, 1020];
    return serviceScenes.indexOf(Number(scene)) !== -1;
  },

  _updateEntryScene(options) {
    if (!options) return;
    const scene = options.scene || this.globalData.scene;
    if (scene) {
      this.globalData.scene = scene;
      this.globalData.fromServiceAccount = this._isServiceAccountScene(scene);
    }
  },

  silenceUnsupportedApi() {
    const noop = function() {};
    const unsupportedList = [
      'reportRealtimeAction',
      'reportEvent',
      'reportPerformance',
      'reportMonitor'
    ];
    for (let i = 0; i < unsupportedList.length; i++) {
      const key = unsupportedList[i];
      if (typeof wx[key] !== 'function') {
        try { wx[key] = noop; } catch (e) {}
      }
    }
    try {
      if (typeof wx.canIUse === 'function') {
        const orig = wx.canIUse;
        wx.canIUse = function(name) {
          if (name === 'reportRealtimeAction' || name === 'reportEvent') return false;
          return orig.apply(this, arguments);
        };
      }
    } catch (e) {}
  },

  registerPrivacyHandler() {
    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
        console.log('[Privacy] 触发隐私授权弹窗, eventInfo:', JSON.stringify(eventInfo));
        this.globalData.privacyResolve = resolve;
        wx.showModal({
          title: '隐私保护指引',
          content: '在使用本小程序前，需要您阅读并同意《用户协议》和《隐私保护指引》。我们将严格按照法律法规保护您的个人信息安全。',
          cancelText: '暂不使用',
          confirmText: '同意',
          success: (res) => {
            if (res.confirm) {
              if (this.globalData.privacyResolve) {
                this.globalData.privacyResolve({
                  buttonId: 'agree',
                  event: 'agree'
                });
              }
            } else {
              if (this.globalData.privacyResolve) {
                this.globalData.privacyResolve({
                  buttonId: 'disagree',
                  event: 'disagree'
                });
              }
            }
            this.globalData.privacyResolve = null;
          }
        });
      });
    }
  },

  getUserInfo(forceRefresh = false) {
    const now = Date.now();
    const cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
    
    // 如果缓存有效且不强制刷新，直接返回缓存的用户信息
    if (!forceRefresh && this.globalData.userInfo && 
        (now - this.globalData.userInfoLastFetch < cacheTimeout)) {
      console.log('[App] 使用缓存的用户信息');
      return Promise.resolve(this.globalData.userInfo);
    }
    
    const { request } = require('./utils/request');
    return request({
      url: '/auth/me',
      method: 'GET'
    }).then(res => {
      this.globalData.userInfo = res.data;
      this.globalData.userInfoLastFetch = Date.now(); // 更新缓存时间
      
      // 优先使用用户信息中绑定的门店
      const userInfo = res.data;
      if (userInfo && userInfo.store_id && this.globalData.storeList.length > 0) {
        const storeId = typeof userInfo.store_id === 'object' && userInfo.store_id ? 
          (userInfo.store_id._id || userInfo.store_id.id || '') : 
          (userInfo.store_id || '');
        if (storeId) {
          const matchedStore = this.globalData.storeList.find(s => s._id === storeId);
          if (matchedStore) {
            this.setStore(matchedStore);
            return; // 找到匹配的门店，直接返回，不执行默认选择逻辑
          }
        }
      }
      
      // 如果本地有保存的门店，也优先使用
      const savedStore = wx.getStorageSync('currentStore');
      if (savedStore && savedStore._id) {
        const matchedStore = this.globalData.storeList.find(s => s._id === savedStore._id);
        if (matchedStore) {
          this.setStore(matchedStore);
          return;
        }
      }
      
      // 只有在上面都没找到的情况下，才执行默认选择逻辑
      this.determineDefaultStore();
    }).catch(() => {
      wx.removeStorageSync('token');
      this.globalData.token = '';
    });
  },

  getStoreList() {
    const { request } = require('./utils/request');
    request({
      url: '/stores',
      method: 'GET'
    }).then(res => {
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      this.globalData.storeList = list;
      if (!this.globalData.defaultStoreSet) {
        this.determineDefaultStore();
      }
    }).catch(() => {
    });
  },

  determineDefaultStore() {
    const list = this.globalData.storeList;
    const userInfo = this.globalData.userInfo;

    if (list.length === 0) return;

    if (this.globalData.defaultStoreSet) return;

    if (userInfo && userInfo.member_status === 'official') {
      this.getActivePackageStores().then(activeStoreIds => {
        if (activeStoreIds.length === 1) {
          const matchedStore = list.find(s => s._id === activeStoreIds[0]);
          if (matchedStore) {
            this.setStore(matchedStore);
            return;
          }
        }

        if (activeStoreIds.length > 1) {
          const candidateStores = list.filter(s => activeStoreIds.includes(s._id));
          this.selectNearestStore(candidateStores);
          return;
        }

        this.selectNearestStore(list);
      }).catch(() => {
        this.selectNearestStore(list);
      });
    } else {
      this.selectNearestStore(list);
    }
  },

  getActivePackageStores() {
    const { request } = require('./utils/request');
    return request({ url: '/packages/my', silent: true }).then(res => {
      const data = res.data || {};
      const packages = [];
      if (data.current) packages.push(data.current);
      if (data.history) {
        data.history.forEach(p => packages.push(p));
      }

      const activePackages = packages.filter(p => {
        if (p.status !== 'active' || p.is_suspended) return false;
        // 过滤已过期套餐（end_date 已过）
        if (p.is_activated && p.end_date && new Date() > new Date(p.end_date)) return false;
        return true;
      });
      const storeIds = [...new Set(
        activePackages
          .map(p => {
            const s = p.store_id;
            return typeof s === 'object' && s ? (s._id || s.id || '') : (s || '');
          })
          .filter(Boolean)
      )];

      return storeIds;
    }).catch(() => []);
  },

  selectNearestStore(candidateStores) {
    if (candidateStores.length === 0) return;

    // 1. 优先使用上次选择的门店
    const savedStore = wx.getStorageSync('currentStore');
    if (savedStore && savedStore._id) {
      const found = candidateStores.find(s => s._id === savedStore._id);
      if (found) {
        this.setStore(found);
        return;
      }
    }

    // 2. 有缓存的用户坐标（来自 wx.getFuzzyLocation 成功回调）→ 自动匹配最近门店
    const cachedCoords = wx.getStorageSync('userCoords');
    if (cachedCoords && cachedCoords.latitude && cachedCoords.longitude) {
      const nearest = this._findNearestStoreByCoords(cachedCoords.latitude, cachedCoords.longitude, candidateStores);
      if (nearest) {
        this.setStore(nearest);
        return;
      }
    }

    // 3. 首次使用，无坐标缓存 → 标记待引导，回退到第一个门店
    this.globalData.pendingLocationAuth = true;
    this.setStore(candidateStores[0]);
  },

  // 根据给定坐标从门店列表中找到最近的
  _findNearestStoreByCoords(lat, lng, candidateStores) {
    let nearestStore = null;
    let minDist = Infinity;

    const storesWithDist = candidateStores.map(store => {
      let storeLat, storeLng;
      const loc = store.location;
      if (loc && loc.latitude !== undefined && loc.longitude !== undefined) {
        storeLat = Number(loc.latitude);
        storeLng = Number(loc.longitude);
      } else if (loc && loc.coordinates && loc.coordinates.length >= 2) {
        storeLng = Number(loc.coordinates[0]);
        storeLat = Number(loc.coordinates[1]);
      }

      let dist = null;
      if (!isNaN(storeLat) && !isNaN(storeLng)) {
        dist = this._haversineDistance(lat, lng, storeLat, storeLng);
      }

      if (dist !== null && dist < minDist) {
        minDist = dist;
        nearestStore = store;
      }
      return { ...store, distance: dist };
    });

    this.globalData.storeList = storesWithDist;
    return nearestStore;
  },

  // 公共方法：根据坐标计算各门店距离（供页面调用）
  calcStoresWithDist(lat, lng, stores) {
    return stores.map(store => {
      let storeLat, storeLng;
      const loc = store.location;
      if (loc && loc.latitude !== undefined && loc.longitude !== undefined) {
        storeLat = Number(loc.latitude);
        storeLng = Number(loc.longitude);
      } else if (loc && loc.coordinates && loc.coordinates.length >= 2) {
        storeLng = Number(loc.coordinates[0]);
        storeLat = Number(loc.coordinates[1]);
      }
      let dist = null;
      if (!isNaN(storeLat) && !isNaN(storeLng)) {
        dist = this._haversineDistance(lat, lng, storeLat, storeLng);
      }
      return { ...store, distance: dist };
    });
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

  fallbackStore(savedStore, list) {
    if (savedStore) {
      const found = list.find(s => s._id === savedStore._id);
      if (found) {
        this.setStore(found);
        return;
      }
    }
    this.setStore(list[0]);
  },

  setStore(store) {
    this.globalData.currentStore = store;
    this.globalData.defaultStoreSet = true;
    wx.setStorageSync('currentStore', store);
  }
});