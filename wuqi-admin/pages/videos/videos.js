const { request } = require('../../utils/request');
const app = getApp();

Page({
  data: {
    videos: [],
    coaches: [],
    showModal: false,
    editingVideo: null,
    uploading: false,
    uploadType: '', // 'cover' or 'video'
    formData: {
      title: '',
      description: '',
      video_url: '',
      cover_url: '',
      coach_id: '',
      duration: '',
      status: 'active'
    }
  },

  onShow() {
    this.loadVideos();
    this.loadCoaches();
  },

  async loadVideos() {
    try {
      const res = await request({ url: '/videos', method: 'GET' });
      const list = Array.isArray(res.data) ? res.data : (res.data.list || []);
      this.setData({ videos: list });
    } catch (err) {
      console.error('加载视频失败', err);
    }
  },

  async loadCoaches() {
    try {
      const res = await request({ url: '/coaches', method: 'GET' });
      const list = Array.isArray(res.data) ? res.data : (res.data.list || []);
      this.setData({ coaches: list });
    } catch (err) {
      console.error('加载教练失败', err);
    }
  },

  onAddVideo() {
    this.setData({
      showModal: true,
      editingVideo: null,
      formData: {
        title: '',
        description: '',
        video_url: '',
        cover_url: '',
        coach_id: '',
        duration: '',
        status: 'active'
      }
    });
  },

  onEditVideo(e) {
    const { id } = e.currentTarget.dataset;
    const video = this.data.videos.find(v => v._id === id);
    if (!video) return;
    this.setData({
      showModal: true,
      editingVideo: video,
      formData: {
        title: video.title || '',
        description: video.description || '',
        video_url: video.video_url || '',
        cover_url: video.cover_url || '',
        coach_id: video.coach_id ? (video.coach_id._id || video.coach_id) : '',
        duration: video.duration || '',
        status: video.status || 'active'
      }
    });
  },

  onCloseModal() {
    this.setData({ showModal: false });
  },

  onModalTap() {},

  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`formData.${field}`]: e.detail.value });
  },

  onCoachChange(e) {
    const index = e.detail.value;
    const coach = this.data.coaches[index];
    this.setData({
      'formData.coach_id': coach ? coach._id : '',
      'formData.coachName': coach ? coach.name : ''
    });
  },

  // 选择并上传封面图
  onChooseCover() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.uploadFile(res.tempFilePaths[0], 'image', 'cover_url');
      }
    });
  },

  // 选择并上传视频
  onChooseVideo() {
    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      maxDuration: 300,
      success: (res) => {
        this.uploadFile(res.tempFilePath, 'video', 'video_url');
        // 自动获取时长
        if (res.duration) {
          const minutes = Math.floor(res.duration / 60);
          const seconds = Math.floor(res.duration % 60);
          this.setData({
            'formData.duration': `${minutes}:${seconds.toString().padStart(2, '0')}`
          });
        }
      }
    });
  },

  async uploadFile(filePath, type, field) {
    this.setData({ uploading: true, uploadType: type });
    wx.showLoading({ title: '上传中...', mask: true });

    try {
      const token = wx.getStorageSync('admin_token');
      const res = await new Promise((resolve, reject) => {
        wx.uploadFile({
          url: `${app.globalData.baseUrl}/upload/${type}`,
          filePath: filePath,
          name: type,
          formData: { type: type === 'video' ? 'coach_video' : 'course' },
          header: { 'Authorization': `Bearer ${token}` },
          success: (res) => {
            try {
              const data = JSON.parse(res.data);
              if (data.code === 0 || data.code === 200) resolve(data);
              else reject(new Error(data.message));
            } catch (e) {
              reject(e);
            }
          },
          fail: reject
        });
      });

      // 拼接完整 URL
      const fileUrl = res.data.url.startsWith('http') ? res.data.url : `${app.globalData.baseUrl.replace('/api/v1', '')}${res.data.url}`;
      this.setData({ [`formData.${field}`]: fileUrl });
      wx.hideLoading();
      wx.showToast({ title: '上传成功', icon: 'success' });
    } catch (err) {
      console.error('上传失败', err);
      wx.hideLoading();
      wx.showToast({ title: '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false, uploadType: '' });
    }
  },

  onStatusChange(e) {
    this.setData({ 'formData.status': e.detail.value ? 'active' : 'disabled' });
  },

  async onSubmit() {
    const { formData, editingVideo } = this.data;
    if (!formData.title) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    if (!formData.video_url) {
      wx.showToast({ title: '请上传视频', icon: 'none' });
      return;
    }

    try {
      if (editingVideo) {
        await request({
          url: `/videos/${editingVideo._id}`,
          method: 'PUT',
          data: formData
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/videos',
          method: 'POST',
          data: formData
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showModal: false });
      this.loadVideos();
    } catch (err) {
      console.error('保存失败', err);
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  async onDeleteVideo(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个视频吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({ url: `/videos/${id}`, method: 'DELETE' });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadVideos();
          } catch (err) {
            console.error('删除失败', err);
          }
        }
      }
    });
  },

  async onToggleStatus(e) {
    const { id, index } = e.currentTarget.dataset;
    const video = this.data.videos[index];
    const newStatus = video.status === 'active' ? 'disabled' : 'active';
    try {
      await request({
        url: `/videos/${id}/status`,
        method: 'PUT',
        data: { status: newStatus }
      });
      this.setData({ [`videos[${index}].status`]: newStatus });
    } catch (err) {
      console.error('操作失败', err);
    }
  },

  getCoachName(coachId) {
    if (!coachId) return '未指定';
    const coach = this.data.coaches.find(c => c._id === coachId);
    return coach ? coach.name : '未知';
  }
});
