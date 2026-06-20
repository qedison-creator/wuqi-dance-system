const app = getApp();
const { request } = require('../../utils/request');
const { requireLogin, checkLogin } = require('../../utils/auth');
const drawQrcode = require('../../utils/weapp.qrcode');


Page({
  data: {
    userInfo: null,
    isLoggedIn: false,
    memberSinceDays: 0,
    memberStatus: 'active',
    profileSaved: false,
    profileForm: {
      real_name: '',
      phone: '',
      gender: 0,
      store_id: '',
      store_name: ''
    },
    canChangeStore: true,
    packages: [],
    allPackages: [],
    currentPackage: null,
    activePackages: [],
    pendingPackages: [],
    historyPackages: [],
    showPackageHistory: false,
    imageErrors: {},
    stats: {
      totalBookings: 0,
      completedClasses: 0,
      remainingClasses: 0
    },
    storePhone: '',
    menuList: [],
    showStorePicker: false,
    storePickerTitle: '选择门店',
    storePickerMode: 'login',
    storeList: [],
    selectedStoreId: '',
    selectedStoreName: '',
    nearestDistance: null,
    showForceProfileModal: false,
    showQRModal: false,
    qrDynamicToken: '',
    qrCodeUrl: '',
    qrCodeToken: '',
    qrExpireSeconds: 60,
    qrCountdown: 60,
    showCheckInSuccess: false,
    checkInCourses: [],
    checkInAutoCloseTimer: null,
    showChangePhoneModal: false,
    newPhone: '',
    showTransferModal: false,
    transferStoreList: [],
    transferStoreId: '',
    transferReason: '',
    showPackageDetail: false,
    detailPackage: null,
    sheetDragY: 0,
    sheetDragging: false,
    canPullRefresh: true,
    refresherTriggered: false,
    avatarImageError: false,
    currentPackageType: '',
    avatarSrc: '/images/default-avatar.svg',
    memberStatusText: '',
    showLoginModal: false
  },

  getMemberSinceDays(userInfo, packages) {
    if (!userInfo) return 0;

    // 按北京时间取整的天数差
    const getBeijingDateStr = (date) => {
      const d = new Date(date);
      const beijingTime = d.getTime() + 8 * 60 * 60 * 1000;
      const beijingDate = new Date(beijingTime);
      return beijingDate.toISOString().split('T')[0];
    };
    const diffBeijingDays = (date1, date2) => {
      const d1 = new Date(getBeijingDateStr(date1));
      const d2 = new Date(getBeijingDateStr(date2));
      return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
    };

    const now = new Date();
    let baseDate = null;

    // 正式会员优先以最早套餐的开始日期作为加入时间
    if (userInfo.member_status === 'official' && packages && packages.length > 0) {
      packages.forEach(function(pkg) {
        if (pkg.start_date) {
          const d = new Date(pkg.start_date);
          if (!baseDate || d < baseDate) baseDate = d;
        }
      });
    }

    // 没有套餐时回退到注册时间
    if (!baseDate) {
      const created = userInfo.created_at || userInfo.createdAt || userInfo.join_date;
      if (!created) return 0;
      baseDate = new Date(created);
    }

    if (isNaN(baseDate.getTime())) return 0;
    return Math.max(0, diffBeijingDays(baseDate, now));
  },

  computeMemberStatus(userInfo, packages) {
    if (!userInfo || userInfo.member_status !== 'official') return 'disabled';
    if (packages && packages.length > 0) {
      const hasSuspended = packages.some(function(p) { return p.is_suspended; });
      if (hasSuspended) return 'suspended';
    }
    return 'active';
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, active: 'profile' });
    }
    this.checkLoginStatus();
    // 初始化时启用下拉刷新
    this._updatePullDownRefresh();
    // 服务号跳转场景：未登录用户自动弹出登录面板，避免白屏/功能异常
    if (!checkLogin() && app.globalData.fromServiceAccount && !this._serviceLoginPrompted) {
      this._serviceLoginPrompted = true;
      this.setData({ showLoginModal: true });
    }
  },

  onHide() {
    this.stopQRRefresh();
    this.stopCheckInPolling();
    if (this.data.checkInAutoCloseTimer) {
      clearTimeout(this.data.checkInAutoCloseTimer);
    }
  },

  onUnload() {
    this.stopQRRefresh();
    this.stopCheckInPolling();
    if (this.data.checkInAutoCloseTimer) {
      clearTimeout(this.data.checkInAutoCloseTimer);
    }
  },

  // 根据弹窗状态动态开关下拉刷新
  _isAnyModalOpen() {
    return this.data.showPackageDetail || this.data.showQRModal
      || this.data.showForceProfileModal || this.data.showStorePicker
      || this.data.showChangePhoneModal || this.data.showTransferModal
      || this.data.showCheckInSuccess;
  },

  _updatePullDownRefresh() {
    this.setData({ canPullRefresh: !this._isAnyModalOpen() });
  },

  async onRefresh() {
    try {
      await this.loadUserData();
    } catch (e) {
      console.error('刷新失败:', e);
    } finally {
      // 无论成功失败，都要停止刷新动画
      this.setData({ refresherTriggered: false });
    }
  },

  checkLoginStatus() {
    if (checkLogin()) {
          const userInfo = app.globalData && app.globalData.userInfo ? app.globalData.userInfo : {};
          var avatarSrc = userInfo.avatar || '/images/default-avatar.svg';
          this.setData({
            isLoggedIn: true,
            userInfo: userInfo,
            memberSinceDays: this.getMemberSinceDays(userInfo, this.data.packages),
            avatarSrc: avatarSrc,
            avatarImageError: false
          });
          this.loadUserData();
        } else {
      this.setData({ isLoggedIn: false, userInfo: null, memberSinceDays: 0, avatarSrc: '/images/default-avatar.svg', avatarImageError: false });
    }
  },

  async loadUserData() {
    this.setData({
      stats: {
        totalBookings: 0,
        completedClasses: 0,
        remainingClasses: 0
      }
    });

    try {
      await Promise.all([
        request({ url: '/packages/my' }).then(res => {
          if (res.data) {
            var packages = [];
            var packageIds = {};

            if (res.data.current) {
              var currentPkg = {};
              var keys = Object.keys(res.data.current);
              for (var i = 0; i < keys.length; i++) {
                currentPkg[keys[i]] = res.data.current[keys[i]];
              }
              packages.push(currentPkg);
              packageIds[currentPkg._id] = true;
            }

            if (res.data.history && res.data.history.length > 0) {
              res.data.history.forEach(function(pkg) {
                if (!packageIds[pkg._id]) {
                  packages.push(pkg);
                  packageIds[pkg._id] = true;
                }
              });
            }

            // 计算北京时区的自然日差值
    const getBeijingDateStr = (date) => {
      const d = new Date(date);
      const beijingTime = d.getTime() + 8 * 60 * 60 * 1000;
      const beijingDate = new Date(beijingTime);
      return beijingDate.toISOString().split('T')[0];
    };

    const diffBeijingDays = (date1, date2) => {
      const d1Str = getBeijingDateStr(date1);
      const d2Str = getBeijingDateStr(date2);
      const d1 = new Date(d1Str);
      const d2 = new Date(d2Str);
      return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
    };

    packages.forEach(function(pkg) {
      if (pkg.start_date) {
        pkg.start_date_display = getBeijingDateStr(pkg.start_date);
      }
      if (pkg.end_date) {
        pkg.end_date_display = getBeijingDateStr(pkg.end_date);
        // 仅对未过期且未暂停的激活套餐计算剩余天数，避免历史套餐出现负数
        if (pkg.is_activated && !pkg.is_suspended && pkg.status === 'active') {
          var now = new Date();
          var end = new Date(pkg.end_date);
          if (now <= end) {
            var diff = diffBeijingDays(now, end) + 1;
            pkg.remaining_days = Math.max(0, diff);
          }
        }
      }
    });

            var currentPkg = res.data.current;
            var remainingClasses = 0;
            if (currentPkg) {
              if (currentPkg.package_type === 'count_card') {
                remainingClasses = currentPkg.remaining_credits || 0;
              } else if (currentPkg.package_type === 'time_card') {
                var usage = res.data.timeCardUsage;
                if (usage) {
                  remainingClasses = usage.weekly_remaining !== null ? usage.weekly_remaining : (usage.daily_remaining !== null ? usage.daily_remaining : -1);
                } else {
                  remainingClasses = currentPkg.daily_limit || currentPkg.weekly_limit || -1;
                }
              }
            }

            if (res.data.timeCardUsage && currentPkg && currentPkg.package_type === 'time_card') {
              var idx = -1;
              for (var j = 0; j < packages.length; j++) {
                if (packages[j]._id === currentPkg._id) {
                  idx = j;
                  break;
                }
              }
              if (idx >= 0) {
                packages[idx].timeCardUsage = res.data.timeCardUsage;
              }
            }

            var hasPackage = packages && packages.length > 0;
            var userInfo = this.data.userInfo;
            var canChangeStore = !(hasPackage && userInfo && userInfo.member_status === 'official');
            var memberStatus = this.computeMemberStatus(userInfo, packages);

            this.setData({
              packages: packages,
              canChangeStore: canChangeStore,
              memberStatus: memberStatus,
              stats: {
                remainingClasses: remainingClasses,
                totalBookings: this.data.stats.totalBookings,
                completedClasses: this.data.stats.completedClasses
              }
            });
            // 套餐加载完成后再按套餐开始日期校准加入天数，保持与已用天数口径一致
            var userInfo = this.data.userInfo;
            if (userInfo) {
              this.setData({ memberSinceDays: this.getMemberSinceDays(userInfo, packages) });
            }
            this.processPackageGroups(packages, memberStatus);
          }
        }).catch(function(err) {
          console.error('加载套餐信息失败:', err);
          this.setData({
            packages: [],
            allPackages: [],
            currentPackage: null,
            pendingPackages: [],
            historyPackages: []
          });
        }.bind(this)),

        request({ url: '/bookings/my?type=booking' }).then(function(res) {
          var totalBookings = res.data && res.data.list ? res.data.list.length : 0;
          this.setData({
            'stats.totalBookings': totalBookings
          });
        }.bind(this)).catch(function(err) {
          console.error('加载预约统计失败:', err);
        }),

        request({ url: '/bookings/my?type=completed' }).then(function(res) {
          var completedClasses = res.data && res.data.list ? res.data.list.length : 0;
          this.setData({
            'stats.completedClasses': completedClasses
          });
        }.bind(this)).catch(function(err) {
          console.error('加载上课统计失败:', err);
        }),

        request({ url: '/auth/me' }).then(function(res) {
          if (res.data) {
            var userInfo = res.data;
            var storeObj = userInfo.store_id;
            var storeId = typeof storeObj === 'object' && storeObj ? (storeObj._id || storeObj.id || '') : (storeObj || '');
            var storeName = (storeObj && storeObj.name) || userInfo.store_name || '';
            var storePhone = (storeObj && storeObj.phone) || '';
            var profileForm = {
              real_name: userInfo.real_name || '',
              phone: userInfo.reserve_phone || userInfo.phone || '',
              gender: userInfo.gender || 0,
              store_id: storeId,
              store_name: storeName
            };

            var memberSinceDays = this.getMemberSinceDays(userInfo, this.data.packages);
            var memberStatus = this.computeMemberStatus(userInfo, this.data.packages);

            this.setData({
              userInfo: userInfo,
              profileForm: profileForm,
              storePhone: storePhone,
              memberSinceDays: memberSinceDays,
              memberStatus: memberStatus
            });

            if (!storePhone && storeId) {
              this.loadStorePhone(storeId);
            }
            app.globalData.userInfo = userInfo;
            
            // 检查是否需要完善个人信息
            this._checkForceProfile(profileForm, userInfo);
          }
        }.bind(this)).catch(function(err) {
          console.error('加载用户信息失败:', err);
        })
      ]);
    } catch (err) {
      console.error('加载数据失败:', err);
    }
  },

  loadStorePhone(storeId) {
    request({ url: '/stores/' + storeId, silent: true }).then(function(res) {
      if (res.data && res.data.phone) {
        this.setData({ storePhone: res.data.phone });
      }
    }.bind(this)).catch(function(err) {
      console.error('加载门店电话失败:', err);
    });
  },

  _refreshStatsAndPackages() {
    request({ url: '/packages/my' }).then(function(res) {
      if (res.data) {
        var packages = [];
        var packageIds = {};

        if (res.data.current) {
          var currentPkg = {};
          var keys = Object.keys(res.data.current);
          for (var i = 0; i < keys.length; i++) {
            currentPkg[keys[i]] = res.data.current[keys[i]];
          }
          packages.push(currentPkg);
          packageIds[currentPkg._id] = true;
        }

        // 计算北京时区的自然日差值
        const getBeijingDateStr = (date) => {
          const d = new Date(date);
          const beijingTime = d.getTime() + 8 * 60 * 60 * 1000;
          const beijingDate = new Date(beijingTime);
          return beijingDate.toISOString().split('T')[0];
        };

        const diffBeijingDays = (date1, date2) => {
          const d1Str = getBeijingDateStr(date1);
          const d2Str = getBeijingDateStr(date2);
          const d1 = new Date(d1Str);
          const d2 = new Date(d2Str);
          return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
        };

        if (res.data.history && res.data.history.length > 0) {
          res.data.history.forEach(function(pkg) {
            if (!packageIds[pkg._id]) {
              if (pkg.start_date) {
                pkg.start_date_display = getBeijingDateStr(pkg.start_date);
              }
              if (pkg.end_date) {
                pkg.end_date_display = getBeijingDateStr(pkg.end_date);
              }
              packages.push(pkg);
              packageIds[pkg._id] = true;
            }
          });
        }

        packages.forEach(function(pkg) {
          if (pkg.start_date) {
            pkg.start_date_display = getBeijingDateStr(pkg.start_date);
          }
          if (pkg.end_date) {
            pkg.end_date_display = getBeijingDateStr(pkg.end_date);
            if (pkg.is_activated && pkg.status === 'active' && !pkg.is_suspended) {
              var now = new Date();
              var end = new Date(pkg.end_date);
              if (now <= end) {
                var diff = diffBeijingDays(now, end) + 1;
                pkg.remaining_days = Math.max(0, diff);
              }
            }
          }
        });
        var currentPkg = res.data.current;
        var remainingClasses = 0;
        if (currentPkg) {
          if (currentPkg.package_type === 'count_card') {
            remainingClasses = currentPkg.remaining_credits || 0;
          } else if (currentPkg.package_type === 'time_card') {
            var usage = res.data.timeCardUsage;
            if (usage) {
              remainingClasses = usage.weekly_remaining !== null ? usage.weekly_remaining : (usage.daily_remaining !== null ? usage.daily_remaining : -1);
            } else {
              remainingClasses = currentPkg.daily_limit || currentPkg.weekly_limit || -1;
            }
          }
        }

        if (res.data.timeCardUsage && currentPkg && currentPkg.package_type === 'time_card') {
          var idx = -1;
          for (var j = 0; j < packages.length; j++) {
            if (packages[j]._id === currentPkg._id) {
              idx = j;
              break;
            }
          }
          if (idx >= 0) {
            packages[idx].timeCardUsage = res.data.timeCardUsage;
          }
        }

        var memberStatus = this.computeMemberStatus(this.data.userInfo, packages);

        this.setData({
          packages: packages,
          memberStatus: memberStatus,
          'stats.remainingClasses': remainingClasses
        });
        // 刷新完成后同步加入天数
        var userInfo = this.data.userInfo;
        if (userInfo) {
          this.setData({ memberSinceDays: this.getMemberSinceDays(userInfo, packages) });
        }
        this.processPackageGroups(packages, memberStatus);
      }
    }.bind(this)).catch(function(err) {
      console.error('刷新套餐信息失败:', err);
    });

    request({ url: '/bookings/my?type=booking' }).then(function(res) {
      var totalBookings = res.data && res.data.list ? res.data.list.length : 0;
      this.setData({ 'stats.totalBookings': totalBookings });
    }.bind(this)).catch(function(err) {
      console.error('刷新预约统计失败:', err);
    });

    request({ url: '/bookings/my?type=completed' }).then(function(res) {
      var completedClasses = res.data && res.data.list ? res.data.list.length : 0;
      this.setData({ 'stats.completedClasses': completedClasses });
    }.bind(this)).catch(function(err) {
      console.error('刷新上课统计失败:', err);
    });
  },

  _checkForceProfile(profileForm, userInfo) {
    if (userInfo.member_status !== 'official') return;

    var hasRealName = profileForm.real_name && profileForm.real_name.trim();
    var hasPhone = profileForm.phone && String(profileForm.phone).trim().length === 11;
    var hasGender = false;
    var genderVal = profileForm.gender;
    if (genderVal === 1 || genderVal === 2 || genderVal === '1' || genderVal === '2') {
      hasGender = true;
    }

    if (!hasRealName || !hasPhone || !hasGender) {
      this.setData({ showForceProfileModal: true });
      this._updatePullDownRefresh();
    } else {
      this.setData({ showForceProfileModal: false });
    }
  },

  onLoginTap() {
    this.setData({ showLoginModal: true });
  },

  onLoginModalClose() {
    this.setData({ showLoginModal: false });
  },

  onLoginSuccess() {
    this.setData({ showLoginModal: false });
    this.checkLoginStatus();
  },

  _fallbackStorePicker() {
    request({ url: '/stores' }).then(function(res) {
      var storeList = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      if (storeList.length === 0) {
        wx.showToast({ title: '暂无可选门店', icon: 'none' });
        return;
      }
      this.setData({
        storeList: storeList,
        showStorePicker: true,
        storePickerTitle: '选择所在门店',
        storePickerMode: 'login',
        selectedStoreId: '',
        selectedStoreName: '',
        nearestDistance: null
      });
    }.bind(this)).catch(function() {
      wx.showToast({ title: '获取门店失败', icon: 'none' });
    });
  },

  onShowStorePicker() {
    if (this.data.storeList.length === 0) {
      request({ url: '/stores' }).then(function(res) {
        this.setData({
          storeList: res.data || [],
          showStorePicker: true,
          storePickerTitle: '选择所在门店',
          storePickerMode: 'edit',
          selectedStoreId: this.data.profileForm.store_id,
          selectedStoreName: this.data.profileForm.store_name
        });
        this._updatePullDownRefresh();
      }.bind(this));
    } else {
      this.setData({
        showStorePicker: true,
        storePickerTitle: '选择所在门店',
        storePickerMode: 'edit',
        selectedStoreId: this.data.profileForm.store_id,
        selectedStoreName: this.data.profileForm.store_name
      });
      this._updatePullDownRefresh();
    }
  },

  onCloseStorePicker() {
    this.setData({ showStorePicker: false });
    this._updatePullDownRefresh();
  },

  onCloseForceProfileModal() {
    wx.showToast({ title: '请先完善个人信息', icon: 'none' });
  },

  onModalTap() {},

  onStoreSelect(e) {
    var id = e.currentTarget.dataset.id;
    var name = e.currentTarget.dataset.name;
    this.setData({
      selectedStoreId: id,
      selectedStoreName: name
    });
  },

  onStoreConfirm() {
    var selectedStoreId = this.data.selectedStoreId;
    var selectedStoreName = this.data.selectedStoreName;
    var storePickerMode = this.data.storePickerMode;
    if (!selectedStoreId) return;

    this.setData({ showStorePicker: false });
    this._updatePullDownRefresh();

    if (storePickerMode === 'login') {
      this.doLogin(selectedStoreId);
    } else {
      this.setData({
        'profileForm.store_id': selectedStoreId,
        'profileForm.store_name': selectedStoreName
      });
    }
  },

  doLogin(storeId) {
    wx.showLoading({ title: '登录中...' });
    var wxLogin = require('../../utils/auth').wxLogin;
    wxLogin(storeId).then(function() {
      wx.hideLoading();
      wx.showToast({ title: '登录成功', icon: 'success' });
      this.setData({ isLoggedIn: true });
      this.loadUserData();
    }.bind(this)).catch(function() {
      wx.hideLoading();
      wx.showToast({ title: '登录失败', icon: 'none' });
    });
  },

  onRealNameInput(e) {
    this.setData({ 'profileForm.real_name': e.detail.value });
  },

  onPhoneInput(e) {
    this.setData({ 'profileForm.phone': e.detail.value });
  },

  onGenderSelect(e) {
    var gender = parseInt(e.currentTarget.dataset.gender);
    this.setData({ 'profileForm.gender': gender });
  },

  onSaveProfile() {
    var real_name = this.data.profileForm.real_name;
    var phone = this.data.profileForm.phone;
    var gender = this.data.profileForm.gender;

    if (!real_name || !real_name.trim()) {
      wx.showToast({ title: '请输入真实姓名', icon: 'none' });
      return;
    }

    if (!phone || phone.length !== 11) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' });
      return;
    }

    if (gender !== 1 && gender !== 2) {
      wx.showToast({ title: '请选择性别', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });

    var postData = { real_name: real_name, phone: phone, gender: gender };

    request({
      url: '/auth/profile',
      method: 'PUT',
      data: postData
    }).then(function(res) {
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      if (res.data) {
        var userInfo = res.data;
        var storeObj = userInfo.store_id;
        var storeId = typeof storeObj === 'object' && storeObj ? (storeObj._id || storeObj.id || '') : (storeObj || '');
        var storeName = (storeObj && storeObj.name) || userInfo.store_name || '';
        var profileForm = {
          real_name: userInfo.real_name || '',
          phone: userInfo.reserve_phone || userInfo.phone || '',
          gender: userInfo.gender || 0,
          store_id: storeId,
          store_name: storeName
        };
        var memberSinceDays = this.getMemberSinceDays(userInfo, this.data.packages);
        this.setData({
          showForceProfileModal: false,
          userInfo: userInfo,
          profileForm: profileForm,
          profileSaved: true,
          memberSinceDays: memberSinceDays
        });
        this._updatePullDownRefresh();
        app.globalData.userInfo = userInfo;
        this._refreshStatsAndPackages();
      }
    }.bind(this)).catch(function(err) {
      wx.hideLoading();
      var msg = err.data && err.data.message ? err.data.message : '保存失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  onLogoutTap() {
    var self = this;
    wx.showModal({
      title: '提示',
      content: '确认退出登录？',
      success: function(res) {
        if (res.confirm) {
          var logout = require('../../utils/auth').logout;
          logout();
          self.setData({
            isLoggedIn: false,
            userInfo: null,
            memberSinceDays: 0,
            memberStatus: 'active',
            profileForm: { real_name: '', phone: '', gender: 0, store_id: '', store_name: '' },
            packages: [],
            stats: { totalBookings: 0, completedClasses: 0, remainingClasses: 0 },
            canChangeStore: true
          });
        }
      }
    });
  },

  processPackageGroups(packages, memberStatus) {
    if (!memberStatus) memberStatus = 'disabled';
    if (!packages || !packages.length) {
      this.setData({
        allPackages: [],
        currentPackage: null,
        pendingPackages: [],
        historyPackages: []
      });
      return;
    }

    var currentPackage = null;
    var activePackages = [];
    var pendingPackages = [];
    var historyPackages = [];

    // 计算北京时区的自然日差值（忽略时分秒）
    const getBeijingDateStr = (date) => {
      const d = new Date(date);
      const beijingTime = d.getTime() + 8 * 60 * 60 * 1000;
      const beijingDate = new Date(beijingTime);
      return beijingDate.toISOString().split('T')[0]; // YYYY-MM-DD
    };

    const diffBeijingDays = (date1, date2) => {
      const d1Str = getBeijingDateStr(date1);
      const d2Str = getBeijingDateStr(date2);
      const d1 = new Date(d1Str);
      const d2 = new Date(d2Str);
      return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
    };

    packages.forEach(function(pkg) {
      // 门店名称
      pkg._storeName = (pkg.store_id && pkg.store_id.name) ? pkg.store_id.name : '';

      // 套餐类型标签（简短版用于标签）
      pkg._typeLabel = pkg.package_type === 'time_card' ? '时间卡' : '次卡';
      
      // 状态文案（情绪价值表达，无emoji）
      // 动态修正：已激活但有效期已过的，标记为已过期
      var isExpired = pkg.is_activated && pkg.end_date && new Date() > new Date(pkg.end_date);
      if (pkg.is_suspended) {
        pkg._statusText = '暂停中';
      } else if (isExpired || pkg.status === 'expired') {
        pkg._statusText = '已过期';
      } else if (pkg.status === 'active') {
        pkg._statusText = '畅享中';
      } else if (pkg.status === 'pending') {
        pkg._statusText = '静待开启';
      } else {
        pkg._statusText = '已满载';
      }

      // 自动激活日期
      if (!pkg.is_activated && pkg.auto_activate_at) {
        var autoDate = new Date(pkg.auto_activate_at);
        pkg._autoActivateDate = autoDate.getFullYear() + '-' +
          String(autoDate.getMonth() + 1).padStart(2, '0') + '-' +
          String(autoDate.getDate()).padStart(2, '0');
        var now = new Date();
        var diffDays = diffBeijingDays(now, autoDate);
        pkg._autoActivateDays = Math.max(0, diffDays);
      } else {
        pkg._autoActivateDate = null;
        pkg._autoActivateDays = 0;
      }

      // 进度条
      if (pkg.is_activated && pkg.status === 'active' && !pkg.is_suspended) {
        if (pkg.package_type === 'count_card') {
          var totalC = pkg.total_credits || 0;
          var usedC = totalC - (pkg.remaining_credits || 0);
          if (usedC < 0) usedC = 0;
          pkg._usedAmount = usedC;
          pkg._totalAmount = totalC;
          pkg._progressPercent = totalC > 0 ? Math.min(Math.round((usedC / totalC) * 100), 100) : 0;
          pkg._hasProgress = true;
          pkg._progressLabel = '已用 ' + usedC + ' 次';
        } else if (pkg.package_type === 'time_card') {
          var totalDays = 0;
          if (pkg.start_date && pkg.end_date) {
            totalDays = diffBeijingDays(pkg.start_date, pkg.end_date) + 1;
          }
          var usedDays = 0;
          if (pkg.start_date && pkg.is_activated) {
            var now = new Date();
            var start = new Date(pkg.start_date);
            // 已用天数不包含今天（今天同时算入剩余天数），避免两者相加比总天数多1
            usedDays = diffBeijingDays(start, now);
            if (usedDays < 0) usedDays = 0;
            if (usedDays > totalDays) usedDays = totalDays;
          }
          pkg._usedAmount = usedDays;
          pkg._totalAmount = totalDays;
          pkg._progressPercent = totalDays > 0 ? Math.min(Math.round((usedDays / totalDays) * 100), 100) : 0;
          pkg._hasProgress = totalDays > 0;
          pkg._progressLabel = '已用 ' + usedDays + ' 天';
        } else {
          pkg._hasProgress = false;
        }
      } else {
        pkg._hasProgress = false;
      }

      // 时间卡使用情况（本周预约）
      if (pkg.package_type === 'time_card' && pkg.timeCardUsage) {
        pkg._weekUsed = pkg.timeCardUsage.weekly_used !== null ? pkg.timeCardUsage.weekly_used : pkg.timeCardUsage.daily_used;
        pkg._weekLimit = pkg.timeCardUsage.weekly_limit !== null ? pkg.timeCardUsage.weekly_limit : pkg.timeCardUsage.daily_limit;
        pkg._weekRemaining = pkg.timeCardUsage.weekly_remaining !== null ? pkg.timeCardUsage.weekly_remaining : pkg.timeCardUsage.daily_remaining;
        pkg._nextWeekUsed = pkg.timeCardUsage.next_week_used;
        pkg._nextWeekRemaining = pkg.timeCardUsage.next_week_remaining;
        pkg._periodLabel = pkg.timeCardUsage.weekly_limit ? '本周' : (pkg.timeCardUsage.daily_limit ? '今日' : '');
      }
      
      // 待激活套餐显示文本
            if (pkg.package_type === 'count_card') {
                var unitText = pkg.duration_unit === 'month' ? '个月' : '天';
                pkg._pendingCreditsText = '共 ' + (pkg.total_credits || pkg.remaining_credits || 0) + ' 次 · 有效期 ' + (pkg.duration_value || '-') + unitText;
            } else {
                var unitText = pkg.duration_unit === 'month' ? '个月' : '天';
                pkg._pendingCreditsText = '有效期 ' + (pkg.duration_value || '-') + unitText;
            }
            
            // 历史套餐统计文本
            if (pkg.package_type === 'count_card') {
                if (pkg.total_credits) {
                    var used = pkg.total_credits - (pkg.remaining_credits || 0);
                    pkg._historyStat = '已用 ' + used + ' / 共 ' + pkg.total_credits + ' 次';
                } else {
                    pkg._historyStat = '剩余 ' + (pkg.remaining_credits || 0) + ' 次';
                }
            } else {
                pkg._historyStat = (pkg.start_date_display || '') + ' 至 ' + (pkg.end_date_display || '');
            }

      // 预计算动态 class 和 style
      pkg._progressFillClass = 'pkg-progress-fill pkg-progress-fill-' + pkg.status;
      pkg._progressWidthStyle = 'width: ' + (pkg._progressPercent || 0) + '%;';
      
      // 分类：使用中 / 待激活 / 历史
      // 使用中：status === 'active'，未暂停，且未过期，且次卡还有次数
      // 过期的套餐（即使 status 仍为 active）归入历史
      if (pkg.status === 'active' && !pkg.is_suspended && !isExpired) {
        activePackages.push(pkg);
      } else if (pkg.status === 'pending') {
        pendingPackages.push(pkg);
      } else {
        // 历史：expired / 过期的active / 用完的active / 暂停的(is_suspended) / exhausted等
        historyPackages.push(pkg);
      }
    });

    // currentPackage取第一个active（兼容旧逻辑）
    if (activePackages.length > 0) {
      currentPackage = activePackages[0];
    }

    this.setData({
      allPackages: packages,
      currentPackage: currentPackage,
      activePackages: activePackages,
      pendingPackages: pendingPackages,
      historyPackages: historyPackages,
      currentPackageType: currentPackage ? (currentPackage.package_type === 'time_card' ? '时间卡' : '次卡') : '',
      memberStatusText: memberStatus === 'active' ? '正式会员' : (memberStatus === 'suspended' ? '已停用' : '待激活')
    });
  },

  onPackageTap(e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    var item = null;
    if (this.data.currentPackage && this.data.currentPackage._id === id) {
      item = this.data.currentPackage;
    }
    if (!item && this.data.pendingPackages) {
      for (var i = 0; i < this.data.pendingPackages.length; i++) {
        if (this.data.pendingPackages[i]._id === id) {
          item = this.data.pendingPackages[i];
          break;
        }
      }
    }
    if (!item && this.data.historyPackages) {
      for (var j = 0; j < this.data.historyPackages.length; j++) {
        if (this.data.historyPackages[j]._id === id) {
          item = this.data.historyPackages[j];
          break;
        }
      }
    }
    if (!item) return;
    this.setData({ showPackageDetail: true, detailPackage: item });
    this._updatePullDownRefresh();
  },

  onClosePackageDetail() {
    this.setData({ showPackageDetail: false, detailPackage: null, sheetDragY: 0, sheetDragging: false });
    this._updatePullDownRefresh();
  },

  onPackageDetailTap() {},

  onTogglePackageHistory() {
    this.setData({ showPackageHistory: !this.data.showPackageHistory });
  },

  onLogin() {
    this.onLoginTap();
  },

  handleGuestTap() {
    if (!checkLogin()) {
      requireLogin();
      return;
    }
    wx.showModal({
      title: '提示',
      content: '您的会员申请正在审核中，审核通过后可查看完整功能',
      showCancel: false,
      confirmColor: '#D4786E'
    });
  },

  onLogout() {
    this.onLogoutTap();
  },

  onMemberInfo() {
    if (!requireLogin()) return;
    wx.navigateTo({ url: '/pages/member-info/member-info' });
  },

  // 审核通过后引导完善资料
  onGoSetup() {
    if (!requireLogin()) return;
    wx.navigateTo({ url: '/pages/member-info/member-info' });
  },

  onSubscribeSettings() {
    if (!requireLogin()) return;
    wx.navigateTo({ url: '/pages/subscribe-settings/subscribe-settings' });
  },

  onMyBookings() {
    if (!requireLogin()) return;
    wx.navigateTo({ url: '/pages/records/records' });
  },

  onTransferCard() {
    if (!requireLogin()) return;
    const userInfo = app.globalData.userInfo || {};
    if (userInfo.member_status !== 'official') {
      wx.showToast({ title: '仅正式会员可提交转卡申请', icon: 'none' });
      return;
    }
    const storeList = app.globalData.storeList || this.data.storeList || [];
    const userStoreId = userInfo.store_id;
    const filteredStores = storeList.filter(s => String(s._id) !== String(userStoreId));
    if (filteredStores.length === 0) {
      wx.showToast({ title: '暂无可转入的门店', icon: 'none' });
      return;
    }
    this.setData({
      showTransferModal: true,
      transferStoreList: filteredStores,
      transferStoreId: '',
      transferReason: ''
    });
    this._updatePullDownRefresh();
  },

  onCloseTransferModal() {
    this.setData({ showTransferModal: false });
    this._updatePullDownRefresh();
  },

  onTransferStoreSelect(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({ transferStoreId: id });
  },

  onTransferReasonInput(e) {
    this.setData({ transferReason: e.detail.value });
  },

  onSubmitTransfer() {
    const { transferStoreId, transferReason } = this.data;
    if (!transferStoreId) {
      wx.showToast({ title: '请选择目标门店', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '提交中...' });
    request({
      url: '/transfers',
      method: 'POST',
      data: { to_store_id: transferStoreId, reason: transferReason }
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '转卡申请已提交，等待审核', icon: 'success' });
      this.setData({ showTransferModal: false });
      this._updatePullDownRefresh();
    }).catch(err => {
      wx.hideLoading();
      const errMsg = err.message || err.data?.message || '提交失败';
      wx.showToast({ title: errMsg, icon: 'none' });
    });
  },

  onAbout() {
    wx.showModal({
      title: '关于系统',
      content: '舞栖舞蹈社会员预约系统 V1.0.0\n\n为您提供课程预约、教练查看、会员签到等一站式舞蹈学习服务。\n\n如有疑问请联系门店客服。',
      showCancel: false,
      confirmText: '我知道了',
      confirmColor: '#D4786E'
    });
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  onContactStore() {
    var phoneNumber = this.data.storePhone;
    if (phoneNumber) {
      wx.makePhoneCall({ phoneNumber: phoneNumber }).catch(function(err) {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) {
          return;
        }
        wx.showToast({ title: '拨号失败，请重试', icon: 'none' });
      });
      return;
    }
    var storeList = app.globalData.storeList || [];
    if (storeList.length > 0) {
      var phone = storeList[0].phone;
      if (phone) {
        wx.makePhoneCall({ phoneNumber: phone }).catch(function(err) {
          if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
          wx.showToast({ title: '拨号失败，请重试', icon: 'none' });
        });
        return;
      }
    }
    wx.showToast({ title: '暂无门店联系电话', icon: 'none' });
  },

  onChangePhone() {
    this.onShowChangePhoneModal();
  },

  onShowQRCode() {
    this.setData({ showQRModal: true, showCheckInSuccess: false });
    this._updatePullDownRefresh();
    this.generateDynamicToken();
    this.startCheckInPolling();
  },

  onCloseQRModal() {
    this.setData({ showQRModal: false });
    this._updatePullDownRefresh();
    this.stopQRRefresh();
    this.stopCheckInPolling();
  },

  startCheckInPolling() {
    this.stopCheckInPolling();
    var userInfo = this.data.userInfo || {};
    var userId = userInfo._id || '';
    if (!userId) return;

    this._checkInPollTimer = setInterval(function() {
      request({
        url: '/bookings/check-in-status/' + userId,
        silent: true,
        timeout: 5000
      }).then(function(res) {
        if (res.data && res.data.checked_in && res.data.courses && res.data.courses.length > 0) {
          this.stopCheckInPolling();
          var courses = res.data.courses.map(function(c) {
            return {
              course_name: c.course_name || '课程',
              time: (c.start_time || '') + (c.end_time ? ' - ' + c.end_time : ''),
              source: c.source === 'onsite' ? '现场签到' : '正常签到'
            };
          });
          this.setData({
            showCheckInSuccess: true,
            checkInCourses: courses
          });
          this._updatePullDownRefresh();
          if (this.data.checkInAutoCloseTimer) clearTimeout(this.data.checkInAutoCloseTimer);
          var timer = setTimeout(function() {
            this.onCloseCheckInSuccess();
          }.bind(this), 3000);
          this.setData({ checkInAutoCloseTimer: timer });
        }
      }.bind(this)).catch(function(err) {
        console.error('签到状态轮询失败:', err);
      });
    }.bind(this), 2000);
  },

  stopCheckInPolling() {
    if (this._checkInPollTimer) {
      clearInterval(this._checkInPollTimer);
      this._checkInPollTimer = null;
    }
  },

  onCloseCheckInSuccess() {
    if (this.data.checkInAutoCloseTimer) {
      clearTimeout(this.data.checkInAutoCloseTimer);
    }
    this.setData({
      showCheckInSuccess: false,
      checkInCourses: [],
      checkInAutoCloseTimer: null
    });
    this._updatePullDownRefresh();
  },

  generateDynamicToken() {
    this.stopQRRefresh();
    request({
      url: '/qrcode/qrcode-token',
      method: 'GET'
    }).then(function(res) {
      if (res.data && res.data.token) {
        const encryptedToken = res.data.token;
        this.setData({
          qrDynamicToken: encryptedToken,
          qrCodeToken: encryptedToken,
          qrCountdown: this.data.qrExpireSeconds,
          qrCodeUrl: ''
        });
        // 使用 Canvas 生成二维码（包含 JSON 数据，不依赖外部 URL）
        this.drawQRCodeToCanvas(encryptedToken);
      }
      this.startCountdown();
      this.qrRefreshTimer = setInterval(function() {
        this.generateDynamicToken();
      }.bind(this), this.data.qrExpireSeconds * 1000);
    }.bind(this)).catch(function(err) {
      console.error('获取二维码token失败:', err);
      this.setData({ qrCountdown: this.data.qrExpireSeconds, qrCodeUrl: '', qrCodeToken: '' });
      this.startCountdown();
      this.qrRefreshTimer = setInterval(function() {
        this.generateDynamicToken();
      }.bind(this), this.data.qrExpireSeconds * 1000);
    }.bind(this));
  },

  // 使用 Canvas 2D API 绘制二维码（weapp-qrcode-canvas-2d 库）
  drawQRCodeToCanvas(encryptedToken) {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery();
      query.select('#qrCheckInCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            console.error('Canvas 节点未找到，重试');
            setTimeout(() => {
              this.drawQRCodeToCanvas(encryptedToken);
            }, 150);
            return;
          }
          const canvas = res[0].node;
          const canvasW = res[0].width;

          drawQrcode({
            canvas: canvas,
            canvasId: 'qrCheckInCanvas',
            text: encryptedToken,
            width: canvasW,
            padding: 12,
            typeNumber: -1,
            correctLevel: 0,
            background: '#ffffff',
            foreground: '#2A2122'
          });
        });
    });
  },



  startCountdown() {
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this._countdownTimer = setInterval(function() {
      var countdown = this.data.qrCountdown - 1;
      if (countdown <= 0) {
        clearInterval(this._countdownTimer);
        return;
      }
      this.setData({ qrCountdown: countdown });
    }.bind(this), 1000);
  },

  stopQRRefresh() {
    if (this.qrRefreshTimer) {
      clearInterval(this.qrRefreshTimer);
      this.qrRefreshTimer = null;
    }
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  

  onShowChangePhoneModal() {
    this.setData({
      showChangePhoneModal: true,
      newPhone: ''
    });
    this._updatePullDownRefresh();
  },

  onCloseChangePhoneModal() {
    this.setData({ showChangePhoneModal: false });
    this._updatePullDownRefresh();
  },

  onNewPhoneInput(e) {
    this.setData({ newPhone: e.detail.value });
  },

  onSubmitChangePhone() {
    var newPhone = this.data.newPhone;

    if (!newPhone || newPhone.length !== 11) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    if (!/^1[3-9]\d{9}$/.test(newPhone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' });
      return;
    }

    // 请求审核结果订阅授权
    try {
      const { fetchTemplates, requestPhoneAuditSubscribe } = require('../../utils/subscribe-message');
      fetchTemplates().then(() => requestPhoneAuditSubscribe()).catch(function(e) {
        console.log('[Profile] 请求审核订阅授权失败:', e.message);
      });
    } catch (e) {
      console.log('[Profile] 请求审核订阅授权失败:', e.message);
    }

    wx.showLoading({ title: '提交中...' });

    var requestModule = require('../../utils/request');

    requestModule({
      url: '/members/reserve-phone/request',
      method: 'POST',
      data: { new_phone: newPhone }
    }).then(function() {
      wx.hideLoading();
      wx.showToast({ title: '已提交审核，请等待', icon: 'success' });
      this.setData({ showChangePhoneModal: false });
      this._updatePullDownRefresh();
    }.bind(this)).catch(function(err) {
      wx.hideLoading();
      var msg = err.data && err.data.message || '提交失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  onImgError(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    if (!type || !id) return;
    var key = type + '_' + id;
    var updates = {};
    updates['imageErrors.' + key] = true;
    if (type === 'avatar' && id === 'user') {
      updates.avatarImageError = true;
      updates.avatarSrc = '/images/default-avatar.svg';
    }
    this.setData(updates);
  },

  onHandleTouchStart(e) {
    this._handleStartY = e.touches[0].clientY;
    this.setData({ sheetDragging: true });
  },

  onHandleTouchMove(e) {
    const currentY = e.touches[0].clientY;
    const diffY = currentY - this._handleStartY;
    // 只允许向下拖拽，向上不响应
    if (diffY > 0) {
      // 加阻尼：拖拽距离越大越费力
      const dampedY = diffY * 0.6;
      this.setData({ sheetDragY: dampedY });
    }
  },

  onHandleTouchEnd() {
    const dragY = this.data.sheetDragY;
    // 拖拽超过 100px 关闭弹窗，否则回弹
    if (dragY > 100) {
      this.setData({ sheetDragY: 0, sheetDragging: false });
      this.onClosePackageDetail();
    } else {
      this.setData({ sheetDragY: 0, sheetDragging: false });
    }
  },

  preventTouchMove() {
    return;
  }
});