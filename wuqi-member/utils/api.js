const { request } = require('./request');

module.exports = {
  // 认证相关
  auth: {
    wxLogin: (data) => request({ url: '/auth/wx-login', method: 'POST', data }),
    getMe: () => request({ url: '/auth/me', method: 'GET' }),
  },

  // 首页相关
  home: {
    getBanners: (data) => request({ url: '/home/banners', data }),
    getCoaches: (data) => request({ url: '/home/coaches', data }),
    getVideos: (data) => request({ url: '/home/videos', data }),
  },

  // 门店相关
  stores: {
    getList: (data) => request({ url: '/stores', data }),
    getDetail: (id) => request({ url: `/stores/${id}` }),
  },

  // 会员相关
  members: {
    updateProfile: (data) => request({ url: '/members/profile/update', method: 'PUT', data }),
    getInfoStatus: (id) => request({ url: `/members/${id}/info-status` }),
    requestChangePhone: (data) => request({ url: '/members/reserve-phone/request', method: 'POST', data }),
  },

  // 套餐相关
  packages: {
    getMy: () => request({ url: '/packages/my' }),
    activate: () => request({ url: '/packages/activate', method: 'PUT' }),
    getMemberStatus: (id) => request({ url: `/packages/member-status/${id}` }),
  },

  // 排课/课程相关
  schedules: {
    getList: (data) => request({ url: '/schedules', data }),
    getDetail: (id) => request({ url: `/schedules/${id}` }),
  },

  // 预约相关
  bookings: {
    create: (data) => request({ url: '/bookings', method: 'POST', data }),
    getMy: (data) => request({ url: '/bookings/my', data }),
    getMyAttendance: (data) => request({ url: '/bookings/my-attendance', data }),
    cancel: (id) => request({ url: `/bookings/${id}/cancel`, method: 'PUT' }),
    getWaitlistMy: (data) => request({ url: '/bookings/waitlist/my', data }),
    joinWaitlist: (data) => request({ url: '/bookings/waitlist', method: 'POST', data }),
    leaveWaitlist: (id) => request({ url: `/bookings/waitlist/${id}`, method: 'DELETE' }),
    confirmWaitlist: (id) => request({ url: `/bookings/waitlist/confirm/${id}`, method: 'PUT' }),
  },

  // 教练相关
  coaches: {
    getList: (data) => request({ url: '/coaches', data }),
    getDetail: (id) => request({ url: `/coaches/${id}` }),
  },

  // 视频相关
  videos: {
    getList: (data) => request({ url: '/videos', data }),
    getDetail: (id) => request({ url: `/videos/${id}` }),
  },

  // 舞种相关
  danceStyles: {
    getList: (data) => request({ url: '/dance-styles', data }),
  },

  // 签到相关
  attendance: {
    getMy: (data) => request({ url: '/attendance/my', data }),
    getCheckInStatus: (userId) => request({ url: `/attendance/check-in-status/${userId}` }),
  },
};
