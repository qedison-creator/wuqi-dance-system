const app = getApp();
const { request } = require('../../utils/request');
const { formatDate, getWeekDay } = require('../../utils/util');
const { checkLogin } = require('../../utils/auth');
const auth = require('../../utils/auth');

const SOURCE_LABEL_MAP = {
  member: '正常签到',
  booking: '正常签到',
  onsite: '现场签到',
  admin: '后台签到'
};

const CHECK_IN_METHOD_LABEL_MAP = {
  scan: '扫码签到',
  auto: '自动签到',
  exempt_cancel: '未上课（豁免取消）'
};

const BOOKING_FILTERS = [
  { label: '全部', value: 'all', active: true },
  { label: '待上课', value: 'upcoming', active: false },
  { label: '已完成', value: 'completed', active: false },
  { label: '已取消', value: 'cancelled', active: false }
];

const ATTENDANCE_FILTERS = [
  { label: '全部', value: 'all', active: true },
  { label: '扫码签到', value: 'scan', active: false },
  { label: '自动签到', value: 'auto', active: false },
  { label: '未上课', value: 'exempt_cancel', active: false },
  { label: '现场签到', value: 'onsite', active: false },
  { label: '后台签到', value: 'admin', active: false }
];

const CANCEL_TYPE_MAP = {
  normal: '用户自行取消',
  timeout: '超时未确认',
  exempt: '免扣课时取消',
  admin_cancel: '管理员取消',
  min_bookings_not_met: '预约人数不足',
  holiday: '节假日取消'
};

Page({
  data: {
    activeTab: 'booking',
    records: [],
    loading: true,
    page: 1,
    hasMore: true,
    filters: BOOKING_FILTERS,
    currentFilter: 'all'
  },

  onLoad(options) {
    if (!auth.requireLogin()) return;
    auth.requireMember(() => {
      if (options.tab) {
        const tab = options.tab;
        if (tab === 'class') {
          this.setData({ activeTab: 'class', filters: ATTENDANCE_FILTERS, currentFilter: 'all' });
        } else if (tab === 'waitlist') {
          this.setData({ activeTab: 'waitlist' });
        } else {
          this.setData({ activeTab: 'booking', filters: BOOKING_FILTERS, currentFilter: 'all' });
        }
      }
      this.loadRecords();
    });
  },

  onShow() {
    if (!checkLogin()) return;
    const userInfo = app.globalData.userInfo || {};
    if (userInfo.member_status !== 'official') return;
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

    const isClassTab = tab === 'class';
    const url = isClassTab ? '/attendance/my' : '/bookings/my';
    const params = { page: this.data.page, pageSize: 10 };

    if (!isClassTab) {
      const filterType = this.data.currentFilter !== 'all' ? this.data.currentFilter : undefined;
      params.type = filterType === 'upcoming' ? 'booked' : filterType;
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

        if (isClassTab) {
          base.checkInMethod = item.check_in_method || 'scan';
          base.sourceLabel = CHECK_IN_METHOD_LABEL_MAP[base.checkInMethod] || SOURCE_LABEL_MAP[item.source] || '签到';
          base.checkInTime = item.check_in_time ? formatDate(item.check_in_time, 'HH:mm') : '';
          base.creditsCost = item.credits_cost || 0;
        }

        if (!isClassTab && (String(item.status || '').toLowerCase() === 'cancelled' || String(item.booking_status || '').toLowerCase() === 'cancelled')) {
          base.cancelReason = item.cancel_reason || (item.cancel_type ? CANCEL_TYPE_MAP[item.cancel_type] : '');
          base.status = 'cancelled';
        }

        return base;
      });

      let filteredRecords = newRecords;
      if (isClassTab && this.data.currentFilter !== 'all') {
        const filterVal = this.data.currentFilter;
        if (filterVal === 'scan' || filterVal === 'auto' || filterVal === 'exempt_cancel') {
          filteredRecords = newRecords.filter(r => r.checkInMethod === filterVal);
        } else if (filterVal === 'onsite') {
          filteredRecords = newRecords.filter(r => r.source === 'onsite');
        } else if (filterVal === 'admin') {
          filteredRecords = newRecords.filter(r => r.source === 'admin');
        }
      }

      const records = this.data.page === 1 ? filteredRecords : this.data.records.concat(filteredRecords);
      this.setData({
        records,
        loading: false,
        hasMore: newRecords.length >= 10
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

  onFilterChange(e) {
    const value = e.currentTarget.dataset.value;
    const filters = this.data.filters.map(f => ({ ...f, active: f.value === value }));
    this.setData({ filters, currentFilter: value, page: 1 });
    this.loadRecords();
  },

  onTabChange(e) {
    const { tab } = e.currentTarget.dataset;
    if (tab === 'waitlist') {
      this.setData({ activeTab: 'waitlist', filters: [], currentFilter: '' });
    } else {
      const filters = tab === 'class' ? ATTENDANCE_FILTERS : BOOKING_FILTERS;
      filters.forEach(f => f.active = f.value === 'all');
      this.setData({ activeTab: tab, filters, currentFilter: 'all' });
    }
    this.setData({ page: 1, hasMore: true });
    this.loadRecords();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && this.data.activeTab !== 'waitlist') {
      this.setData({ page: this.data.page + 1 });
      this.loadRecords();
    }
  }
});