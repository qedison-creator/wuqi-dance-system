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
    // 皮肤状态（纯前端偏好，仅影响外观）
    const skin = require('../../../utils/skin.js');
    this.setData(skin.pageState());
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
          // 北京日历日口径（与后端 timeUtil.diffDays 一致，含到期日当天：到期日剩余 1 天）
          if (pkg.is_activated && !pkg.is_suspended) {
            const bjDay = (d) => new Date(new Date(d).getTime() + 8 * 60 * 60 * 1000).toISOString().split('T')[0];
            const diff = Math.round((new Date(bjDay(pkg.end_date)) - new Date(bjDay(new Date()))) / (1000 * 60 * 60 * 24)) + 1;
            pkg.remaining_days = diff;
            // 动态修正：有效期已过（剩余 < 1）标为已过期；被时刻口径错标过期的（剩余 ≥ 1）恢复为有效
            if (diff < 1 && pkg.status === 'active') {
              pkg._displayStatus = 'expired';
            } else if (diff >= 1 && pkg.status === 'expired') {
              pkg._displayStatus = 'active';
            }
          }
        }
        // 停卡/冻结说明
        if (pkg.is_suspended) {
          pkg._suspendNote = pkg.suspend_type === 'freeze'
            ? '权益冻结中 · 有效期暂停，解冻后按实际冻结天数补回'
            : '停卡中 · 有效期暂停，复卡后继续';
          if (pkg.suspend_type !== 'freeze' && pkg.suspend_end_date) {
            const sd = new Date(pkg.suspend_end_date);
            const sy = sd.getFullYear();
            const sm = String(sd.getMonth() + 1).padStart(2, '0');
            const sday = String(sd.getDate()).padStart(2, '0');
            pkg._suspendNote = `停卡中 · 有效期暂停，预计 ${sy}-${sm}-${sday} 自动复卡`;
          }
        }
        // 舞种限制展示文本：populate 后是 [{_id, name}]，空数组=不限舞种
        var dsl = Array.isArray(pkg.dance_style_limit) ? pkg.dance_style_limit : [];
        if (dsl.length > 0) {
          pkg._danceStyleLimitText = dsl.map(function(ds) { return (ds && ds.name) ? ds.name : ''; }).filter(Boolean).join('、');
        } else {
          pkg._danceStyleLimitText = '';
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
      confirmColor: require('../../../utils/skin.js').confirmColor(),
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