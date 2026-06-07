const { request } = require('../../utils/request');
const app = getApp();

Page({
  data: {
    video: null,
    videoUrl: '',
    coverUrl: '',
    title: '',
    coachName: '',
    loading: true
  },

  onLoad(options) {
    if (options.id) {
      this.loadVideo(options.id);
    }
    if (options.url) {
      this.setData({ videoUrl: decodeURIComponent(options.url) });
    }
    if (options.cover) {
      this.setData({ coverUrl: decodeURIComponent(options.cover) });
    }
    if (options.title) {
      this.setData({ title: decodeURIComponent(options.title) });
    }
    if (options.coachName) {
      this.setData({ coachName: decodeURIComponent(options.coachName) });
    }
  },

  loadVideo(id) {
    this.setData({ loading: true });
    request({
      url: '/videos/' + id,
      method: 'GET'
    }).then(res => {
      this.setData({
        video: res.data,
        videoUrl: res.data.video_url || this.data.videoUrl,
        coverUrl: res.data.cover_url || this.data.coverUrl,
        title: res.data.title || this.data.title,
        coachName: res.data.coach_name || this.data.coachName,
        loading: false
      });

      request({
        url: '/videos/' + id + '/view',
        method: 'POST'
      }).catch(() => {});
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  onVideoError() {
    wx.showToast({ title: '视频加载失败', icon: 'none' });
  },

  onHide() {
    const videoCtx = wx.createVideoContext('videoPlayer', this);
    if (videoCtx) {
      videoCtx.pause();
    }
  },

  onUnload() {
    const videoCtx = wx.createVideoContext('videoPlayer', this);
    if (videoCtx) {
      videoCtx.pause();
    }
  }
});