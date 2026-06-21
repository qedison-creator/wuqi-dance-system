const { request } = require('../../../utils/request');
const { formatDate } = require('../../../utils/util');

Page({
  data: {
    schedules: [],
    selectedSchedule: null,
    todayStr: '',
    records: [],
    loading: false,
    checkInLoading: false,
    checkedInCount: 0,
    pendingCount: 0,
    memberCode: '',
    searchHint: '',
    showProfileModal: false,
    profileData: null,
    checkedBookingIds: [],
    isOnsiteMode: false,
    showOnsiteConfirm: false,
    expandedIndex: -1,
  },

  preventTouchMove() {},

  onLoad() {
    this.setData({ todayStr: formatDate(new Date(), 'YYYY-MM-DD') });
    this.loadTodaySchedules();
  },

  onShow() {
    this.loadTodaySchedules();
  },

  loadTodaySchedules() {
    this.setData({ loading: true });
    const today = formatDate(new Date(), 'YYYY-MM-DD');
    request({
      url: '/schedules',
      data: { date: today }
    }).then(res => {
      let data = res.data;
      if (data && data.list) data = data.list;
      // 过滤：排除已取消、已结束、已下架、已删除、未开放的课程，只保留可签到的

      const excludedStatuses = ['cancelled', 'completed', 'offline', 'deleted', 'not_open'];
      const schedules = (data || [])
        .filter(s => !excludedStatuses.includes(s.status))
        .map(s => ({
          ...s,
          timeStr: `${s.start_time || ''} - ${s.end_time || ''}`,
          className: s.course_name || '未命名课程',
          coachName: s.coach_id ? s.coach_id.name : '',
          danceName: s.dance_style_id ? s.dance_style_id.name : '',
        }));
      this.setData({ schedules, loading: false });
      if (schedules.length > 0 && !this.data.selectedSchedule) {
        this.onScheduleSelect({ currentTarget: { dataset: { schedule: schedules[0] } } });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载排课失败', icon: 'none' });
    });
  },

  onScheduleSelect(e) {
    const schedule = e.currentTarget.dataset.schedule;
    this.setData({
      selectedSchedule: schedule,
      expandedIndex: -1,
    });
    this.loadAttendanceRecords(schedule._id);
  },

  loadAttendanceRecords(scheduleId) {
    wx.showLoading({ title: '加载中...' });
    request({
      url: `/attendance/schedule/${scheduleId}`,
    }).then(res => {
      const data = res.data || {};
      const records = (data.records || []).map(r => {
        const realName = r.user_id ? (r.user_id.real_name || '') : '';
        const nickName = r.user_id ? (r.user_id.nick_name || '') : '';
        const userName = realName || nickName || '会员';
        const userNickName = realName && nickName && nickName !== realName ? nickName : '';
        return {
          ...r,
          userName,
          userNickName,
          userInitial: userName ? userName[0] : '?',
          userPhone: r.user_id ? (r.user_id.phone || '') : '',
          memberCode: r.user_id ? (r.user_id.member_code || '') : '',
          checkInLabel: r.checked_in
            ? (r.attendance && r.attendance.source === 'onsite' ? '现场签到' : '已签到')
            : (r.status === 'cancelled' ? '已取消' : '待签到'),
          checkInClass: r.checked_in
            ? (r.attendance && r.attendance.source === 'onsite' ? 'onsite' : 'checked')
            : (r.status === 'cancelled' ? 'cancelled' : 'pending'),
          checkInTime: r.attendance ? r.attendance.check_in_time : null,
        };
      });
      const checkedInCount = records.filter(r => r.checked_in).length;
      const pendingCount = records.filter(r => !r.checked_in && r.status !== 'cancelled').length;
      this.setData({ records, checkedInCount, pendingCount });
      wx.hideLoading();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '加载签到名单失败', icon: 'none' });
    });
  },

  onScanCode() {
    wx.vibrateShort({ type: 'light' });
    wx.scanCode({
      scanType: ['qrCode'],
      onlyFromCamera: true,
      success: (res) => {
        const rawResult = (res.result || '').trim();
        if (!rawResult) {
          wx.showToast({ title: '未识别到二维码内容', icon: 'none' });
          return;
        }

        let encryptedToken = null;
        let code = rawResult;

        // 尝试 JSON 格式（兼容旧版或外部二维码）
        try {
          const parsed = JSON.parse(rawResult);
          if (parsed.t) encryptedToken = parsed.t;
          else if (parsed.member_code) code = parsed.member_code;
        } catch (e) {
          // 非JSON：新格式短token（8位字母数字），也可能为会员号

          if (/^[A-Za-z0-9]{6,12}$/.test(rawResult)) {
            encryptedToken = rawResult;
          }
        }

        if (encryptedToken) {
          this.resolveQRToken(encryptedToken);
        } else {
          this.setData({ memberCode: code, encryptedToken: null });
          this.searchMemberByCode(code);
        }
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('auth deny') !== -1) {
          wx.showModal({
            title: '需要相机权限',
            content: '请在设置中开启相机权限',
            confirmText: '去设置',
            confirmColor: '#FFCC00',
            success: (res2) => { if (res2.confirm) wx.openSetting(); }
          });
        } else if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败', icon: 'none' });
        }
      }
    });
  },

  resolveQRToken(encryptedToken) {
    wx.showLoading({ title: '解析中...' });
    this.decodeTokenForProfile(encryptedToken).catch(() => {
      wx.hideLoading();
    });
  },

  decodeTokenForProfile(encryptedToken) {
    return request({
      url: '/qrcode/verify',
      method: 'POST',
      data: { token: encryptedToken }
    }).then(res => {
      wx.hideLoading();
      if (res.data && res.data.member_code) {
        const memberCode = res.data.member_code;
        this.setData({ memberCode, encryptedToken });
        return this.loadMemberProfile(memberCode);
      } else {
        throw new Error('无效的签到码');
      }
    }).catch((err) => {
      wx.hideLoading();
      // request.js 已显示后端业务错误，仅补漏手动逻辑抛出的错误

      if (err.message && err.message !== '请求失败') {
        wx.showToast({ title: err.message, icon: 'none' });
      }
      throw err;
    });
  },

  loadMemberProfile(memberCode) {
    wx.showLoading({ title: '加载会员信息...' });
    return request({
      url: '/members',
      data: { keyword: memberCode }
    }).then(res => {
      let members = [];
      if (res.data) {
        members = res.data.list || res.data || [];
      }
      const found = members.find(m => m.member_code === memberCode)
        || members.find(m => m.phone === memberCode)
        || members[0];

      if (!found) {
        wx.hideLoading();
        wx.showToast({ title: '未找到该会员', icon: 'none' });
        return;
      }

      if (found._id) {
        return request({
          url: `/members/${found._id}/checkin-profile`,
        }).then(profileRes => {
          wx.hideLoading();
          this.showProfilePopup(profileRes.data || {}, false);
        }).catch(() => {
          wx.hideLoading();
          this.showProfilePopup({
            member: found,
            packages: [],
            today_bookings: [],
          }, false);
        });
      } else {
        wx.hideLoading();
        this.showProfilePopup({
          member: found,
          packages: [],
          today_bookings: [],
        }, false);
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '查询会员失败', icon: 'none' });
    });
  },

  onViewFullProfile(e) {
    const uid = e.currentTarget.dataset.uid;
    if (!uid) {
      wx.showToast({ title: '会员信息异常', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载会员信息...' });
    request({
      url: `/members/${uid}/checkin-profile`,
    }).then(res => {
      wx.hideLoading();
      this.showProfilePopup(res.data || {}, false);
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '加载会员档案失败', icon: 'none' });
    });
  },

  onMemberCodeInput(e) {
    this.setData({ memberCode: e.detail.value, searchHint: '' });
  },

  onMemberCodeConfirm() {
    const { memberCode } = this.data;
    if (!memberCode || memberCode.length < 2) {
      wx.showToast({ title: '请输入会员编号或手机号', icon: 'none' });
      return;
    }
    this.loadMemberProfile(memberCode);
  },

  searchMemberByCode(code) {
    this.loadMemberProfile(code);
  },

  showProfilePopup(profileData, isOnsiteMode) {
    const currentScheduleId = this.data.selectedSchedule
      ? this.data.selectedSchedule._id : null;

    let checkedBookingIds = [];
    if (profileData.today_bookings) {
      profileData.today_bookings = profileData.today_bookings.filter(b => !b.checked_in);
      if (!isOnsiteMode && currentScheduleId) {
        const match = profileData.today_bookings.find(
          b => b.schedule_id === currentScheduleId
        );
        if (match) {
          checkedBookingIds = [match.booking_id];
        }
      }
      if (isOnsiteMode && currentScheduleId) {
        checkedBookingIds = [currentScheduleId];
      }
    }

    profileData.today_bookings = (profileData.today_bookings || []).map(b => {
      return { ...b, checked: checkedBookingIds.indexOf(b.booking_id) >= 0 };
    });

    if (profileData.member) {
      const displayName = profileData.member.real_name || profileData.member.nick_name || '';
      profileData.member.display_name = displayName;
      profileData.member.nick_initial = displayName ? displayName[0] : '?';
    }

    this.setData({
      showProfileModal: true,
      profileData,
      checkedBookingIds,
      isOnsiteMode,
      showOnsiteConfirm: false,
    });
  },

  onToggleBookingCheck(e) {
    const bookingId = e.currentTarget.dataset.id;
    let checkedBookingIds = [...this.data.checkedBookingIds];
    const index = checkedBookingIds.indexOf(bookingId);
    if (index >= 0) {
      checkedBookingIds.splice(index, 1);
    } else {
      checkedBookingIds.push(bookingId);
    }
    const todayBookings = (this.data.profileData.today_bookings || []).map(b => {
      return { ...b, checked: checkedBookingIds.indexOf(b.booking_id) >= 0 };
    });
    this.setData({
      checkedBookingIds,
      'profileData.today_bookings': todayBookings
    });
  },

  onCloseProfileModal() {
    // 关闭弹窗时通知服务端清理扫码状态（推送 view_only 事件给会员端）
    if (this.data.encryptedToken) {
      request({
        url: '/qrcode/clear-scan',
        method: 'POST',
        data: { token: this.data.encryptedToken },
        silent: true
      }).catch(() => {});
    }
    this.setData({
      showProfileModal: false,
      profileData: null,
      checkedBookingIds: [],
      isOnsiteMode: false,
      showOnsiteConfirm: false,
      encryptedToken: '',
      memberCode: '',
    });
  },

  onProfileModalTap() {},

  onConfirmCheckIn() {
    wx.vibrateShort({ type: 'medium' });
    const { checkedBookingIds, isOnsiteMode, profileData, selectedSchedule } = this.data;

    if (checkedBookingIds.length === 0) {
      wx.showToast({ title: '请选择需要签到的课程', icon: 'none' });
      return;
    }

    if (isOnsiteMode) {
      this.setData({ showOnsiteConfirm: true });
      return;
    }

    this.doConfirmCheckIn();
  },

  onCancelOnsiteConfirm() {
    this.setData({ showOnsiteConfirm: false });
  },

  doConfirmCheckIn() {
    const { checkedBookingIds, isOnsiteMode, profileData, selectedSchedule } = this.data;

    this.setData({ checkInLoading: true });

    let scheduleIds;
    if (isOnsiteMode) {
      scheduleIds = checkedBookingIds;
    } else {
      scheduleIds = [];
      const bookings = profileData.today_bookings || [];
      for (const bid of checkedBookingIds) {
        const booking = bookings.find(b => b.booking_id === bid);
        if (booking) scheduleIds.push(booking.schedule_id);
      }
    }

    request({
      url: '/bookings/check-in',
      method: 'POST',
      data: {
        schedule_ids: scheduleIds,
        user_id: profileData.member._id,
        onsite: isOnsiteMode,
      }
    }).then(() => {
      this.setData({
        checkInLoading: false,
        showProfileModal: false,
        showOnsiteConfirm: false,
        profileData: null,
        checkedBookingIds: [],
        isOnsiteMode: false,
        memberCode: '',
      });
      wx.showToast({ title: `签到成功（${scheduleIds.length}节）`, icon: 'success' });
      if (selectedSchedule) {
        this.loadAttendanceRecords(selectedSchedule._id);
      }
    }).catch(err => {
      this.setData({ checkInLoading: false });
      const msg = (err.data && err.data.message) || err.message || '签到失败';
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
    });
  },

  onToggleExpand(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({
      expandedIndex: this.data.expandedIndex === index ? -1 : index,
    });
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  },

  getPackageTypeName(type) {
    const map = { times: '次卡', period: '周期卡', timecard: '时间卡' };
    return map[type] || type || '套餐';
  },
});
