const app = getApp();
const { request } = require('../../utils/request');
const { checkLogin } = require('../../utils/auth');
const auth = require('../../utils/auth');
const config = require('../../config/index.js');
const { normalizeImageUrl } = require('../../utils/util');

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekday(dateStr) {
  const d = new Date(dateStr);
  return WEEKDAYS[d.getDay()];
}

function getDanceTagColor(styleName) {
  if (!styleName) return { bg: '#9B89FF', text: '#FFFFFF' };
  if (styleName.indexOf('古典舞') !== -1 || styleName === '古典舞') {
    return { bg: '#F8D57E', text: '#6B5B2E' };
  }
  if (styleName.indexOf('韩舞') !== -1 || styleName === '韩舞') {
    return { bg: '#FF9EC5', text: '#FFFFFF' };
  }
  if (styleName.indexOf('街舞') !== -1 || styleName === '街舞') {
    return { bg: '#FF8A7A', text: '#FFFFFF' };
  }
  if (styleName.indexOf('流行舞') !== -1 || styleName === '流行舞') {
    return { bg: '#A0D4FF', text: '#FFFFFF' };
  }
  var hash = 0;
  for (var i = 0; i < styleName.length; i++) {
    hash = ((hash << 5) - hash) + styleName.charCodeAt(i);
    hash = hash & hash;
  }
  hash = Math.abs(hash);
  var TAG_COLORS = [
    '#9B89FF',
    '#8DD0C9',
    '#D4A6FF',
    '#FFCE8A',
    '#A0D4FF',
    '#B8E5A8',
    '#FFC4D0',
    '#C8C6FF'
  ];
  return { bg: TAG_COLORS[hash % TAG_COLORS.length], text: '#FFFFFF' };
}

const SERVER_BASE = config.serverBase;

Page({
  data: {
    coachId: '',
    coach: null,
    danceStyleText: '',
    courses: [],
    loading: true,
    isOfficial: false,
    showBookingModal: false,
    bookingModalText: '',
    bookingModalCourse: null,
    isLoggedInShowing: false,
    imageErrors: {},
    images: [],
    bookedScheduleIds: [],
    waitlistedScheduleIds: [],
    showWaitlistModal: false,
    waitlistCourse: null,
    waitlistModalText: '',
    canViewCapacity: false,
    isPackageSuspended: false,
    bookingWindowDays: 7
  },

  onLoad(options) {
    const userInfo = app.globalData.userInfo || {};
    this.setData({ isOfficial: userInfo.member_status === 'official' });
    if (options.id) {
      this.setData({ coachId: options.id });
      this.loadCoachDetail(options.id);
      this.loadUserPackages();
    }
  },

  onShow() {
    if (this.data.coach && this.data.coach.name) {
      wx.setNavigationBarTitle({ title: this.data.coach.name });
    }
  },

  loadUserPackages() {
    const { checkLogin } = require('../../utils/auth');
    if (!checkLogin()) return;
    request({ url: '/packages/my' }).then(res => {
      const data = res.data || {};
      const hasActive = data.current;
      const hasPending = data.pending && data.pending.length > 0;
      this.setData({ 
        isPackageSuspended: data.hasSuspended && !hasActive,
        canViewCapacity: hasActive || hasPending
      });
    }).catch(() => {});
  },

  onPullDownRefresh() {
    if (this.data.coachId) {
      this.loadCoachDetail(this.data.coachId).then(() => {
        wx.stopPullDownRefresh();
      }).catch(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  loadMyBookings() {
    if (!this.data.isOfficial) {
      this.setData({ bookedScheduleIds: [] });
      return;
    }
    request({ url: '/bookings/my?type=booked&pageSize=50', silent: true }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const bookedScheduleIds = list.map(b => {
        if (b.schedule_id) {
          return String(b.schedule_id._id || b.schedule_id);
        }
        return null;
      }).filter(Boolean);
      this.setData({ bookedScheduleIds });
    }).catch(() => {
      this.setData({ bookedScheduleIds: [] });
    });
  },

  loadMyWaitlists() {
    if (!this.data.isOfficial) {
      this.setData({ waitlistedScheduleIds: [] });
      return;
    }
    request({ url: '/bookings/waitlist/my', silent: true }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const waitlistedScheduleIds = list.map(w => {
        if (w.schedule_id) {
          return String(w.schedule_id._id || w.schedule_id);
        }
        return null;
      }).filter(Boolean);
      this.setData({ waitlistedScheduleIds });
    }).catch(() => {
      this.setData({ waitlistedScheduleIds: [] });
    });
  },

  cmpContains(arr, id) {
    if (!arr || !arr.length) return false;
    return arr.indexOf(String(id)) !== -1;
  },

  loadCoachDetail(id) {
    this.setData({ loading: true });

    // 获取预约开放窗口配置
    const bookingWindowPromise = request({ url: '/config/public/booking-window', method: 'GET', silent: true }).then(res => {
      const days = (res.data && res.data.booking_window_days) ? parseInt(res.data.booking_window_days, 10) : 7;
      this.setData({ bookingWindowDays: days || 7 });
      return days || 7;
    }).catch(() => 7);

    const coachPromise = request({ url: `/coaches/${id}` }).then(res => {
      const coachData = res.data || {};
      const coach = {
        _id: coachData._id || '',
        name: coachData.name || '未知教练',
        avatar_url: normalizeImageUrl(coachData.avatar_url, SERVER_BASE) || '/images/default-avatar.svg',
        dance_styles: coachData.dance_styles || [],
        introduction: coachData.introduction || ''
      };
      const danceStyleNames = coach.dance_styles
        ? coach.dance_styles.map(ds => ds.name || '未知舞种')
        : [];
      const danceStyleText = danceStyleNames.join(' / ');

      this.setData({ coach, danceStyleText });

      wx.setNavigationBarTitle({ title: coach.name });

      return coach;
    }).catch((err) => {
      console.error('[CoachDetail] 获取教练详情失败:', err);
      wx.showToast({ title: '获取教练信息失败', icon: 'none' });
      return null;
    });

    const today = formatDate(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);
    const endDateStr = formatDate(endDate);
    
    const schedulesPromise = Promise.all([bookingWindowPromise, request({ url: '/schedules', data: { coach_id: id, limit: 50 } })]).then(([bookingWindowDays, res]) => {
      const data = res.data || {};
      const allSchedules = data.list || (Array.isArray(data) ? data : []);
      const courses = allSchedules.filter(s => {
        if (!s.date) return false;
        if (s.status === 'cancelled' || s.status === 'offline') return false;
        return s.date >= today && s.date <= endDateStr;
      }).map(schedule => {
        const danceStyleName = schedule.dance_style_id && schedule.dance_style_id.name ? schedule.dance_style_id.name : '';
        const tagColor = getDanceTagColor(danceStyleName);
        const weekday = getWeekday(schedule.date);
        // 使用年月日构造日期对象，消除时分秒对天数差计算的干扰
        const scheduleParts = schedule.date.split('-');
        const target = new Date(parseInt(scheduleParts[0]), parseInt(scheduleParts[1]) - 1, parseInt(scheduleParts[2]));
        const todayParts = today.split('-');
        const todayDate = new Date(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2]));
        const diffDays = Math.floor((target - todayDate) / (1000 * 60 * 60 * 24));
        return {
          ...schedule,
          _id: String(schedule._id),
          danceStyleName,
          danceTagBg: tagColor.bg,
          danceTagText: tagColor.text,
          weekday,
          bookingOpen: diffDays >= 0 && diffDays < bookingWindowDays
        };
      });
      this.setData({ courses });
      return courses;
    }).catch((err) => {
      console.error('[CoachDetail] 获取课程列表失败:', err);
      return [];
    });
    
    this.loadMyBookings();
    this.loadMyWaitlists();
    this.loadCoachImages(id);

    return Promise.all([coachPromise, schedulesPromise])
      .then(() => {
        this.setData({ loading: false });
      })
      .catch((err) => {
        console.error('[CoachDetail] 加载数据出错:', err);
        this.setData({ loading: false });
      });
  },

  loadCoachImages(coachId) {
    request({ url: `/images?coach_id=${coachId}&pageSize=100`, silent: true }).then(res => {
      const data = res.data || {};
      const list = data.list || (Array.isArray(data) ? data : []);
      const images = list.map(img => ({
        ...img,
        image_url: normalizeImageUrl(img.image_url, SERVER_BASE),
        thumbnail_url: normalizeImageUrl(img.thumbnail_url, SERVER_BASE)
      }));
      this.setData({ images, imageUrls: images.map(i => i.image_url) });
    }).catch(() => {
      this.setData({ images: [] });
    });
  },

  onCourseTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/course-detail/course-detail?id=${id}`
    });
  },

  onPhotoTap(e) {
    this.onPreviewGallery(e);
  },

  onBookTap(e) {
    if (!auth.requireLogin()) return;
    auth.requireMember(() => {
      const course = e.currentTarget.dataset.course;
      if (!course) return;
      
      // 套餐停卡中，拦截预约
      if (this.data.isPackageSuspended) {
        wx.showModal({
          title: '无法预约',
          content: '您的套餐暂停使用中，不能进行预约课程操作。',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#D4786E'
        });
        return;
      }
      
      // 未开放预约
      if (course && !course.bookingOpen) {
        return;
      }
      
      if (this.cmpContains(this.data.bookedScheduleIds, course._id)) {
        wx.showToast({ title: '您已预约该课程。如需取消，请在课程详情页面中操作', icon: 'none' });
        return;
      }
      
      if (course.status === 'full') {
        this.setData({
          showWaitlistModal: true,
          waitlistCourse: course,
          waitlistModalText: `确认加入「${course.course_name}」的候补队列？\n时间：${course.date} ${course.start_time} - ${course.end_time}\n教练：${course.coach_id ? course.coach_id.name : '待定'}`
        });
        return;
      }
      
      this.setData({
        showBookingModal: true,
        bookingModalCourse: course,
        bookingModalText: `确认预约「${course.course_name}」？\n时间：${course.date} ${course.start_time} - ${course.end_time}\n教练：${course.coach_id ? course.coach_id.name : '待定'}`
      });
    });
  },



  onConfirmWaitlist() {
    const course = this.data.waitlistCourse;
    if (!course || !course._id) return;
    this.setData({ showWaitlistModal: false });
    wx.showLoading({ title: '加入候补...' });
    request({
      url: '/bookings/waitlist',
      method: 'POST',
      data: { schedule_id: course._id }
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已加入候补队列', icon: 'success' });
      this.loadMyWaitlists();
    }).catch(err => {
      wx.hideLoading();
      const errMsg = err.message || '加入候补失败';
      if (errMsg.includes('已在候补')) {
        wx.showToast({ title: '您已在候补队列中', icon: 'none' });
      } else {
        wx.showToast({ title: errMsg, icon: 'none' });
      }
    });
  },

  onCancelWaitlist() {
    this.setData({ showWaitlistModal: false, waitlistCourse: null, waitlistModalText: '' });
  },

  onConfirmBookingModal() {
    const course = this.data.bookingModalCourse;
    this.setData({ showBookingModal: false, bookingModalCourse: null, bookingModalText: '' });
    if (course && course._id) {
      this.doBook(course._id);
    }
  },

  onCancelBookingModal() {
    this.setData({ showBookingModal: false, bookingModalCourse: null, bookingModalText: '' });
  },

  onModalTap() {},

  onCancelLoginModal() {
    this.setData({ isLoggedInShowing: false });
  },

  onGoLogin() {
    this.setData({ isLoggedInShowing: false });
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  onPreviewGallery(e) {
    const index = e.currentTarget.dataset.index;
    const current = this.data.images[index];
    if (!current) return;
    wx.previewImage({
      current: current.image_url,
      urls: this.data.imageUrls
    });
  },

  async doBook(scheduleId) {
    wx.showLoading({ title: '预约中...' });

    try {
      const { fetchTemplates, requestBookingSubscribe, getAcceptedTemplates } = require('../../utils/subscribe-message');
      await fetchTemplates();
      const subscribeResult = await requestBookingSubscribe();
      const acceptedTemplates = getAcceptedTemplates(subscribeResult);

      await request({
        url: '/bookings',
        method: 'POST',
        data: { schedule_id: scheduleId }
      });

      wx.hideLoading();

      if (acceptedTemplates.length > 0) {
        wx.showModal({
          title: '预约成功',
          content: '已为您开启上课提醒，课程开始前将收到通知',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#D4786E'
        });
      } else {
        wx.showToast({ title: '预约成功', icon: 'success' });
      }

      await this.refreshCourses();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '预约失败', icon: 'none' });
    }
  },

  refreshCourses() {
    const { coachId } = this.data;
    if (!coachId) return Promise.resolve();

    const today = formatDate(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);
    const endDateStr = formatDate(endDate);
    
    return request({ url: '/schedules', data: { coach_id: coachId, limit: 50 } }).then(res => {
      const data = res.data || {};
      const allSchedules = data.list || (Array.isArray(data) ? data : []);
      const courses = allSchedules.filter(s => {
        if (!s.date) return false;
        if (s.status === 'cancelled' || s.status === 'offline') return false;
        return s.date >= today && s.date <= endDateStr;
      }).map(schedule => {
        const danceStyleName = schedule.dance_style_id && schedule.dance_style_id.name ? schedule.dance_style_id.name : '';
        const tagColor = getDanceTagColor(danceStyleName);
        const weekday = getWeekday(schedule.date);
        return {
          ...schedule,
          _id: String(schedule._id),
          danceStyleName,
          danceTagBg: tagColor.bg,
          danceTagText: tagColor.text,
          weekday
        };
      });
      this.setData({ courses });
      this.loadMyBookings();
      this.loadMyWaitlists();
      return courses;
    }).catch((err) => {
      console.error('[CoachDetail] 刷新课程列表失败:', err);
      return [];
    });
  },

  onShareAppMessage() {
    const { coach } = this.data;
    return {
      title: coach ? `${coach.name} - 舞栖舞蹈社` : '教练详情',
      path: `/pages/coach-detail/coach-detail?id=${this.data.coachId}`
    };
  },

  onImgError(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    if (!type || !id) return;
    this.setData({ ['imageErrors.' + type + '_' + id]: true });
  }
});