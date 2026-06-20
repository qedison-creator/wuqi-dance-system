const { request } = require('../../../utils/request');
const { formatDate } = require('../../../utils/util');
const { checkLogin } = require('../../../utils/auth');
const auth = require('../../../utils/auth');
const app = getApp();

Page({
  data: {
    packages: [],
    loading: true,
    activateLoading: false
  },
  
  onLoad() {
    if (!auth.requireLogin()) return;
    auth.requireMember(() => {
      this.loadPackage();
    });
  },

  onShow() {
    if (!checkLogin()) return;
    const userInfo = app.globalData.userInfo || {};
    if (userInfo.member_status !== 'official') return;
    this.loadPackage();
  },
  
  loadPackage() {
    this.setData({ loading: true });
    request({
      url: '/packages/my',
      method: 'GET'
    }).then(res => {
      const packages = [];
      const packageIds = new Set();
      
      if (res.data.current) {
        const currentPkg = { ...res.data.current, isCurrent: true };
        if (res.data.timeCardUsage && currentPkg.package_type === 'time_card') {
          currentPkg.timeCardUsage = res.data.timeCardUsage;
        }
        packages.push(currentPkg);
        packageIds.add(currentPkg._id);
      }
      
      if (res.data.history && res.data.history.length > 0) {
        res.data.history.forEach(pkg => {
          if (!packageIds.has(pkg._id)) {
            packages.push({ ...pkg, isCurrent: false });
            packageIds.add(pkg._id);
          }
        });
      }
      
      // 格式化日期显示并计算剩余天数
      packages.forEach(pkg => {
        if (pkg.start_date) {
          pkg.start_date_display = this.formatDateFn(pkg.start_date);
        }
        if (pkg.end_date) {
          pkg.end_date_display = this.formatDateFn(pkg.end_date);
          // 已激活的套餐计算剩余天数（包括已过期的，用于显示"已超X天"）
          if (pkg.is_activated && !pkg.is_suspended) {
            const now = new Date();
            const end = new Date(pkg.end_date);
            const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
            pkg.remaining_days = diff;
            // 动态修正：已激活但有效期已过的，标记为已过期
            if (diff < 0 && pkg.status === 'active') {
              pkg._displayStatus = 'expired';
            }
          }
        }
      });
      
      this.setData({
        packages,
        loading: false
      });
    }).catch(err => {
      this.setData({ loading: false });
    });
  },

  // 激活套餐
  onActivateTap(e) {
    const pkg = e.currentTarget.dataset.pkg;
    wx.showModal({
      title: '确认激活',
      content: `确认激活套餐吗？激活后将开始计算有效期。`,
      confirmColor: '#D4786E',
      success: (res) => {
        if (res.confirm) {
          this.doActivate(pkg);
        }
      }
    });
  },

  doActivate(pkg) {
    // 请求套餐相关订阅授权
    try {
      const { fetchTemplates, requestPackageSubscribe } = require('../../../utils/subscribe-message');
      fetchTemplates().then(() => requestPackageSubscribe()).catch(e => {
        console.log('[PackageDetail] 请求套餐订阅授权失败:', e.message);
      });
    } catch (e) {
      console.log('[PackageDetail] 请求套餐订阅授权失败:', e.message);
    }

    this.setData({ activateLoading: true });
    request({
      url: '/packages/activate',
      method: 'PUT'
    }).then(() => {
      this.setData({ activateLoading: false });
      wx.showToast({ title: '激活成功', icon: 'success' });
      this.loadPackage();
    }).catch(err => {
      this.setData({ activateLoading: false });
      const msg = err.data && err.data.message || '激活失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  // 获取状态显示
  getStatusText(status) {
    const map = {
      'pending': '待激活',
      'active': '使用中',
      'expired': '已过期',
      'depleted': '已用完',
      'paused': '已暂停'
    };
    return map[status] || status;
  },

  // 格式化日期
  formatDateFn(date) {
    if (!date) return '-';
    return formatDate(date, 'YYYY-MM-DD');
  }
});