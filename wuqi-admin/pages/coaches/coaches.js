const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    activeTab: 'coaches',
    coaches: [],
    stores: [],
    danceStyles: [],
    // 用于教练弹窗的舞种列表（带selected字段）
    danceStyleList: [],
    // 新增教练弹窗
    showCoachModal: false,
    coachForm: {
      _id: '',
      name: '',
      gender: '1',
      dance_style_ids: [],
      avatar_url: ''
    },
    // 新增门店弹窗
    showStoreModal: false,
    storeForm: {
      _id: '',
      name: '',
      address: '',
      phone: ''
    },
    // 新增/编辑舞种弹窗
    showDanceStyleModal: false,
    danceStyleForm: {
      _id: '',
      name: '',
      sort_order: 0
    },
    // 教练详情弹窗
    showDetailModal: false,
    detailCoach: {
      _id: '',
      name: '',
      gender: 0,
      avatar_url: '',
      dance_style_names: '',
      gallery: []
    }
  },

  // 补全图片 URL
  fixImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return 'http:' + url;
    if (url.startsWith('/')) return app.globalData.serverBase + url;
    return app.globalData.serverBase + '/' + url;
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.loadCoaches();
    this.loadStores();
    this.loadDanceStyles();
  },

  onTabChange(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ activeTab: tab });
  },

  async loadCoaches() {
    try {
      const res = await request({
        url: '/coaches/admin',
        method: 'GET'
      });
      // 后端返回 paginate 格式: { list: [...], total, page, pageSize }
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      // 补全图片路径
      const processedList = list.map(coach => ({
        ...coach,
        avatar_url: this.fixImageUrl(coach.avatar_url),
        gallery: (coach.gallery || []).map(url => this.fixImageUrl(url))
      }));
      this.setData({ coaches: processedList });
    } catch (err) {
      console.error('加载教练列表失败', err);
    }
  },

  async loadStores() {
    try {
      const res = await request({
        url: '/stores',
        method: 'GET'
      });
      // 后端返回 paginate 格式: { list: [...], total, page, pageSize }
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({ stores: list });
    } catch (err) {
      console.error('加载门店列表失败', err);
    }
  },

  async loadDanceStyles() {
    try {
      const res = await request({
        url: '/dance-styles',
        method: 'GET'
      });
      // 后端返回 paginate 格式: { list: [...], total, page, pageSize }
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({ danceStyles: list });
    } catch (err) {
      console.error('加载舞种列表失败', err);
    }
  },

  // 根据 coachForm.dance_style_ids 生成带 selected 的舞种列表
  buildDanceStyleList() {
    const { danceStyles, coachForm } = this.data;
    const selectedIds = coachForm.dance_style_ids || [];
    const list = danceStyles.map(ds => ({
      ...ds,
      selected: selectedIds.indexOf(String(ds._id)) > -1
    }));
    this.setData({ danceStyleList: list });
  },

  // 点击切换舞种选中状态
  onToggleDanceStyle(e) {
    const index = e.currentTarget.dataset.index;
    const list = this.data.danceStyleList;
    const item = list[index];
    
    // 切换选中状态
    item.selected = !item.selected;
    this.setData({ danceStyleList: list });
    
    // 更新 coachForm.dance_style_ids
    const selectedIds = list.filter(i => i.selected).map(i => String(i._id));
    this.setData({ 'coachForm.dance_style_ids': selectedIds });
  },

  // 阻止弹窗内部点击冒泡到遮罩层
  onModalTap() {},

  // ==================== 教练管理 ====================
  onAddCoach() {
    this.setData({
      showCoachModal: true,
      coachForm: {
        _id: '',
        name: '',
        gender: '1',
        dance_style_ids: [],
        avatar_url: ''
      }
    }, () => {
      this.buildDanceStyleList();
    });
  },

  onEditCoach(e) {
    const index = e.currentTarget.dataset.index;
    const coach = this.data.coaches[index];
    // 确保 dance_style_ids 是字符串数组用于比较
    const danceStyleIds = coach.dance_style_ids ? coach.dance_style_ids.map(id => String(id)) : [];
    this.setData({
      showCoachModal: true,
      coachForm: {
        _id: coach._id,
        name: coach.name,
        gender: String(coach.gender || '1'),
        dance_style_ids: danceStyleIds,
        avatar_url: coach.avatar_url || ''
      }
    }, () => {
      this.buildDanceStyleList();
    });
  },

  onCloseCoachModal() {
    this.setData({ showCoachModal: false });
  },

  onCoachInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`coachForm.${field}`]: e.detail.value });
  },

  onCoachGenderChange(e) {
    this.setData({ 'coachForm.gender': e.detail.value });
  },

  async onSubmitCoach() {
    const { coachForm } = this.data;
    if (!coachForm.name) {
      wx.showToast({ title: '请输入教练姓名', icon: 'none' });
      return;
    }

    // 构造符合后端模型的数据
    const submitData = {
      name: coachForm.name,
      gender: Number(coachForm.gender) || 0,
      dance_styles: coachForm.dance_style_ids || [],
      avatar_url: coachForm.avatar_url || '',
      status: 'active'
    };

    try {
      if (coachForm._id) {
        await request({
          url: `/coaches/${coachForm._id}`,
          method: 'PUT',
          data: submitData
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/coaches',
          method: 'POST',
          data: submitData
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showCoachModal: false });
      this.loadCoaches();
    } catch (err) {
      console.error('保存教练失败', err);
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  async onDeleteCoach(e) {
    const index = e.currentTarget.dataset.index;
    const coach = this.data.coaches[index];
    wx.showModal({
      title: '确认删除',
      content: `确定要删除教练「${coach.name}」吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/coaches/${coach._id}`,
              method: 'DELETE'
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadCoaches();
          } catch (err) {
            console.error('删除教练失败', err);
          }
        }
      }
    });
  },

  async onToggleCoach(e) {
    const { id, index } = e.currentTarget.dataset;
    const coach = this.data.coaches[index];
    const newStatus = coach.status === 'active' ? 'disabled' : 'active';
    try {
      await request({
        url: `/coaches/${id}/status`,
        method: 'PUT',
        data: { status: newStatus }
      });
      this.loadCoaches();
    } catch (err) {
      console.error('切换教练状态失败', err);
    }
  },

  // ==================== 教练详情 & 相册管理 ====================
  onCoachDetail(e) {
    const index = e.currentTarget.dataset.index;
    const coach = this.data.coaches[index];
    // 为相册项生成唯一ID（使用 photoId 或 index 作为备用）
    const gallery = (coach.gallery || []).map((url, idx) => ({
      photoId: `photo_${Date.now()}_${idx}`,
      url: this.fixImageUrl(url),
      index: idx
    }));
    this.setData({
      showDetailModal: true,
      detailCoach: {
        _id: coach._id,
        name: coach.name,
        gender: coach.gender,
        avatar_url: this.fixImageUrl(coach.avatar_url || ''),
        dance_style_names: coach.dance_style_names || '',
        gallery: gallery
      }
    });
  },

  onCloseDetailModal() {
    this.setData({ showDetailModal: false });
  },

  // 编辑弹窗中选择头像
  onChooseAvatar() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        wx.showLoading({ title: '上传中...' });
        try {
          const uploadRes = await new Promise((resolve, reject) => {
            wx.uploadFile({
              url: app.globalData.baseUrl + '/upload/image?type=coach_avatar',
              filePath: tempFilePath,
              name: 'image',
              header: { 'Authorization': 'Bearer ' + wx.getStorageSync('admin_token') },
              success: resolve,
              fail: reject
            });
          });
          const data = JSON.parse(uploadRes.data);
          if (data.code === 200) {
            const fullUrl = app.globalData.serverBase + data.data.path;
            that.setData({ 'coachForm.avatar_url': fullUrl });
            wx.hideLoading();
            wx.showToast({ title: '头像上传成功', icon: 'success' });
          } else {
            wx.hideLoading();
            wx.showToast({ title: data.message || '上传失败', icon: 'none' });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      }
    });
  },

  // 详情弹窗中更换头像
  onDetailChooseAvatar() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        wx.showLoading({ title: '上传中...' });
        try {
          const uploadRes = await new Promise((resolve, reject) => {
            wx.uploadFile({
              url: app.globalData.baseUrl + '/upload/image?type=coach_avatar',
              filePath: tempFilePath,
              name: 'image',
              header: { 'Authorization': 'Bearer ' + wx.getStorageSync('admin_token') },
              success: resolve,
              fail: reject
            });
          });
          const data = JSON.parse(uploadRes.data);
          if (data.code === 200) {
            const fullUrl = app.globalData.serverBase + data.data.path;
            await request({
              url: `/coaches/${that.data.detailCoach._id}/avatar`,
              method: 'PUT',
              data: { avatar_url: fullUrl }
            });
            that.setData({ 'detailCoach.avatar_url': fullUrl });
            that.loadCoaches();
            wx.hideLoading();
            wx.showToast({ title: '头像更新成功', icon: 'success' });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      }
    });
  },

  // 添加相册照片
  onAddGalleryPhoto() {
    const that = this;
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      success: async (res) => {
        const files = res.tempFiles;
        wx.showLoading({ title: '上传中...' });
        try {
          for (const file of files) {
            const uploadRes = await new Promise((resolve, reject) => {
              wx.uploadFile({
                url: app.globalData.baseUrl + '/upload/image?type=coach_album',
                filePath: file.tempFilePath,
                name: 'image',
                header: { 'Authorization': 'Bearer ' + wx.getStorageSync('admin_token') },
                success: resolve,
                fail: reject
              });
            });
            const data = JSON.parse(uploadRes.data);
            if (data.code === 200) {
              const fullUrl = app.globalData.serverBase + data.data.path;
              await request({
                url: `/coaches/${that.data.detailCoach._id}/gallery`,
                method: 'POST',
                data: { url: fullUrl }
              });
            }
          }
          // 重新加载详情
          const coach = that.data.coaches.find(c => c._id === that.data.detailCoach._id);
          if (coach) {
            const freshRes = await request({ url: `/coaches/${that.data.detailCoach._id}` });
            const freshCoach = freshRes.data;
            // 为新加载的相册项生成唯一ID
            const freshGallery = (freshCoach.gallery || []).map((url, idx) => ({
              photoId: `photo_${Date.now()}_${idx}`,
              url: that.fixImageUrl(url),
              index: idx
            }));
            that.setData({
              'detailCoach.gallery': freshGallery,
              'detailCoach.avatar_url': that.fixImageUrl(freshCoach.avatar_url || '')
            });
            that.loadCoaches();
          }
          wx.hideLoading();
          wx.showToast({ title: '照片添加成功', icon: 'success' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      }
    });
  },

  // 删除相册照片
  onDeleteGalleryPhoto(e) {
    const photoId = e.currentTarget.dataset.photoid;
    const index = e.currentTarget.dataset.index;
    const gallery = this.data.detailCoach.gallery;
    // 使用 photoId 查找照片，如果找不到则使用 index 作为后备
    const photoItem = photoId ? gallery.find(item => item.photoId === photoId) : gallery[index];
    
    if (!photoItem) {
      wx.showToast({ title: '照片信息错误', icon: 'none' });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这张照片吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            // 使用照片的 URL 或 photoId 作为标识符发送到后端
            const photoIdentifier = photoItem.url || photoId;
            await request({
              url: `/coaches/${this.data.detailCoach._id}/gallery`,
              method: 'DELETE',
              data: { url: photoIdentifier }
            });
            // 使用 photoId 过滤删除的照片
            const updatedGallery = gallery.filter(item => item.photoId !== photoId);
            this.setData({ 'detailCoach.gallery': updatedGallery });
            this.loadCoaches();
            wx.showToast({ title: '已删除', icon: 'success' });
          } catch (err) {
            console.error('删除相册照片失败', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 预览相册照片
  onPreviewGallery(e) {
    const photoId = e.currentTarget.dataset.photoid;
    const index = e.currentTarget.dataset.index;
    const gallery = this.data.detailCoach.gallery;
    // 使用 photoId 查找当前照片
    const photoItem = photoId ? gallery.find(item => item.photoId === photoId) : gallery[index];
    
    if (!photoItem) {
      return;
    }
    
    // 收集所有照片 URL 用于预览
    const urls = gallery.map(item => item.url);
    wx.previewImage({
      current: photoItem.url,
      urls: urls
    });
  },

  // ==================== 门店管理 ====================
  onAddStore() {
    this.setData({
      showStoreModal: true,
      storeForm: {
        _id: '',
        name: '',
        address: '',
        phone: ''
      }
    });
  },

  onEditStore(e) {
    const index = e.currentTarget.dataset.index;
    const store = this.data.stores[index];
    this.setData({
      showStoreModal: true,
      storeForm: {
        _id: store._id,
        name: store.name,
        address: store.address || '',
        phone: store.phone || ''
      }
    });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  onStoreInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`storeForm.${field}`]: e.detail.value });
  },

  async onSubmitStore() {
    const { storeForm } = this.data;
    if (!storeForm.name) {
      wx.showToast({ title: '请输入门店名称', icon: 'none' });
      return;
    }

    try {
      if (storeForm._id) {
        await request({
          url: `/stores/${storeForm._id}`,
          method: 'PUT',
          data: storeForm
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/stores',
          method: 'POST',
          data: storeForm
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showStoreModal: false });
      this.loadStores();
      if (app.getStoreList) app.getStoreList();
    } catch (err) {
      console.error('保存门店失败', err);
    }
  },

  // ==================== 舞种管理 ====================
  onAddDanceStyle() {
    this.setData({
      showDanceStyleModal: true,
      danceStyleForm: {
        _id: '',
        name: '',
        sort_order: this.data.danceStyles.length
      }
    });
  },

  onEditDanceStyle(e) {
    const index = e.currentTarget.dataset.index;
    const ds = this.data.danceStyles[index];
    this.setData({
      showDanceStyleModal: true,
      danceStyleForm: {
        _id: ds._id,
        name: ds.name,
        sort_order: ds.sort_order || 0
      }
    });
  },

  onCloseDanceStyleModal() {
    this.setData({ showDanceStyleModal: false });
  },

  onDanceStyleInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`danceStyleForm.${field}`]: e.detail.value });
  },

  async onSubmitDanceStyle() {
    const { danceStyleForm } = this.data;
    if (!danceStyleForm.name) {
      wx.showToast({ title: '请输入舞种名称', icon: 'none' });
      return;
    }

    try {
      if (danceStyleForm._id) {
        await request({
          url: `/dance-styles/${danceStyleForm._id}`,
          method: 'PUT',
          data: { name: danceStyleForm.name, sort_order: Number(danceStyleForm.sort_order) || 0 }
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/dance-styles',
          method: 'POST',
          data: { name: danceStyleForm.name, sort_order: Number(danceStyleForm.sort_order) || 0 }
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showDanceStyleModal: false });
      this.loadDanceStyles();
    } catch (err) {
      console.error('保存舞种失败', err);
    }
  },

  async onDeleteDanceStyle(e) {
    const index = e.currentTarget.dataset.index;
    const ds = this.data.danceStyles[index];
    wx.showModal({
      title: '确认删除',
      content: `确定要删除舞种「${ds.name}」吗？删除后关联的教练擅长舞种将不再显示该舞种。`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/dance-styles/${ds._id}`,
              method: 'DELETE'
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadDanceStyles();
          } catch (err) {
            console.error('删除舞种失败', err);
          }
        }
      }
    });
  }
});
