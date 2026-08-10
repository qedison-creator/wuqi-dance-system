const app = getApp();
const { request } = require('../../../utils/request');
const { getScheduleStatusText, formatDateTime, fixImageUrl } = require('../../../utils/util');
const wsClient = require('../../../utils/websocket-client');

Page({
  data: {
    scheduleId: '',
    scheduleInfo: null,
    viewMode: 'bookings',
    activeTab: 'booked',
    // 已预约名单
    bookedList: [],
    // 已签到名单（含已完成）
    checkedInList: [],
    // 已取消名单（含豁免取消）
    cancelledList: [],
    // 卡片预约人数（已预约+已签到）
    totalBookedDisplay: 0,
    // 上课记录
    attendanceList: []
  },

  onLoad(options) {
    if (options.schedule_id) {
      this.setData({
        scheduleId: options.schedule_id,
        viewMode: options.view_mode || 'bookings',
        activeTab: options.tab || 'booked'
      });
      this.loadScheduleInfo();
      // 始终加载签到数据（预约视图也需要显示已签到Tab）

      this.loadAttendanceList();
      if (options.view_mode === 'attendance') {
        this.setData({ activeTab: 'all' });
      } else {
        this.loadBookingList();
      }
    }
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (this.data.scheduleId) {
      this.loadBookingList();
    }
    this._connectWebSocket();
  },

  onHide() {
    this._disconnectWebSocket();
  },

  onUnload() {
    this._disconnectWebSocket();
  },

  // ========== WebSocket 实时推送 ==========
  _connectWebSocket() {
    if (!this.data.scheduleId) return;
    wsClient.connect({
      onMessage: {
        // 会员预约成功 -> 刷新预约名单
        booking_create: (data) => {
          // 仅当推送的是当前课程的预约时刷新
          if (!data || !data.schedule_id || data.schedule_id === this.data.scheduleId) {
            this.loadBookingList();
            this.loadScheduleInfo();
          }
        },
        // 会员/管理员取消预约 -> 刷新预约名单
        booking_cancel: (data) => {
          if (!data || !data.schedule_id || data.schedule_id === this.data.scheduleId) {
            this.loadBookingList();
            this.loadScheduleInfo();
          }
        }
      },
      onFallback: () => {
        this.loadBookingList();
      }
    });
  },

  _disconnectWebSocket() {
    wsClient.disconnect();
  },

  // 加载排课信息
  async loadScheduleInfo() {
    try {
      const res = await request({
        url: `/schedules/${this.data.scheduleId}`,
        method: 'GET'
      });
      // 直接信任后端返回的 status 字段，前端不再推导状态

      const scheduleInfo = res.data;
      if (scheduleInfo) {
        scheduleInfo.statusText = getScheduleStatusText(scheduleInfo.status);
      }
      this.setData({ scheduleInfo });
    } catch (err) {
      console.error('加载排课信息失败', err);
    }
  },

  // 加载预约名单（三类）
  async loadBookingList() {
    try {
      const res = await request({
        url: `/schedules/${this.data.scheduleId}/bookings`,
        method: 'GET'
      });

      const allBookings = res.data || [];

      // 分类处理（列表保留每一次记录）
      // 与运营管理页面 classifyBooking 逻辑完全一致：
      // 已签到/已完成的会员同时保留在"已预约"列表中，签到是签到，预约是预约，分开显示
      const bookedList = [];
      const checkedInList = [];
      const cancelledList = [];

      allBookings.forEach(item => {
        const realName = item.user_id?.real_name;
        const nickName = item.user_id?.nick_name;
        const displayName = realName || nickName || '未知用户';
        const nickNameDisplay = realName && nickName && nickName !== realName ? nickName : '';
        const status = item.status;
        const cancelType = item.cancel_type;
        const isExempted = status === 'exempted' || item.is_exempted;
        const booking = {
          _id: item._id,
          userName: displayName,
          userNickName: nickNameDisplay,
          userPhone: item.user_id?.phone || '',
          userWechatPhone: item.user_id?.wechat_phone || '',
          userReservePhone: item.user_id?.reserve_phone || '',
          userAvatar: fixImageUrl(item.user_id?.avatar_url),
          bookingTime: item.created_at ? formatDateTime(item.created_at) : '',
          creditsDeducted: item.credits_deducted || 0,
          remark: item.remark || '',
          checkInTime: item.check_in_time ? formatDateTime(item.check_in_time) : '',
          checkedIn: item.checked_in || status === 'checked_in' || status === 'completed',
          isCompleted: status === 'completed',
          isOnsite: item.source === 'onsite',
          cancelType: cancelType,
          cancelReason: item.cancel_reason || '',
          isExempted: isExempted,
          creditsRefunded: item.credits_refunded || 0
        };

        // 分类规则（与运营管理页面 classifyBooking 对齐）：
        // 已签到（含已完成）：checked_in + completed（含现场直接签到 source='onsite'）
        // 已预约：正常预约(booked) + 走过预约流程的签到 + 课程/admin取消的cancelled
        // 已取消：用户自行取消的cancelled + 豁免取消 + 课程/admin取消的cancelled
        // 现场直接签到（source='onsite'）：仅计入已签到，不计入已预约（没有预约过）
        const isCourseCancel = status === 'cancelled' && ['admin_cancel', 'min_bookings_not_met', 'holiday', 'after_checkin_cancel'].includes(cancelType);
        const isUserCancel = status === 'cancelled' && !isCourseCancel;
        const isCheckedIn = item.checked_in || status === 'checked_in' || status === 'completed';
        // 仅通过 source 判断是否为现场直接签到（无预约流程）
        // check_in_method='onsite' 不作为判断依据，因为已预约会员签到也可能被标记为 onsite
        const isOnsiteCheckIn = item.source === 'onsite';

        // 已签到列表：checked_in / completed
        if (isCheckedIn) {
          checkedInList.push(booking);
        }
        // 已预约列表：正常预约 + 走过预约流程的签到（排除onsite） + 课程取消（保留预约记录）
        if (status === 'booked' || (isCheckedIn && !isOnsiteCheckIn) || isCourseCancel) {
          if (isCourseCancel) {
            // 课程取消的预约，带上取消原因供已预约列表展示
            bookedList.push({
              ...booking,
              cancelReasonText: (item.cancel_reason || '课程取消').replace(/，\s*课时已退还/g, '').replace(/课时已退还/g, '').trim() || '课程取消',
              creditsRefunded: item.credits_refunded || item.credits_deducted || 0
            });
          } else {
            bookedList.push(booking);
          }
        }
        // 已取消列表：用户取消 + 豁免 + 课程取消
        if (isUserCancel || isExempted || isCourseCancel) {
          let cancelReasonText = '';
          if (isExempted) {
            cancelReasonText = '豁免取消';
          } else if (isCourseCancel) {
            cancelReasonText = (item.cancel_reason || '课程取消').replace(/，\s*课时已退还/g, '').replace(/课时已退还/g, '').trim() || '课程取消';
          } else {
            cancelReasonText = item.cancel_reason || '用户取消';
          }
          cancelledList.push({
            ...booking,
            cancelTime: item.cancel_time ? formatDateTime(item.cancel_time) : '',
            cancelReason: cancelReasonText
          });
        }
      });

      // 统计按人数（同一用户多次预约只算1次，取最新状态）
      const sortedAll = [...allBookings].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      const userLatestMap = new Map();
      sortedAll.forEach(item => {
        const uid = item.user_id?._id || item.user_id || 'unknown';
        if (!userLatestMap.has(uid)) {
          userLatestMap.set(uid, item);
        }
      });
      let bookedCount = 0, checkedInCount = 0, cancelledCount = 0;
      userLatestMap.forEach(item => {
        const status = item.status;
        const cancelType = item.cancel_type;
        const isCourseCancel = status === 'cancelled' && ['admin_cancel', 'min_bookings_not_met', 'holiday', 'after_checkin_cancel'].includes(cancelType);
        const isUserCancel = status === 'cancelled' && !isCourseCancel;
        const isExempted = status === 'exempted' || item.is_exempted;
        const isCheckedIn = item.checked_in || status === 'checked_in' || status === 'completed';
        const isOnsiteCheckIn = item.source === 'onsite';
        if (isCheckedIn) checkedInCount++;
        // 预约人数：正常预约 + 走过预约流程的签到（排除onsite）+ 课程取消
        if (status === 'booked' || (isCheckedIn && !isOnsiteCheckIn) || isCourseCancel) bookedCount++;
        if (isUserCancel || isExempted || isCourseCancel) cancelledCount++;
      });
      // 卡片"预约人数"显示：所有实际预约过的人数（含走过预约流程的签到/课程取消，不含现场直接签到）
      const totalBookedDisplay = bookedCount;

      this.setData({
        bookedList,
        checkedInList,
        cancelledList,
        bookedCount,
        checkedInCount,
        cancelledCount,
        totalBookedDisplay
      });
    } catch (err) {
      console.error('加载预约名单失败', err);
    }
  },

  // 加载上课记录
  async loadAttendanceList() {
    try {
      const res = await request({
        url: `/attendance/schedule/${this.data.scheduleId}`,
        method: 'GET'
      });
      
      // 后端返回 { total, checkedIn, booked, cancelled, records: [...] }

      const records = (res.data && res.data.records) || [];
      
      const processedList = records.map(item => {
        const realName = item.user_id?.real_name;
        const nickName = item.user_id?.nick_name;
        const displayName = realName || nickName || '未知用户';
        const nickNameDisplay = realName && nickName && nickName !== realName ? nickName : '';
        const att = item.attendance;
        let method = 'scan';
        if (att) {
          if (att.check_in_method) method = att.check_in_method;
          else if (att.source === 'booking') method = 'auto';
          else method = 'scan';
        } else if (item.check_in_method) {
          method = item.check_in_method;
        }
        return {
          _id: item.booking_id || item._id,
          userName: displayName,
          userNickName: nickNameDisplay,
          userPhone: item.user_id?.phone || '',
          userWechatPhone: item.user_id?.wechat_phone || '',
          userReservePhone: item.user_id?.reserve_phone || '',
          userAvatar: fixImageUrl(item.user_id?.avatar_url),
          checkInTime: att && att.check_in_time ? formatDateTime(att.check_in_time) : (item.check_in_time ? formatDateTime(item.check_in_time) : ''),
          checkInMethod: method,
          checkInMethodText: this.getCheckInMethodText(method),
          source: item.source,
          creditsCost: att ? att.credits_cost : (item.credits_deducted || 0),
          status: item.status,
          checkedIn: item.checked_in
        };
      });
      
      this.setData({ attendanceList: processedList });
    } catch (err) {
      console.error('加载上课记录失败', err);
    }
  },

  getCheckInMethodText(method) {
    const map = {
      'scan': '扫码签到',
      'auto': '自动签到',
      'admin': '管理员签到',
      'onsite': '现场签到',
      'exempt_cancel': '未上课(豁免取消)'
    };
    return map[method] || '扫码签到';
  },

  // 切换Tab
  onTabChange(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ activeTab: tab });
  },

  // 管理员手动取消预约
  async onCancelBooking(e) {
    const { id } = e.currentTarget.dataset;
    wx.showActionSheet({
      itemList: ['不足开课人数', '恶劣天气', '教练突发状况', '放假', '其他'],
      success: (res) => {
        const reasons = ['不足开课人数', '恶劣天气', '教练突发状况', '放假', '其他'];
        const reason = reasons[res.tapIndex];
        wx.showModal({
          title: '确认取消',
          content: `确认以「${reason}」为由取消此预约？将退还会员次数。`,
          success: async (modalRes) => {
            if (modalRes.confirm) {
              try {
                await request({
                  url: `/bookings/${id}/admin-cancel`,
                  method: 'PUT',
                  data: { reason }
                });
                wx.showToast({ title: '已取消', icon: 'success' });
                this.loadBookingList();
              } catch (err) {
                console.error('取消预约失败', err);
              }
            }
          }
        });
      },
      fail: () => {}
    });
  },

  // 返回排课页面
  onBack() {
    wx.navigateBack();
  }
});
