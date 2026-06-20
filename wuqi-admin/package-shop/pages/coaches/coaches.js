const app = getApp();
const { request } = require('../../../utils/request');

// 最大图片上传大小（与后端 multer limits.fileSize 一致）
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// 从上传错误中提取有意义的提示信息
function getUploadErrorMessage(err) {
  if (!err) return '上传失败，请重试';
  const msg = err.message || err.errMsg || String(err);
  // 服务器返回的具体错误
  if (msg.includes('文件过大')) return msg;
  if (msg.includes('不支持的图片类型')) return msg;
  if (msg.includes('413')) return '图片文件过大，最大支持 10MB';
  if (msg.includes('timeout') || msg.includes('超时')) return '上传超时，请检查网络后重试';
  if (msg.includes('fail') || msg.includes('网络')) return '网络异常，请检查网络后重试';
  // 服务器返回的业务错误
  try {
    const data = JSON.parse(msg);
    if (data && data.message) return data.message;
  } catch (e) {}
  return '上传失败，请重试';
}

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
      avatar_url: '',
      sort_order: 0,
      show_on_home: true
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
    deleting: false // 防抖标志位
  },

  // 补全图片 URL
  fixImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('https://')) return url;
    const config = require('../../../config/index.js');
    const serverBase = config.serverBase || '';
    // HTTP IP地址（旧数据），提取相对路径后重新拼接当前环境地址
    if (url.startsWith('http://')) {
      const match = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      if (match) return serverBase + match[1];
      return url;
    }
    if (url.startsWith('//')) return serverBase.replace(/^https?:/, '') + url;
    if (url.startsWith('/')) return serverBase + url;
    return serverBase + '/' + url;
  },

  /**
   * 从完整URL中提取相对路径，用于保存到后端
   */
  extractRelativePath(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const match = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      return match ? match[1] : url;
    }
    return url;
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
        avatar_url: this.fixImageUrl(coach.avatar_url)
      }));
      this.setData({ coaches: processedList });
    } catch (err) {
      console.error('加载教练列表失败', err);
      wx.showToast({ title: '加载教练列表失败', icon: 'none' });
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
        avatar_url: '',
        sort_order: 0,
        show_on_home: true
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
        avatar_url: coach.avatar_url || '',
        sort_order: coach.sort_order || 0,
        show_on_home: coach.show_on_home !== false
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

  onCoachSwitchChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`coachForm.${field}`]: e.detail.value });
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
      avatar_url: this.extractRelativePath(coachForm.avatar_url || ''),
      sort_order: Number(coachForm.sort_order) || 0,
      show_on_home: coachForm.show_on_home !== false,
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
    // 防抖处理：如果正在删除中，则直接返回
    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }
    
    const index = e.currentTarget.dataset.index;
    const coach = this.data.coaches[index];
    wx.showModal({
      title: '确认删除',
      content: `确定要删除教练「${coach.name}」吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            // 设置防抖标志位
            this.setData({ deleting: true });
            await request({
              url: `/coaches/${coach._id}`,
              method: 'DELETE'
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadCoaches();
          } catch (err) {
            console.error('删除教练失败', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          } finally {
            // 无论成功或失败，都重置防抖标志位
            this.setData({ deleting: false });
          }
        }
      },
      fail: () => {
        // 用户取消删除，重置防抖标志位
        this.setData({ deleting: false });
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

  // ==================== 教练相册管理（在编辑弹窗中） ====================

  // 编辑弹窗中选择头像
  onChooseAvatar() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const file = res.tempFiles[0];
        // 上传前检查文件大小
        if (file.size > MAX_IMAGE_SIZE) {
          wx.showToast({ title: '图片过大，最大支持 10MB', icon: 'none' });
          return;
        }
        // 裁剪：正方形1:1，用户可缩放/拖动
        let filePath = file.tempFilePath;
        try {
          if (wx.cropImage) {
            const cropRes = await new Promise((resolve, reject) => {
              wx.cropImage({ src: filePath, cropScale: '1:1', success: resolve, fail: reject });
            });
            filePath = cropRes.tempFilePath;
          }
        } catch (cropErr) {
          if (cropErr.errMsg && cropErr.errMsg.indexOf('cancel') !== -1) return;
        }
        wx.showLoading({ title: '上传中...' });
        try {
          const uploadRes = await new Promise((resolve, reject) => {
            wx.uploadFile({
              url: app.globalData.baseUrl + '/upload/image?type=coach_avatar',
              filePath: filePath,
              name: 'image',
              header: { 'Authorization': 'Bearer ' + wx.getStorageSync('admin_token') },
              success: resolve,
              fail: reject
            });
          });
          const data = JSON.parse(uploadRes.data);
          if (data.code === 200) {
            const relativePath = data.data.path;
            const fullUrl = this.fixImageUrl(relativePath);
            that.setData({ 'coachForm.avatar_url': fullUrl });
            wx.hideLoading();
            wx.showToast({ title: '头像上传成功', icon: 'success' });
          } else {
            wx.hideLoading();
            wx.showToast({ title: data.message || '上传失败', icon: 'none' });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: getUploadErrorMessage(err), icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('选择图片失败', err);
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败，请检查隐私权限', icon: 'none' });
        }
      }
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
    // 防抖处理：如果正在删除中，则直接返回
    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }
    
    const index = e.currentTarget.dataset.index;
    const ds = this.data.danceStyles[index];
    wx.showModal({
      title: '确认删除',
      content: `确定要删除舞种「${ds.name}」吗？删除后关联的教练擅长舞种将不再显示该舞种。`,
      success: async (res) => {
        if (res.confirm) {
          try {
            // 设置防抖标志位
            this.setData({ deleting: true });
            await request({
              url: `/dance-styles/${ds._id}`,
              method: 'DELETE'
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadDanceStyles();
          } catch (err) {
            console.error('删除舞种失败', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          } finally {
            // 无论成功或失败，都重置防抖标志位
            this.setData({ deleting: false });
          }
        } else {
          // 用户取消删除，重置防抖标志位
          this.setData({ deleting: false });
        }
      },
      fail: () => {
        // 用户取消删除，重置防抖标志位
        this.setData({ deleting: false });
      }
    });
  }
});
