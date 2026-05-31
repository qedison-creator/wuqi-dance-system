const { request } = require('../../utils/request');
const app = getApp();

Page({
  data: {
    banners: [],
    showModal: false,
    editingBanner: null,
    uploading: false,
    formData: {
      title: '',
      subtitle: '',
      image_url: '',
      link_url: '',
      sort_order: 1,
      status: 'active'
    }
  },

  onShow() {
    this.loadBanners();
  },

  async loadBanners() {
    try {
      const res = await request({ url: '/home/banners', method: 'GET' });
      const list = Array.isArray(res.data) ? res.data : (res.data.list || []);
      this.setData({ banners: list });
    } catch (err) {
      console.error('加载轮播图失败', err);
    }
  },

  onAddBanner() {
    this.setData({
      showModal: true,
      editingBanner: null,
      formData: {
        title: '',
        subtitle: '',
        image_url: '',
        link_url: '',
        sort_order: 1,
        status: 'active'
      }
    });
  },

  onEditBanner(e) {
    const { id } = e.currentTarget.dataset;
    const banner = this.data.banners.find(b => b._id === id);
    if (!banner) return;
    this.setData({
      showModal: true,
      editingBanner: banner,
      formData: {
        title: banner.title || '',
        subtitle: banner.subtitle || '',
        image_url: banner.image_url || '',
        link_url: banner.link_url || '',
        sort_order: banner.sort_order || 1,
        status: banner.status || 'active'
      }
    });
  },

  onCloseModal() {
    this.setData({ showModal: false });
  },

  onModalTap() {},

  preventMove() {},

  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`formData.${field}`]: e.detail.value });
  },

  // 选择并上传图片
  onChooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0];
        this.uploadImage(tempFilePath);
      }
    });
  },

  async uploadImage(filePath) {
    this.setData({ uploading: true });
    wx.showLoading({ title: '上传中...', mask: true });

    try {
      const token = wx.getStorageSync('admin_token');
      const baseUrl = app.globalData.baseUrl;
      const serverBase = app.globalData.serverBase || baseUrl.replace('/api/v1', '');
      
      const res = await new Promise((resolve, reject) => {
        wx.uploadFile({
          url: `${baseUrl}/upload/image?type=banner`,
          filePath: filePath,
          name: 'image',
          formData: { type: 'banner' },
          header: { 
            'Authorization': `Bearer ${token}`
          },
          success: (uploadRes) => {
            if (uploadRes.statusCode !== 200) {
              reject(new Error(`服务器错误: ${uploadRes.statusCode}`));
              return;
            }
            
            try {
              const data = JSON.parse(uploadRes.data);
              if (data.code === 200 || data.code === 0) {
                resolve(data);
              } else {
                reject(new Error(data.message || '上传失败'));
              }
            } catch (parseError) {
              reject(new Error('响应格式解析失败'));
            }
          },
          fail: (err) => {
            reject(new Error(err.errMsg || '网络请求失败'));
          }
        });
      });

      if (!res || !res.data) {
        throw new Error('服务器响应格式错误');
      }

      let imageUrl = res.data.url || res.data.path;
      
      if (!imageUrl) {
        throw new Error('服务器未返回图片地址');
      }
      
      if (!imageUrl.startsWith('http')) {
        imageUrl = `${serverBase}${imageUrl}`;
      }
      
      this.setData({ 'formData.image_url': imageUrl });
      wx.hideLoading();
      wx.showToast({ title: '上传成功', icon: 'success' });
    } catch (err) {
      console.error('上传失败:', err);
      wx.hideLoading();
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false });
    }
  },

  onStatusChange(e) {
    this.setData({ 'formData.status': e.detail.value ? 'active' : 'disabled' });
  },

  async onSubmit() {
    const { formData, editingBanner } = this.data;
    if (!formData.title) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    if (!formData.image_url) {
      wx.showToast({ title: '请上传图片', icon: 'none' });
      return;
    }

    try {
      if (editingBanner) {
        await request({
          url: `/banners/${editingBanner._id}`,
          method: 'PUT',
          data: formData
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/banners',
          method: 'POST',
          data: formData
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showModal: false });
      this.loadBanners();
    } catch (err) {
      console.error('保存失败', err);
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  async onDeleteBanner(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个轮播图吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({ url: `/banners/${id}`, method: 'DELETE' });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadBanners();
          } catch (err) {
            console.error('删除失败', err);
          }
        }
      }
    });
  },

  async onToggleStatus(e) {
    const { id, index } = e.currentTarget.dataset;
    const banner = this.data.banners[index];
    const newStatus = banner.status === 'active' ? 'disabled' : 'active';
    try {
      await request({
        url: `/banners/${id}/status`,
        method: 'PUT',
        data: { status: newStatus }
      });
      this.setData({ [`banners[${index}].status`]: newStatus });
    } catch (err) {
      console.error('操作失败', err);
    }
  }
});
