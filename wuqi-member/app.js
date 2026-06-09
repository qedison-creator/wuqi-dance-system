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
    privacyResolve: null
  },
  onLaunch() {
    this.registerPrivacyHandler();
    const { fetchTemplates } = require('./utils/subscribe-message');
    fetchTemplates();
    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
      this.getUserInfo();
    }
    this.getStoreList();
  },

  registerPrivacyHandler() {
    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
        console.log('[Privacy] 触发隐私授权弹窗, eventInfo:', JSON.stringify(eventInfo));
        this.globalData.privacyResolve = resolve;
        wx.showModal({
          title: '隐私政策提示',
          content: '在使用本小程序前，需要您阅读并同意《用户协议》和《隐私政策》。我们将严格按照法律法规保护您的个人信息安全。',
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

      const activePackages = packages.filter(p => p.status === 'active' && !p.is_suspended);
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

    const savedStore = wx.getStorageSync('currentStore');
    if (savedStore && savedStore._id) {
      const found = candidateStores.find(s => s._id === savedStore._id);
      if (found) {
        this.setStore(found);
        return;
      }
    }

    wx.getSetting({
      success: (settingRes) => {
        const locationAuth = settingRes.authSetting['scope.userLocation'];
        if (locationAuth === true) {
          this.requestLocationForNearestStore(candidateStores);
        } else if (locationAuth === undefined) {
          // 只有在用户还没做出过选择的时候才显示弹窗
          this.globalData.pendingLocationAuth = true;
          this.setStore(candidateStores[0]);
        } else {
          // 用户已经明确拒绝过，不再弹窗
          this.setStore(candidateStores[0]);
        }
      },
      fail: () => {
        this.setStore(candidateStores[0]);
      }
    });
  },

  requestLocationForNearestStore(candidateStores) {
    wx.getLocation({
      type: 'gcj02',
      altitude: true,
      highAccuracyExpireTime: 10000,
      success: (locRes) => {
        const { request } = require('./utils/request');
        request({
          url: `/stores/nearest?latitude=${locRes.latitude}&longitude=${locRes.longitude}`
        }).then(res => {
          const nearest = (res.data && res.data.nearest) || null;
          const storesWithDist = (res.data && res.data.stores) || [];
          
          // 将带距离的信息保存到全局数据中
          this.globalData.storeList = storesWithDist.length > 0 ? storesWithDist : candidateStores;
          
          if (nearest) {
            const matched = candidateStores.find(s => s._id === nearest._id);
            if (matched) {
              this.setStore(matched);
              return;
            }
          }
          const savedStore = wx.getStorageSync('currentStore');
          if (savedStore && savedStore._id) {
            const found = candidateStores.find(s => s._id === savedStore._id);
            if (found) {
              this.setStore(found);
              return;
            }
          }
          this.setStore(candidateStores[0]);
        }).catch((err) => {
          console.error('【定位调试】请求门店距离失败:', err);
          const savedStore = wx.getStorageSync('currentStore');
          if (savedStore && savedStore._id) {
            const found = candidateStores.find(s => s._id === savedStore._id);
            if (found) { this.setStore(found); return; }
          }
          this.setStore(candidateStores[0]);
        });
      },
      fail: (err) => {
        console.error('【定位调试】获取位置失败:', err);
        const savedStore = wx.getStorageSync('currentStore');
        if (savedStore && savedStore._id) {
          const found = candidateStores.find(s => s._id === savedStore._id);
          if (found) { this.setStore(found); return; }
        }
        this.setStore(candidateStores[0]);
      }
    });
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