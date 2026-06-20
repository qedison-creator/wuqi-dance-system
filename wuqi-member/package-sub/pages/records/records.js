const app = getApp();
const { request } = require('../../../utils/request');
const { formatDate, getWeekDay } = require('../../../utils/util');
const { checkLogin } = require('../../../utils/auth');
const auth = require('../../../utils/auth');

const SOURCE_LABEL_MAP = {
  member: '正常签到',
  booking: '正常签到',
  onsite: '现场签到',
  admin: '后台签到'
};

const CHECK_IN_METHOD_LABEL_MAP = {
  scan: '扫码签到',
  auto: '自动签到'
};

const CANCEL_TYPE_MAP = {
  normal: '正常取消',
  exempt: '豁免取消',
  admin_cancel: '管理员取消',
  min_bookings_not_met: '人数不足取消',
  holiday: '放假取消'
};

// 预约记录页默认展开显示的条数
const DEFAULT_VISIBLE_COUNT = 5;

Page({
  data: {
    activeTab: 'booking',
    records: [],
    loading: true,
    page: 1,
    hasMore: true,
    // 预约记录页：默认展开显示最新5条，其余收起
    bookingExpanded: false,
    bookingVisibleCount: DEFAULT_VISIBLE_COUNT,
    // 上课记录页：同样默认展开5条
    attendanceExpanded: false,
    attendanceVisibleCount: DEFAULT_VISIBLE_COUNT
  },

  onLoad(options) {
    if (!auth.requireLogin()) return;

    // 等待 App 初始化完成（getUserInfo 可能尚未返回）
    const initPromise = app.globalData._initPromise;
    const doLoad = () => {
      if (options.tab) {
        const tab = options.tab;
        if (tab === 'attendance' || tab === 'class') {
          this.setData({ activeTab: 'attendance' });
        } else if (tab === 'waitlist') {
          this.setData({ activeTab: 'waitlist' });
        } else {
          this.setData({ activeTab: 'booking' });
        }
      }
      this.loadRecords();
      this._initialized = true; // 标记已初始化，避免 onShow 重复加载
    };

    const result = auth.requireMember(doLoad);
    // requireMember 可能返回 Promise（等待 initPromise）或 boolean
    if (result && result.then) {
      result.then(success => {
        if (!success) this._initialized = true; // 鉴权失败也标记，避免 onShow 重复拦截
      });
    }
  },

  onShow() {
    if (!checkLogin()) return;
    const userInfo = app.globalData.userInfo || {};
    if (userInfo.member_status !== 'official') return;

    // onLoad 已初始化过则跳过（避免首次进入重复请求）
    if (this._initialized) {
      this._initialized = false;
      return;
    }
    // 后续热启动时正常刷新
    this.setData({ page: 1, hasMore: true });
    this.loadRecords();
  },

  loadRecords() {
    this.setData({ loading: true });
    const tab = this.data.activeTab;

    if (tab === 'waitlist') {
      this.loadWaitlistRecords();
      return;
    }

    const isAttendanceTab = tab === 'attendance';
    const url = isAttendanceTab ? '/attendance/my' : '/bookings/my';
    const params = { page: this.data.page, pageSize: 10 };

    if (tab === 'booking') {
      // 预约记录：同时展示已预约 + 已取消的记录（合并显示）
      // 不传 type 参数，让后端返回所有 booked + cancelled 记录
      // 后端 /bookings/my 不传 type 时返回所有记录，前端按时间倒序混合展示
      params.type = 'all';
    }

    request({ url, data: params }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (res.data || []);
      const newRecords = list.map(item => {
        const schedule = item.schedule_id;
        const base = {
          ...item,
          scheduleId: schedule ? schedule._id : '',
          dateStr: schedule ? formatDate(schedule.date, 'YYYY-MM-DD') : (item.date ? formatDate(item.date, 'YYYY-MM-DD') : ''),
          weekDayStr: schedule ? getWeekDay(schedule.date) : (item.date ? getWeekDay(item.date) : ''),
          courseName: schedule ? (schedule.course_name || item.course_name || '课程') : (item.course_name || '课程'),
          startTime: schedule ? (schedule.start_time || '') : '',
          endTime: schedule ? (schedule.end_time || '') : '',
          coachName: schedule && schedule.coach_id ? schedule.coach_id.name : (item.coach_id && item.coach_id.name ? item.coach_id.name : '教练'),
          storeName: schedule && schedule.store_id ? schedule.store_id.name : (item.store_id && item.store_id.name ? item.store_id.name : '')
        };

        if (isAttendanceTab) {
          base.checkInMethod = item.check_in_method || 'scan';
          base.sourceLabel = CHECK_IN_METHOD_LABEL_MAP[base.checkInMethod] || SOURCE_LABEL_MAP[item.source] || '签到';
          base.checkInTime = item.check_in_time ? formatDate(item.check_in_time, 'HH:mm') : '';
          base.creditsCost = item.credits_cost || 0;
        }

        if (tab === 'booking') {
          // 预约记录页：已取消的记录显示取消类型文案
          if (item.status === 'cancelled') {
            base.cancelTypeLabel = item.cancel_type ? (CANCEL_TYPE_MAP[item.cancel_type] || '已取消') : '已取消';
            base.cancelTime = item.cancelled_at ? formatDate(item.cancelled_at, 'YYYY-MM-DD HH:mm') : (item.updated_at ? formatDate(item.updated_at, 'YYYY-MM-DD HH:mm') : '');
          }
        }

        // 用于排序的时间戳（兼容 iOS：new Date 只接受特定格式，这里转为标准格式）
        base._sortTime = this._getSortTime(item, base.cancelTime);

        return base;
      });

      // 预约记录页：按时间倒序混合排序（已预约 + 已取消一起显示）
      let sortedRecords = newRecords;
      if (tab === 'booking') {
        sortedRecords = newRecords.sort((a, b) => (b._sortTime || 0) - (a._sortTime || 0));
      }

      const records = this.data.page === 1 ? sortedRecords : this.data.records.concat(sortedRecords);
      this.setData({
        records,
        loading: false,
        hasMore: sortedRecords.length >= 50
      });
    }).catch((err) => {
      console.error('加载记录失败:', err);
      this.setData({ loading: false });
    });
  },

  loadWaitlistRecords() {
    request({ url: '/bookings/waitlist/my' }).then(res => {
      const rawList = res.data && res.data.data ? res.data.data : (res.data || []);
      const list = Array.isArray(rawList) ? rawList : [];
      const records = list.map(item => {
        const schedule = item.schedule_id;
        return {
          _id: item._id,
          status: item.status,
          position: item.position || '-',
          courseName: schedule ? (schedule.course_name || '课程') : '课程',
          dateStr: schedule ? formatDate(schedule.date, 'YYYY-MM-DD') : '',
          weekDayStr: schedule ? getWeekDay(schedule.date) : '',
          startTime: schedule ? (schedule.start_time || '') : '',
          endTime: schedule ? (schedule.end_time || '') : '',
          coachName: schedule && schedule.coach_id ? schedule.coach_id.name : '教练',
          storeName: schedule && schedule.store_id ? schedule.store_id.name : '门店'
        };
      });
      this.setData({ records, loading: false, hasMore: false });
    }).catch((err) => {
      console.error('加载排队记录失败:', err);
      this.setData({ records: [], loading: false });
    });
  },

  onCancelWaitlistTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '取消候补',
      content: '确认取消排队？取消后将失去当前位置。',
      confirmColor: '#D4786E',
      success: (res) => {
        if (res.confirm) {
          request({
            url: `/bookings/waitlist/${id}`,
            method: 'DELETE'
          }).then(() => {
            wx.showToast({ title: '已取消', icon: 'success' });
            this.loadRecords();
          }).catch((err) => {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 获取用于排序的时间戳，兼容 iOS 不支持 new Date('yyyy-MM-dd HH:mm') 的问题
  _getSortTime(item, cancelTimeStr) {
    if (cancelTimeStr) {
      return new Date(cancelTimeStr.replace(' ', 'T')).getTime();
    }
    if (item.created_at) {
      return new Date(item.created_at.replace(' ', 'T')).getTime();
    }
    if (item.updated_at) {
      return new Date(item.updated_at.replace(' ', 'T')).getTime();
    }
    return 0;
  },

  onTabChange(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ activeTab: tab, page: 1, hasMore: true });
    this.loadRecords();
  },

  // 展开/收起预约记录
  onToggleBookingExpand() {
    this.setData({
      bookingExpanded: !this.data.bookingExpanded,
      bookingVisibleCount: !this.data.bookingExpanded ? 9999 : DEFAULT_VISIBLE_COUNT
    });
  },

  // 展开/收起上课记录
  onToggleAttendanceExpand() {
    this.setData({
      attendanceExpanded: !this.data.attendanceExpanded,
      attendanceVisibleCount: !this.data.attendanceExpanded ? 9999 : DEFAULT_VISIBLE_COUNT
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && this.data.activeTab !== 'waitlist') {
      this.setData({ page: this.data.page + 1 });
      this.loadRecords();
    }
  }
});