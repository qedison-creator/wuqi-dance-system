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
    pendingRelocate: false,  // 已授权用户需要重新定位（静默，无弹窗）
    locationAuthorized: false,  // 用户是否已授权位置
    userManuallySelectedStore: false,  // 用户本次运行期间手动选择过门店（阻止自动定位匹配）
    privacyResolve: null,
    scene: null,
    fromServiceAccount: false,
    isOnline: true
  },
  onLaunch(options) {
    this.silenceUnsupportedApi();
    this.registerPrivacyHandler();
    this.registerNetworkListener();
    this._updateEntryScene(options);
    const { fetchTemplates } = require('./utils/subscribe-message');
    // 订阅消息模板延迟加载，避免与 getUserInfo/getStoreList 并发导致 ERR_CONNECTION_RESET
    setTimeout(() => {
      fetchTemplates();
    }, 300);
    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
      // 冷启动时网络栈可能尚未就绪，延迟 500ms 发起，并启用自愈重试
      // _initPromise 同步赋值，供页面等待；实际请求延迟到 500ms 后发起
      this.globalData._initPromise = new Promise((resolve) => {
        setTimeout(() => {
          this.getUserInfo(false, 0, true).then(resolve).catch(resolve);
        }, 500);
      });
    } else {
      this.globalData._initPromise = Promise.resolve();
    }
    // 门店列表也延迟加载，避免冷启动并发请求同时失败
    setTimeout(() => {
      this.getStoreList(0, true);
    }, 500);
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
    // 无条件替换为 noop，避免 API 存在但调用时报 fail not support
    for (let i = 0; i < unsupportedList.length; i++) {
      const key = unsupportedList[i];
      try { wx[key] = noop; } catch (e) {}
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

  // 全局网络状态监听：断网时标记 isOnline=false，request.js 据此跳过请求
  // 网络恢复时标记 isOnline=true，页面可通过 onNetworkRestore 钩子刷新数据
  registerNetworkListener() {
    wx.getNetworkType({
      success: (res) => {
        this.globalData.isOnline = res.networkType !== 'none';
      }
    });
    wx.onNetworkStatusChange((res) => {
      const wasOffline = !this.globalData.isOnline;
      this.globalData.isOnline = res.isConnected && res.networkType !== 'none';
      if (wasOffline && this.globalData.isOnline) {
        const pages = getCurrentPages();
        const currentPage = pages[pages.length - 1];
        if (currentPage && typeof currentPage.onNetworkRestore === 'function') {
          currentPage.onNetworkRestore();
        }
      }
    });
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

  // forceRefresh: 强制刷新缓存
  // coldStartRetry: 冷启动自愈重试次数（内部使用）
  // isColdStart: 标记为冷启动调用，第一次失败静默不弹 toast
  getUserInfo(forceRefresh = false, coldStartRetry = 0, isColdStart = false) {
    const now = Date.now();
    const cacheTimeout = 5 * 60 * 1000; // 5分钟缓存

    // 如果缓存有效且不强制刷新，直接返回缓存的用户信息
    if (!forceRefresh && this.globalData.userInfo &&
        (now - this.globalData.userInfoLastFetch < cacheTimeout)) {
      console.log('[App] 使用缓存的用户信息');
      return Promise.resolve(this.globalData.userInfo);
    }

    const { request } = require('./utils/request');
    // 冷启动或自愈重试时静默（不弹 toast），由自愈机制处理
    const silent = isColdStart || coldStartRetry > 0;
    return request({
      url: '/auth/me',
      method: 'GET',
      silent: silent
    }).then(res => {
      this.globalData.userInfo = res.data;
      this.globalData.userInfoLastFetch = Date.now(); // 更新缓存时间
      this._tryMatchStoreForUser();
    }).catch((err) => {
      // 认证失败（401/403）已在 request.js 中强制登出，不再重试
      if (err && (err.code === 401 || err.code === 403)) {
        return;
      }
      // 网络错误自愈：最多重试 3 次，间隔 2s
      if (coldStartRetry < 3) {
        console.log(`[App] getUserInfo 冷启动自愈重试 ${coldStartRetry + 1}/3`);
        setTimeout(() => this.getUserInfo(false, coldStartRetry + 1, isColdStart), 2000);
        return;
      }
      // 重试耗尽：不清除 token（避免网络波动导致用户被登出）
    });
  },

  // 启动时统一匹配用户门店，避免 getUserInfo 和 getStoreList 都触发 determineDefaultStore
  // 匹配优先级：
  // 1. 套餐会员 → 套餐所属门店（多门店则按位置匹配最近）
  // 2. 无套餐用户/游客 → 按位置匹配最近门店
  _tryMatchStoreForUser() {
    const storeList = this.globalData.storeList;

    // 如果门店列表还没加载完，先标记待匹配，等 getStoreList 完成后再执行
    if (!storeList || storeList.length === 0) {
      this.globalData._pendingStoreMatch = true;
      return;
    }
    this.globalData._pendingStoreMatch = false;

    // 统一走 determineDefaultStore 进行门店匹配
    this.determineDefaultStore();
  },

  // retryCount: 冷启动自愈重试次数（内部使用）
  // isColdStart: 标记为冷启动调用，第一次失败静默不弹 toast
  getStoreList(retryCount = 0, isColdStart = false) {
    const { request } = require('./utils/request');
    // 冷启动或自愈重试时静默（不弹 toast）
    const silent = isColdStart || retryCount > 0;
    request({
      url: '/stores',
      method: 'GET',
      silent: silent
    }).then(res => {
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      this.globalData.storeList = list;
      // 如果 getUserInfo 已经拿到但还在等门店列表，现在统一匹配
      if (this.globalData._pendingStoreMatch) {
        this._tryMatchStoreForUser();
      } else if (!this.globalData.defaultStoreSet) {
        this.determineDefaultStore();
      }
    }).catch(() => {
      // 网络错误自愈：最多重试 3 次，间隔 2s
      if (retryCount < 3) {
        console.log(`[App] getStoreList 冷启动自愈重试 ${retryCount + 1}/3`);
        setTimeout(() => this.getStoreList(retryCount + 1, isColdStart), 2000);
      }
    });
  },

  // 统一匹配用户门店
  // 匹配优先级：
  // 1. 用户所属门店 userInfo.store_id（预建档/审核通过时写入）
  // 2. 套餐会员 → 套餐所属门店（多门店则按位置匹配最近）
  // 3. 无套餐用户/游客 → 按位置匹配最近门店
  // @param force - 强制重新匹配，用于登录/认领后从游客门店切换到会员门店
  determineDefaultStore(force = false) {
    const list = this.globalData.storeList;
    const userInfo = this.globalData.userInfo;

    if (list.length === 0) return;

    // 非强制模式下，已设置过或用户手动选择过则不重新匹配
    if (!force && (this.globalData.defaultStoreSet || this.globalData.userManuallySelectedStore)) return;

    if (userInfo && userInfo.member_status === 'official') {
      // 优先使用用户所属门店（预建档用户认领后该字段即为预建档门店）
      const userStoreId = userInfo.store_id
        ? (typeof userInfo.store_id === 'object' ? userInfo.store_id._id : userInfo.store_id)
        : null;
      if (userStoreId) {
        const matchedStore = list.find(s => String(s._id) === String(userStoreId));
        if (matchedStore) {
          this.setStore(matchedStore);
          return;
        }
      }

      // 其次按套餐门店匹配（多门店则按位置匹配最近）
      this.getActivePackageStores().then(activeStoreIds => {
        if (activeStoreIds.length === 1) {
          const matchedStore = list.find(s => String(s._id) === String(activeStoreIds[0]));
          if (matchedStore) {
            this.setStore(matchedStore);
            return;
          }
        }

        if (activeStoreIds.length > 1) {
          const candidateStores = list.filter(s => activeStoreIds.includes(String(s._id)));
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

  // 登录/认领成功后重置门店匹配状态，并按会员信息重新匹配门店
  // 解决游客阶段已匹配最近门店，认领后未切换到套餐所属门店的问题
  resetAndMatchStore() {
    this.globalData.defaultStoreSet = false;
    this.globalData.userManuallySelectedStore = false;
    this.determineDefaultStore(true);
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

    // 记录候选门店，供位置授权成功后匹配使用（套餐会员的候选门店可能是套餐门店子集）
    this.globalData.storeMatchCandidates = candidateStores;

    // 先用第一个门店作为临时默认（避免异步等待期间无门店可用）
    this.setStore(candidateStores[0]);

    // 检查位置授权状态，决定后续行为
    const that = this;
    wx.getSetting({
      success(settingRes) {
        const authStatus = settingRes.authSetting['scope.userFuzzyLocation'];
        if (authStatus === true) {
          // 已授权 → 标记需要重新定位（首页 onShow 时静默调用 wx.getFuzzyLocation，无弹窗）
          that.globalData.pendingRelocate = true;
        } else {
          // 未授权（从未询问或拒绝过）→ 标记待引导授权
          that.globalData.pendingLocationAuth = true;
        }
      },
      fail() {
        // getSetting 失败，回退到引导授权
        that.globalData.pendingLocationAuth = true;
      }
    });
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
  },

  // 认证失效（账号被删除/禁用、token 过期等）时强制登出并回到启动页
  // 防止被删除的会员继续浏览本地缓存的会员信息
  forceLogoutAndRedirect(message = '账号已失效，请重新登录', silent = false) {
    // 已经登出则不再重复跳转
    if (!wx.getStorageSync('token') && !this.globalData.token) {
      return;
    }
    wx.removeStorageSync('token');
    this.globalData.token = '';
    this.globalData.userInfo = null;
    this.globalData.userInfoLastFetch = 0;

    if (!silent) {
      wx.showToast({ title: message, icon: 'none', duration: 2000 });
    }
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/splash/splash' });
    }, silent ? 0 : 1500);
  }
});