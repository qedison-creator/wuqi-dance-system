const app = getApp();
const { request } = require('../../utils/request');
const { requireLogin, checkLogin } = require('../../utils/auth');
const config = require('../../config/index.js');
const drawQrcode = require('../../utils/weapp.qrcode');
const wsClient = require('../../utils/websocket-client');


Page({
  data: {
    userInfo: null,
    isLoggedIn: false,
    isOfficialMember: false,
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
    statsReady: false,
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
    // 签到状态分层反馈：二维码下方文案区域（非结果类状态）
    checkInStatusText: '',        // 状态提示文案
    checkInStatusType: '',        // 状态类型：scanned/view_only/timeout/checking
    checkInStatusTimer: null,     // 状态自动消失定时器
    // 签到失败弹窗
    showCheckInFailed: false,
    checkInFailedText: '',
    checkInFailedCanRetry: true,
    // 套餐恢复提示
    packageResumedText: '',
    // 版本号防乱序 + event_id 去重
    lastCheckInVersion: 0,
    processedEventIds: {},
    showChangePhoneModal: false,
    newPhone: '',
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
    showLoginModal: false,
    // 会员身份：'new' 新会员 / 'old' 老会员（后端 member_identity 字段，默认 'new'）
    member_identity: 'new',
    // 是否为预建档会员（有 reserve_phone 且无 phone），用于跳过强制完善信息提示
    isPreRegistered: false,
    // 头像选择面板
    showAvatarSheet: false
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
    // 加入当天计为 1 天
    return Math.max(1, diffBeijingDays(baseDate, now) + 1);
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
    this._disconnectCheckInWebSocket();
    this._clearCheckInStatusTimer();
    this._clearCheckInAutoClose();
  },

  onUnload() {
    this.stopQRRefresh();
    this.stopCheckInPolling();
    this._disconnectCheckInWebSocket();
    this._clearCheckInStatusTimer();
    this._clearCheckInAutoClose();
  },

  // 根据弹窗状态动态开关下拉刷新
  _isAnyModalOpen() {
    return this.data.showPackageDetail || this.data.showQRModal
      || this.data.showForceProfileModal || this.data.showStorePicker
      || this.data.showChangePhoneModal
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
    }
  },

  onPullDownRefresh() {
    this.loadUserData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  checkLoginStatus() {
    if (checkLogin()) {
          const userInfo = app.globalData && app.globalData.userInfo ? app.globalData.userInfo : {};
          var avatarSrc = userInfo.avatar || userInfo.avatar_url || '/images/default-avatar.svg';
          // 是否为正式会员（已审核通过），控制头像更换、名称显示等
          const isOfficialMember = userInfo.member_status === 'official';
          this.setData({
            isLoggedIn: true,
            userInfo: userInfo,
            isOfficialMember: isOfficialMember,
            memberSinceDays: this.getMemberSinceDays(userInfo, this.data.packages),
            avatarSrc: avatarSrc,
            avatarImageError: false
          });
          this.loadUserData();
        } else {
      this.setData({ isLoggedIn: false, userInfo: null, isOfficialMember: false, memberSinceDays: 0, avatarSrc: '/images/default-avatar.svg', avatarImageError: false });
    }
  },

  async loadUserData() {
    try {
      // 并行请求所有接口，单个失败不影响其他请求，最后统一 setData 减少渲染次数
      const [packageRes, bookingRes, completedRes, meRes] = await Promise.all([
        request({ url: '/packages/my' }).catch(err => { console.error('加载套餐信息失败:', err); return null; }),
        request({ url: '/bookings/my?type=booking' }).catch(err => { console.error('加载预约统计失败:', err); return null; }),
        request({ url: '/bookings/my?type=completed' }).catch(err => { console.error('加载上课统计失败:', err); return null; }),
        request({ url: '/auth/me' }).catch(err => { console.error('加载用户信息失败:', err); return null; })
      ]);

      const finalData = {};

      // 处理套餐数据
      if (packageRes && packageRes.data) {
        var packages = [];
        var packageIds = {};

        if (packageRes.data.current) {
          var currentPkg = {};
          var keys = Object.keys(packageRes.data.current);
          for (var i = 0; i < keys.length; i++) {
            currentPkg[keys[i]] = packageRes.data.current[keys[i]];
          }
          packages.push(currentPkg);
          packageIds[currentPkg._id] = true;
        }

        if (packageRes.data.history && packageRes.data.history.length > 0) {
          packageRes.data.history.forEach(function(pkg) {
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
            // 激活的套餐计算剩余天数（含停卡套餐，停卡时end_date已顺延，剩余天数保持冻结值）
            if (pkg.is_activated && pkg.status === 'active') {
              var now = new Date();
              var end = new Date(pkg.end_date);
              if (now <= end) {
                var diff = diffBeijingDays(now, end);
                pkg.remaining_days = Math.max(0, diff);
              }
            }
          }
        });

        var currentPkg = packageRes.data.current;
        var remainingClasses = 0;
        if (currentPkg) {
          if (currentPkg.package_type === 'count_card') {
            remainingClasses = currentPkg.remaining_credits || 0;
          } else if (currentPkg.package_type === 'time_card') {
            var usage = packageRes.data.timeCardUsage;
            if (usage) {
              remainingClasses = usage.weekly_remaining !== null ? usage.weekly_remaining : (usage.daily_remaining !== null ? usage.daily_remaining : -1);
            } else {
              remainingClasses = currentPkg.daily_limit || currentPkg.weekly_limit || -1;
            }
          }
        }

        if (packageRes.data.timeCardUsage && currentPkg && currentPkg.package_type === 'time_card') {
          var idx = -1;
          for (var j = 0; j < packages.length; j++) {
            if (packages[j]._id === currentPkg._id) {
              idx = j;
              break;
            }
          }
          if (idx >= 0) {
            packages[idx].timeCardUsage = packageRes.data.timeCardUsage;
          }
        }

        var hasPackage = packages && packages.length > 0;
        var userInfo = this.data.userInfo;
        var canChangeStore = !(hasPackage && userInfo && userInfo.member_status === 'official');
        var memberStatus = this.computeMemberStatus(userInfo, packages);

        finalData.packages = packages;
        finalData.canChangeStore = canChangeStore;
        finalData.stats = {
          remainingClasses: remainingClasses,
          totalBookings: 0,
          completedClasses: 0
        };

        if (userInfo) {
          finalData.memberSinceDays = this.getMemberSinceDays(userInfo, packages);
        }

        Object.assign(finalData, this._processPackageGroups(packages, memberStatus));
      } else if (packageRes === null) {
        finalData.packages = [];
        finalData.allPackages = [];
        finalData.currentPackage = null;
        finalData.pendingPackages = [];
        finalData.historyPackages = [];
      }

      // 处理预约统计
      finalData['stats.totalBookings'] = bookingRes && bookingRes.data && bookingRes.data.list ? bookingRes.data.list.length : 0;
      finalData['stats.completedClasses'] = completedRes && completedRes.data && completedRes.data.list ? completedRes.data.list.length : 0;

      // 处理用户信息
      if (meRes && meRes.data) {
        var userInfo = meRes.data;
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

        // 会员身份（'new'/'old'，默认 'new'）
        var memberIdentity = userInfo.member_identity === 'old' ? 'old' : 'new';
        // 预建档会员：有 reserve_phone 且无 phone
        var isPreRegistered = !!(userInfo.reserve_phone && !userInfo.phone);

        // 同步 isOfficialMember 和 avatarSrc（/auth/me 返回的是 avatar_url）
        var isOfficialMember = userInfo.member_status === 'official';
        var avatarSrc = userInfo.avatar || userInfo.avatar_url || '/images/default-avatar.svg';

        Object.assign(finalData, {
          userInfo: userInfo,
          isOfficialMember: isOfficialMember,
          avatarSrc: avatarSrc,
          avatarImageError: false,
          profileForm: profileForm,
          storePhone: storePhone,
          memberSinceDays: memberSinceDays,
          memberStatus: memberStatus,
          phoneAuditStatus: userInfo.phone_audit_status || 'none',
          phoneAuditPendingPhone: userInfo.phone_audit_pending || '',
          member_identity: memberIdentity,
          isPreRegistered: isPreRegistered
        });

        if (!storePhone && storeId) {
          this.loadStorePhone(storeId);
        }
        app.globalData.userInfo = userInfo;

        // 检查是否需要完善个人信息
        this._checkForceProfile(profileForm, userInfo);
      }

      // 合并 stats（优先使用接口返回的统计数据）
      if (finalData.stats) {
        finalData.stats.totalBookings = finalData['stats.totalBookings'] !== undefined ? finalData['stats.totalBookings'] : this.data.stats.totalBookings;
        finalData.stats.completedClasses = finalData['stats.completedClasses'] !== undefined ? finalData['stats.completedClasses'] : this.data.stats.completedClasses;
      }

      // 一次性设置所有页面数据，大幅减少渲染层通信次数
      this.setData(Object.assign(finalData, { statsReady: true }));
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
            if (pkg.is_activated && pkg.status === 'active') {
              var now = new Date();
              var end = new Date(pkg.end_date);
              if (now <= end) {
                var diff = diffBeijingDays(now, end);
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

    // 预建档会员（有 reserve_phone 且无 phone）跳过强制完善信息弹窗
    if (userInfo.reserve_phone && !userInfo.phone) {
      this.setData({ showForceProfileModal: false });
      return;
    }

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
      // 重新检查登录状态，同步 isOfficialMember 和 userInfo
      this.checkLoginStatus();
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

  // 返回套餐分组数据，由调用方统一 setData，避免多次触发渲染
  _processPackageGroups(packages, memberStatus) {
    if (!memberStatus) memberStatus = 'disabled';
    if (!packages || !packages.length) {
      return {
        allPackages: [],
        currentPackage: null,
        activePackages: [],
        pendingPackages: [],
        historyPackages: [],
        currentPackageType: '',
        memberStatusText: memberStatus === 'active' ? '正式会员' : (memberStatus === 'suspended' ? '已停卡' : '待激活')
      };
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

      // 跨店标识：extra_store_ids 非空表示可跨店使用
      pkg._crossStore = Array.isArray(pkg.extra_store_ids) && pkg.extra_store_ids.length > 0;

      // 套餐类型标签（简短版用于标签）
      pkg._typeLabel = pkg.package_type === 'time_card' ? '时间卡' : '次卡';
      
      // 状态文案（情绪价值表达，无emoji）      // 动态修正：已激活但有效期已过的，标记为已过期
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
        pkg._statusText = '已满员';
      }

      // 预计算常用展示字段，减少 WXML 渲染层重复计算
      pkg._durationText = (pkg.duration_value || '-') + (pkg.duration_unit === 'month' ? '个月' : '天');
      if (pkg.package_type === 'count_card') {
        pkg._totalLabel = '总次数';
        pkg._totalValue = (pkg.total_credits || 0) + ' 次';
        pkg._pendingCreditsValue = (pkg.total_credits || pkg.remaining_credits || 0) + ' 次';
      } else {
        pkg._totalLabel = '服务有效期';
        pkg._totalValue = pkg._durationText;
        pkg._pendingCreditsValue = pkg._durationText;
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

      // 进度条（停卡套餐也需展示原内容，只是暂停服务，不清零数据）
      if (pkg.is_activated && pkg.status === 'active') {
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
            // 激活/生效当日计入第1天，已用天数 = 当前日期 - 激活/生效日期 + 1
            usedDays = diffBeijingDays(start, now) + 1;
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

      // 时间卡使用情况（本周预约数
      if (pkg.package_type === 'time_card' && pkg.timeCardUsage) {
        pkg._weekUsed = pkg.timeCardUsage.weekly_used !== null ? pkg.timeCardUsage.weekly_used : pkg.timeCardUsage.daily_used;
        pkg._weekLimit = pkg.timeCardUsage.weekly_limit !== null ? pkg.timeCardUsage.weekly_limit : pkg.timeCardUsage.daily_limit;
        pkg._weekRemaining = pkg.timeCardUsage.weekly_remaining !== null ? pkg.timeCardUsage.weekly_remaining : pkg.timeCardUsage.daily_remaining;
        pkg._nextWeekUsed = pkg.timeCardUsage.next_week_used;
        pkg._nextWeekRemaining = pkg.timeCardUsage.next_week_remaining;
        pkg._periodLabel = pkg.timeCardUsage.weekly_limit ? '本周' : (pkg.timeCardUsage.daily_limit ? '今日' : '');
      }
      
      // 待激活套餐显示文案
            if (pkg.package_type === 'count_card') {
                var unitText = pkg.duration_unit === 'month' ? '个月' : '天';
                pkg._pendingCreditsText = '含' + (pkg.total_credits || pkg.remaining_credits || 0) + ' 次· 有效期' + (pkg.duration_value || '-') + unitText;
            } else {
                var unitText = pkg.duration_unit === 'month' ? '个月' : '天';
                pkg._pendingCreditsText = '有效期' + (pkg.duration_value || '-') + unitText;
            }
            
            // 历史套餐统计文本

            if (pkg.package_type === 'count_card') {
                if (pkg.total_credits) {
                    var used = pkg.total_credits - (pkg.remaining_credits || 0);
                    pkg._historyStat = '已用 ' + used + ' / 共' + pkg.total_credits + ' 次';
                } else {
                    pkg._historyStat = '剩余 ' + (pkg.remaining_credits || 0) + ' 次';
                }
            } else {
                pkg._historyStat = (pkg.start_date_display || '') + ' 至 ' + (pkg.end_date_display || '');
            }

      // 预计算动画 class 和 style
      pkg._progressFillClass = 'pkg-progress-fill pkg-progress-fill-' + pkg.status;
      pkg._progressWidthStyle = 'width: ' + (pkg._progressPercent || 0) + '%;';
      
      // 分类：使用中 / 待激活 / 历史
      // 使用中：status === 'active'，未过期，且次卡还有次数（含停卡中的套餐，停卡仅暂停非结束）
      // 过期的套餐（即使 status 仍为 active）归入历史
      const isActuallyExpired = isExpired || pkg.status === 'expired' || pkg.status === 'exhausted';
      if (pkg.status === 'active' && !isExpired) {
        activePackages.push(pkg);
      } else if (pkg.status === 'pending') {
        pendingPackages.push(pkg);
      } else if (isActuallyExpired) {
        // 历史：expired / 过期的active / 用完的active / exhausted
        historyPackages.push(pkg);
      } else {
        // 兜底：其他非常规状态也归入历史，避免丢失显示
        historyPackages.push(pkg);
      }
    });

    // currentPackage取第一个active（兼容旧逻辑）
    if (activePackages.length > 0) {
      currentPackage = activePackages[0];
    }

    // 汇总所有可用套餐类型，避免多套餐时只显示一个造成误解
    var currentPackageType = '';
    if (activePackages.length > 0) {
      var typeCount = {};
      activePackages.forEach(function(pkg) {
        var typeName = pkg.package_type === 'time_card' ? '时间卡' : '次卡';
        typeCount[typeName] = (typeCount[typeName] || 0) + 1;
      });
      var parts = Object.keys(typeCount).map(function(typeName) {
        var count = typeCount[typeName];
        return count > 1 ? typeName + ' ×' + count : typeName;
      });
      currentPackageType = parts.join('、');
    }

    return {
      allPackages: packages,
      currentPackage: currentPackage,
      activePackages: activePackages,
      pendingPackages: pendingPackages,
      historyPackages: historyPackages,
      currentPackageType: currentPackageType,
      memberStatusText: memberStatus === 'active' ? '正式会员' : (memberStatus === 'suspended' ? '已停卡' : '待激活')
    };
  },

  // 兼容旧调用：直接 setData
  processPackageGroups(packages, memberStatus) {
    this.setData(this._processPackageGroups(packages, memberStatus));
  },

  onPackageTap(e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    var item = null;
    if (this.data.activePackages) {
      for (var i = 0; i < this.data.activePackages.length; i++) {
        if (this.data.activePackages[i]._id === id) {
          item = this.data.activePackages[i];
          break;
        }
      }
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

  _goLogin() {
    this.setData({ showLoginModal: true });
  },

  handleGuestTap() {
    if (!checkLogin()) {
      requireLogin(() => {
        this.setData({ showLoginModal: true });
      });
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
    if (!requireLogin(() => this._goLogin())) return;
    wx.navigateTo({ url: '/package-sub/pages/member-info/member-info' });
  },

  // 审核通过后引导完善资料
  onGoSetup() {
    if (!requireLogin(() => this._goLogin())) return;
    wx.navigateTo({ url: '/package-sub/pages/member-info/member-info' });
  },

  onSubscribeSettings() {
    if (!requireLogin(() => this._goLogin())) return;
    wx.navigateTo({ url: '/package-sub/pages/subscribe-settings/subscribe-settings' });
  },

  onMyBookings() {
    if (!requireLogin(() => this._goLogin())) return;
    wx.navigateTo({ url: '/package-sub/pages/records/records' });
  },

  // 数据看板点击跳转：待上课→预约记录、已上课→上课记录
  onStatTap(e) {
    if (!requireLogin(() => this._goLogin())) return;
    const tab = e.currentTarget.dataset.tab || 'booking';
    wx.navigateTo({ url: `/package-sub/pages/records/records?tab=${tab}` });
  },

  onPrivacy() {
    wx.navigateTo({ url: '/package-sub/pages/privacy/privacy' });
  },

  onAgreement() {
    wx.navigateTo({ url: '/package-sub/pages/agreement/agreement' });
  },

  onAbout() {
    wx.navigateTo({ url: '/package-sub/pages/about/about' });
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
    this.setData({
      showQRModal: true,
      showCheckInSuccess: false,
      showCheckInFailed: false,
      checkInScanning: false,
      checkInStatusText: '',
      checkInStatusType: '',
      packageResumedText: ''
    });
    this._clearCheckInStatusTimer();
    this._clearCheckInAutoClose();
    this._updatePullDownRefresh();
    this.generateDynamicToken();
    // 优先使用 WebSocket 接收签到推送，同时保留轮询作为降级兜底
    this._connectCheckInWebSocket();
    this.startCheckInPolling();
  },

  onCloseQRModal() {
    this.setData({
      showQRModal: false,
      checkInScanning: false,
      checkInStatusText: '',
      checkInStatusType: ''
    });
    this._clearCheckInStatusTimer();
    this._updatePullDownRefresh();
    this.stopQRRefresh();
    this.stopCheckInPolling();
    this._disconnectCheckInWebSocket();
  },

  // ========== 签到 WebSocket 实时推送 ==========
  _connectCheckInWebSocket() {
    var self = this;
    wsClient.connect({
      onMessage: {
        // 管理员已扫码（非结果类状态，二维码下方文案提示）
        scanned: (data, msg) => {
          if (!self._shouldProcessMessage(msg)) return;
          self._showCheckInStatus('管理员已扫码', 'scanned', 0);
        },
        // 管理员仅查看信息（非结果类状态，5秒自动消失）
        view_only: (data, msg) => {
          if (!self._shouldProcessMessage(msg)) return;
          self._showCheckInStatus('管理员查看了你的信息', 'view_only', 5000);
        },
        // 签到超时（非结果类状态，3秒后自动重置）
        check_in_timeout: (data, msg) => {
          if (!self._shouldProcessMessage(msg)) return;
          self._showCheckInStatus('签到超时，请重新出示二维码', 'timeout', 3000);
          self.stopCheckInPolling();
          // 震动反馈
          wx.vibrateShort({ type: 'light' });
        },
        // 签到成功（结果类强弹窗，3秒自动关闭）
        check_in_success: (data, msg) => {
          if (!self._shouldProcessMessage(msg)) return;
          self.stopCheckInPolling();
          self._clearCheckInStatusTimer();
          var courses = [];
          if (data) {
            courses.push({
              course_name: data.course_name || '课程',
              time: (data.start_time || '') + (data.end_time ? ' - ' + data.end_time : ''),
              source: data.source === 'onsite' ? '现场签到' : '正常签到'
            });
          }
          self.setData({
            showCheckInSuccess: true,
            showCheckInFailed: false,
            checkInScanning: false,
            checkInCourses: courses,
            checkInStatusText: '',
            checkInStatusType: ''
          });
          self._updatePullDownRefresh();
          // 震动反馈
          wx.vibrateShort({ type: 'medium' });
          // 3秒自动关闭
          self._startCheckInAutoClose(3000);
        },
        // 签到失败（结果类强弹窗，手动关闭）
        check_in_failed: (data, msg) => {
          if (!self._shouldProcessMessage(msg)) return;
          self.stopCheckInPolling();
          self._clearCheckInStatusTimer();
          var errorText = self._mapCheckInErrorText(data);
          self.setData({
            showCheckInFailed: true,
            showCheckInSuccess: false,
            checkInScanning: false,
            checkInFailedText: errorText,
            checkInFailedCanRetry: data && data.can_retry !== false,
            checkInStatusText: '',
            checkInStatusType: ''
          });
          self._updatePullDownRefresh();
          // 震动反馈
          wx.vibrateShort({ type: 'medium' });
        },
        // 套餐恢复提示（签到成功且套餐从停卡恢复时）
        package_resumed: (data, msg) => {
          if (!self._shouldProcessMessage(msg)) return;
          self.setData({
            packageResumedText: '您的套餐已恢复使用'
          });
        }
      }
    });
  },

  /**
   * 版本号防乱序 + event_id 去重
   * 规则：版本号旧的直接丢弃；event_id 重复的直接丢弃
   */
  _shouldProcessMessage(msg) {
    if (!msg) return true;
    var version = msg.version || 0;
    var eventId = msg.event_id || '';
    // 版本号防乱序：旧消息直接丢弃
    if (version && this.data.lastCheckInVersion && version <= this.data.lastCheckInVersion) {
      return false;
    }
    // event_id 去重：重复消息直接丢弃
    if (eventId && this.data.processedEventIds[eventId]) {
      return false;
    }
    // 更新版本号和事件ID缓存
    if (version) {
      this.data.lastCheckInVersion = version;
      // 持久化版本号，供重连后 sync 使用
      try {
        wx.setStorageSync('ws_last_version', version);
      } catch (e) {}
    }
    if (eventId) {
      this.data.processedEventIds[eventId] = true;
      // 缓存上限控制（保留最近50条）
      var keys = Object.keys(this.data.processedEventIds);
      if (keys.length > 50) {
        // 删除最早的20条
        for (var i = 0; i < 20; i++) {
          delete this.data.processedEventIds[keys[i]];
        }
      }
    }
    return true;
  },

  /**
   * 显示签到状态提示（二维码下方文案区域，不遮挡二维码）
   * @param {string} text - 文案
   * @param {string} type - 状态类型
   * @param {number} duration - 自动消失时间（0表示不自动消失）
   */
  _showCheckInStatus(text, type, duration) {
    this._clearCheckInStatusTimer();
    this.setData({
      checkInStatusText: text,
      checkInStatusType: type,
      checkInScanning: type === 'scanned'
    });
    if (duration > 0) {
      var self = this;
      this.data.checkInStatusTimer = setTimeout(function() {
        // 超时状态自动重置回二维码页面
        self.setData({
          checkInStatusText: '',
          checkInStatusType: '',
          checkInScanning: false
        });
      }, duration);
    }
  },

  _clearCheckInStatusTimer() {
    if (this.data.checkInStatusTimer) {
      clearTimeout(this.data.checkInStatusTimer);
      this.data.checkInStatusTimer = null;
    }
  },

  /**
   * 签到成功弹窗自动关闭定时器
   */
  _startCheckInAutoClose(duration) {
    this._clearCheckInAutoClose();
    var self = this;
    this.data.checkInAutoCloseTimer = setTimeout(function() {
      self.onCloseCheckInSuccess();
    }, duration);
  },

  _clearCheckInAutoClose() {
    if (this.data.checkInAutoCloseTimer) {
      clearTimeout(this.data.checkInAutoCloseTimer);
      this.data.checkInAutoCloseTimer = null;
    }
  },

  /**
   * 错误码映射通俗文案
   */
  _mapCheckInErrorText(data) {
    if (!data) return '签到失败，请稍后重试';
    var code = data.error_code || '';
    var map = {
      'CREDITS_INSUFFICIENT': '套餐课时不足，请联系门店充值',
      'PACKAGE_EXPIRED': '套餐已过期，请联系门店续费',
      'PACKAGE_SUSPENDED': '套餐已停卡，请联系门店恢复',
      'COURSE_MISMATCH': '当前套餐不适用此课程',
      'STORE_MISMATCH': '当前套餐不适用此门店',
      'ALREADY_CHECKED_IN': '您已签到过本节课',
      'SCHEDULE_NOT_AVAILABLE': '课程已取消，无法签到',
      'NO_AVAILABLE_PACKAGE': '无可用套餐，请联系门店处理',
      'MEMBER_NOT_OFFICIAL': '会员身份未激活，请联系门店处理',
      'BOOKING_CANCELLED': '您已取消预约，请联系管理员重新预约',
      'UNKNOWN_ERROR': '签到失败，请稍后重试'
    };
    return map[code] || data.error_message || '签到失败，请稍后重试';
  },

  _disconnectCheckInWebSocket() {
    try {
      wsClient.disconnect();
    } catch (e) {}
  },

  startCheckInPolling() {
    this.stopCheckInPolling();
    var userInfo = this.data.userInfo || {};
    var userId = userInfo._id || '';
    if (!userId) return;

    // 轮询作为降级方案：仅在 WebSocket 未推送时兜底检测
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
            checkInScanning: false,
            checkInCourses: courses
          });
          this._updatePullDownRefresh();
        }
      }.bind(this)).catch(function(err) {});
    }.bind(this), 2000);
  },

  stopCheckInPolling() {
    if (this._checkInPollTimer) {
      clearInterval(this._checkInPollTimer);
      this._checkInPollTimer = null;
    }
  },

  onCloseCheckInSuccess() {
    this._clearCheckInAutoClose();
    this.setData({
      showCheckInSuccess: false,
      checkInCourses: [],
      checkInScanning: false,
      packageResumedText: ''
    });
    this._updatePullDownRefresh();
    // 签到成功关闭后刷新套餐数据，让会员看到课时扣减
    if (typeof this._refreshStatsAndPackages === 'function') {
      this._refreshStatsAndPackages();
    }
  },

  /**
   * 关闭签到失败弹窗（手动关闭）
   */
  onCloseCheckInFailed() {
    this.setData({
      showCheckInFailed: false,
      checkInFailedText: '',
      checkInFailedCanRetry: true
    });
    this._updatePullDownRefresh();
  },

  generateDynamicToken() {
    this.stopQRRefresh();
    var self = this;
    // 标记二维码加载中，清空旧 token 避免显示过期二维码
    this.setData({ qrCodeUrl: '', qrCodeToken: '' });

    // iPhone 网络栈偶发未就绪，采用多次重试（GET 接口安全可重试）
    var attempt = 0;
    var maxRetry = 4;

    var doRequest = function() {
      request({
        url: '/qrcode/qrcode-token',
        method: 'GET',
        silent: true,  // 静默：由本函数自行处理失败反馈，避免与加载中状态冲突
        retry: 0       // 关闭 request.js 默认重试，由本函数统一控制重试节奏
      }).then(function(res) {
        if (res.data && res.data.token) {
          const encryptedToken = res.data.token;
          self.setData({
            qrDynamicToken: encryptedToken,
            qrCodeToken: encryptedToken,
            qrCountdown: self.data.qrExpireSeconds,
            qrCodeUrl: ''
          });
          // 使用 Canvas 生成二维码（包含 JSON 数据，不依赖外部 URL）
          self.drawQRCodeToCanvas(encryptedToken);
        }
        self.startCountdown();
        self.qrRefreshTimer = setInterval(function() {
          self.generateDynamicToken();
        }, self.data.qrExpireSeconds * 1000);
      }).catch(function(err) {
        console.error('获取二维码token失败:', err);
        attempt++;
        if (attempt < maxRetry) {
          // 短延迟后重试，应对 iPhone 网络栈偶发未就绪
          setTimeout(doRequest, 1500);
          return;
        }
        // 重试耗尽：保留加载中状态，等待下一次定时刷新自动重试
        self.setData({ qrCountdown: self.data.qrExpireSeconds, qrCodeUrl: '', qrCodeToken: '' });
        self.startCountdown();
        self.qrRefreshTimer = setInterval(function() {
          self.generateDynamicToken();
        }, self.data.qrExpireSeconds * 1000);
      });
    };

    doRequest();
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

    // 审核中禁止重复提交
    if (this.data.phoneAuditStatus === 'pending') {
      wx.showToast({ title: '您已有一个待审核的申请', icon: 'none' });
      return;
    }

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
      this.setData({
        showChangePhoneModal: false,
        phoneAuditStatus: 'pending',
        phoneAuditPendingPhone: newPhone
      });
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

  // ========== 头像更换 ==========
  onHeroAvatarTap() {
    // 游客：静默，不弹任何提示
    if (!checkLogin()) return;
    // 已登录但未审核通过（非正式会员）：静默，不弹头像选择面板
    if (!this.data.isOfficialMember) return;
    this.setData({ showAvatarSheet: true });
  },

  onCloseAvatarSheet() {
    this.setData({ showAvatarSheet: false });
  },

  onSheetTap() {},

  onChooseFromCamera() {
    this.setData({ showAvatarSheet: false });
    var self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      sizeType: ['compressed'],
      success: (res) => {
        if (res.tempFiles && res.tempFiles[0]) {
          self._processAndUploadAvatar(res.tempFiles[0].tempFilePath);
        }
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
        console.error('选择图片失败:', err);
        wx.getSetting({
          success: (res) => {
            const authSetting = res.authSetting || {};
            const denied = authSetting['scope.album'] === false || authSetting['scope.camera'] === false;
            const isPrivacy = err.errMsg && err.errMsg.toLowerCase().indexOf('privacy') !== -1;
            if (denied || isPrivacy) {
              wx.showModal({
                title: '权限提示',
                content: denied ? '选择图片需要相册/相机权限，请在设置中开启后重试' : '选择图片需要您同意隐私授权，请前往设置完成授权后重试',
                confirmText: '去设置',
                cancelText: '取消',
                success: (modalRes) => { if (modalRes.confirm) wx.openSetting(); }
              });
            } else {
              wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
            }
          },
          fail: () => { wx.showToast({ title: '选择图片失败，请检查权限设置', icon: 'none' }); }
        });
      }
    });
  },

  onChooseFromAlbum() {
    this.setData({ showAvatarSheet: false });
    var self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['compressed'],
      success: (res) => {
        if (res.tempFiles && res.tempFiles[0]) {
          self._processAndUploadAvatar(res.tempFiles[0].tempFilePath);
        }
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
        console.error('选择图片失败:', err);
        wx.getSetting({
          success: (res) => {
            const authSetting = res.authSetting || {};
            const denied = authSetting['scope.album'] === false || authSetting['scope.camera'] === false;
            const isPrivacy = err.errMsg && err.errMsg.toLowerCase().indexOf('privacy') !== -1;
            if (denied || isPrivacy) {
              wx.showModal({
                title: '权限提示',
                content: denied ? '选择图片需要相册/相机权限，请在设置中开启后重试' : '选择图片需要您同意隐私授权，请前往设置完成授权后重试',
                confirmText: '去设置',
                cancelText: '取消',
                success: (modalRes) => { if (modalRes.confirm) wx.openSetting(); }
              });
            } else {
              wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
            }
          },
          fail: () => { wx.showToast({ title: '选择图片失败，请检查权限设置', icon: 'none' }); }
        });
      }
    });
  },

  _processAndUploadAvatar(filePath) {
    wx.showLoading({ title: '裁剪中...' });
    var self = this;
    wx.cropImage({
      src: filePath,
      cropScale: '1:1',
      success: (cropRes) => {
        wx.hideLoading();
        self._uploadAvatar(cropRes.tempFilePath);
      },
      fail: () => {
        wx.hideLoading();
        self._uploadAvatar(filePath);
      }
    });
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;
    this.setData({ showAvatarSheet: false });
    var self = this;
    wx.showLoading({ title: '裁剪中...' });
    wx.cropImage({
      src: avatarUrl,
      cropScale: '1:1',
      success: (cropRes) => {
        wx.hideLoading();
        self._uploadAvatar(cropRes.tempFilePath);
      },
      fail: (err) => {
        wx.hideLoading();
        console.warn('[profile] cropImage 失败，使用原图上传:', err);
        self._uploadAvatar(avatarUrl);
      }
    });
  },

  _uploadAvatar(filePath) {
    wx.showLoading({ title: '上传中...' });
    const baseUrl = (app && app.globalData && app.globalData.baseUrl) || config.baseUrl;
    const serverBase = config.serverBase;
    const token = app.globalData.token || wx.getStorageSync('token');
    var self = this;
    var attempt = 0;
    var maxRetry = 2;

    var doUpload = function() {
      wx.uploadFile({
        url: baseUrl + '/auth/avatar',
        filePath: filePath,
        name: 'avatar',
        timeout: 30000,
        header: { 'Authorization': 'Bearer ' + token },
        success: (uploadRes) => {
          wx.hideLoading();
          try {
            const data = JSON.parse(uploadRes.data);
            if (data.code === 200 && data.data && data.data.url) {
              let fullAvatarUrl = data.data.url;
              if (fullAvatarUrl.startsWith('/')) {
                fullAvatarUrl = serverBase + fullAvatarUrl;
              }
              // 同步到本地状态（同时更新 avatar 和 avatar_url，保持一致）
              if (app.globalData.userInfo) {
                app.globalData.userInfo.avatar = fullAvatarUrl;
                app.globalData.userInfo.avatar_url = fullAvatarUrl;
              }
              self.setData({
                avatarSrc: fullAvatarUrl,
                avatarImageError: false,
                'userInfo.avatar': fullAvatarUrl,
                'userInfo.avatar_url': fullAvatarUrl
              });
              wx.showToast({ title: '头像已更新', icon: 'success' });
            } else {
              wx.showToast({ title: '上传失败', icon: 'none' });
            }
          } catch (e) {
            wx.showToast({ title: '上传失败', icon: 'none' });
          }
        },
        fail: (err) => {
          attempt++;
          if (attempt < maxRetry) {
            setTimeout(doUpload, 1500);
            return;
          }
          wx.hideLoading();
          const errMsg = err && err.errMsg ? err.errMsg : '';
          const isTimeout = errMsg.indexOf('timeout') !== -1;
          wx.showToast({
            title: isTimeout ? '上传超时，请重试' : '上传失败，请检查网络后重试',
            icon: 'none'
          });
        }
      });
    };

    doUpload();
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