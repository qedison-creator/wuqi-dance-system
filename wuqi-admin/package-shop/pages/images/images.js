const app = getApp();
const api = require('../../utils/api');
const config = require('../../../config/index.js');

Page({
  data: {
    list: [],
    coachList: [],
    // 筛选
    filterCoachId: '',
    filterShowHome: '',
    // 弹窗
    showModal: false,
    editingId: null,
    tempImagePath: '',
    formTitle: '',
    formCoachIds: [],        // 多选教练ID数组
    formCoachChecked: {},    // 教练选中状态 { coachId: true }
    formShowHome: true,
    showCoachPicker: false,  // 教练选择面板
    cropMode: '',            // 裁剪模式：portrait / landscape / free
    loading: false,
    // 多选
    selectMode: false,
    selectedIds: [],
    selectAll: false
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const params = { pageSize: 100 };
      if (this.data.filterCoachId) params.coach_id = this.data.filterCoachId;
      if (this.data.filterShowHome !== '') params.show_on_home = this.data.filterShowHome;

      const [imageRes, coachRes] = await Promise.all([
        api.images.getList(params),
        api.coaches.getList({ pageSize: 100 })
      ]);
      const rawImages = imageRes.data || {};
      const list = rawImages.list || rawImages.data || [];
      const serverBase = config.serverBase || '';
      list.forEach(item => {
        if (item.created_at) {
          item.created_at = item.created_at.substring(0, 10);
        }
        // 拼接完整图片URL

        if (item.thumbnail_url && !item.thumbnail_url.startsWith('http')) {
          item.thumbnail_url = serverBase + item.thumbnail_url;
        }
        if (item.image_url && !item.image_url.startsWith('http')) {
          item.image_url = serverBase + item.image_url;
        }
        // 拼接教练名
        item.coachNames = (item.coach_ids || []).map(c => c.name || '').filter(Boolean).join(' / ');
      });
      const coachData = coachRes.data || {};
      const coachList = coachData.list || coachData.data || [];
      this.setData({ list, coachList, loading: false });
      this._syncSelectedState();
    } catch (err) {
      console.error('加载数据失败:', err);
      this.setData({ loading: false });
    }
  },

  // 筛选教练
  onFilterCoach(e) {
    const coachId = e.currentTarget.dataset.id || '';
    this.setData({ filterCoachId: coachId }, () => this.loadData());
  },

  // 筛选首页显示
  onFilterShowHome(e) {
    const val = e.currentTarget.dataset.val;
    this.setData({ filterShowHome: val }, () => this.loadData());
  },

  // 弹窗：初始化教练选中状态
  _initCoachChecked(coachIds) {
    const checked = {};
    (coachIds || []).forEach(id => { checked[id] = true; });
    this.setData({ formCoachChecked: checked, formCoachIds: coachIds || [] });
  },

  // 显示上传弹窗
  onShowAdd() {
    this.setData({
      showModal: true,
      editingId: null,
      tempImagePath: '',
      formTitle: '',
      formShowHome: true,
      showCoachPicker: false,
      cropMode: ''
    });
    this._initCoachChecked([]);
  },

  // 显示编辑弹窗
  onShowEdit(e) {
    const item = e.currentTarget.dataset.item;
    const coachIds = (item.coach_ids || []).map(c => typeof c === 'string' ? c : c._id);
    this.setData({
      showModal: true,
      editingId: item._id,
      tempImagePath: '',
      formTitle: item.title || '',
      formShowHome: item.show_on_home !== false,
      showCoachPicker: false
    });
    this._initCoachChecked(coachIds);
  },

  // 关闭弹窗
  onCloseModal() {
    this.setData({ showModal: false });
  },

  onModalTap() {},

  // 隐私授权同意回调（用户点击 open-type="agreePrivacyAuthorization" 按钮后触发）
  onPrivacyAgreed(e) {
    console.log('[Privacy] 用户点击同意隐私授权');
    const buttonId = e.currentTarget.id || e.target.id || 'agree-btn';
    app.resolvePrivacyAuthorization(buttonId);
  },

  // 选择图片
  onChooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: (res) => {
        const filePath = res.tempFiles[0].tempFilePath;
        that.setData({ tempImagePath: filePath, cropMode: '' });
      },
      fail: (err) => {
        // 用户取消 - 静默处理
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
        console.error('选择图片失败:', err);
        const errLower = (err.errMsg || '').toLowerCase();
        // 隐私授权问题：onNeedPrivacyAuthorization 已自动 agree，提示用户重新点击即可
        if (errLower.indexOf('privacy') !== -1) {
          wx.showToast({ title: '请重新点击上传按钮重试', icon: 'none' });
          return;
        }
        // 相机权限拒绝 - 引导去设置开启（相册选择不需要 scope 授权）
        wx.getSetting({
          success: (res) => {
            const authSetting = res.authSetting || {};
            if (authSetting['scope.camera'] === false) {
              wx.showModal({
                title: '权限提示',
                content: '拍照需要相机权限，请在设置中开启后重试',
                confirmText: '去设置',
                cancelText: '取消',
                success: (modalRes) => {
                  if (modalRes.confirm) wx.openSetting();
                }
              });
            } else {
              wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
            }
          },
          fail: () => {
            wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
          }
        });
      }
    });
  },

  // 选择裁剪模式并裁剪
  onCropModeSelect(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!this.data.tempImagePath) return;

    const cropScaleMap = {
      'portrait': '3:4',
      'landscape': '16:9',
      'free': ''
    };
    const cropScale = cropScaleMap[mode];
    const cropOptions = {
      src: this.data.tempImagePath,
      success: (cropRes) => {
        this.setData({ tempImagePath: cropRes.tempFilePath, cropMode: mode });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          console.error('裁剪失败:', err);
        }
      }
    };
    if (cropScale) {
      cropOptions.cropScale = cropScale;
    }
    wx.cropImage(cropOptions);
  },

  // 标题输入
  onTitleInput(e) {
    this.setData({ formTitle: e.detail.value });
  },

  // 切换教练选择面板
  onToggleCoachPicker() {
    this.setData({ showCoachPicker: !this.data.showCoachPicker });
  },

  // 教练勾选
  onCoachCheck(e) {
    const coachId = e.currentTarget.dataset.id;
    const checked = { ...this.data.formCoachChecked };
    if (checked[coachId]) {
      delete checked[coachId];
    } else {
      checked[coachId] = true;
    }
    const coachIds = Object.keys(checked);
    this.setData({ formCoachChecked: checked, formCoachIds: coachIds });
  },

  // 首页显示
  onShowHomeChange(e) {
    this.setData({ formShowHome: e.detail.value });
  },

  // 提交
  async onSubmit() {
    const { formTitle, formCoachIds, editingId, tempImagePath, formShowHome } = this.data;

    if (!formTitle.trim()) {
      wx.showToast({ title: '请输入图片名称', icon: 'none' });
      return;
    }

    try {
      if (editingId) {
        await api.images.update(editingId, {
          title: formTitle.trim(),
          coach_ids: formCoachIds,
          show_on_home: formShowHome
        });
        wx.showToast({ title: '更新成功', icon: 'success' });
      } else {
        if (!tempImagePath) {
          wx.showToast({ title: '请选择图片', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '上传中...' });
        const baseUrl = (app.globalData && app.globalData.baseUrl) || config.baseUrl;
        const token = wx.getStorageSync('token');
        await new Promise((resolve, reject) => {
          wx.uploadFile({
            url: `${baseUrl}/images`,
            filePath: tempImagePath,
            name: 'image',
            header: { 'Authorization': `Bearer ${token}` },
            formData: {
              title: formTitle.trim(),
              coach_ids: formCoachIds.join(','),
              show_on_home: String(formShowHome)
            },
            success: (res) => {
              try {
                const data = JSON.parse(res.data);
                if (data.code === 0 || data.code === 200) {
                  resolve(data);
                } else {
                  reject(new Error(data.message || '上传失败'));
                }
              } catch (e) {
                reject(new Error('服务器返回异常，可能未登录或网络错误'));
              }
            },
            fail: reject
          });
        });
        wx.hideLoading();
        wx.showToast({ title: '上传成功', icon: 'success' });
      }

      this.setData({ showModal: false });
      this.loadData();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  // 切换首页显示
  onToggleHome(e) {
    const { id, val } = e.currentTarget.dataset;
    api.images.update(id, { show_on_home: !val }).then(() => {
      this.loadData();
    }).catch(err => {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  // 删除
  onDelete(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定要删除这张图片吗？',
      confirmColor: '#D4786E',
      success: (res) => {
        if (res.confirm) {
          api.images.delete(id).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadData();
          }).catch(err => {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 同步选中状态到 list item 的 _selected 属性
  _syncSelectedState() {
    const { selectedIds, list } = this.data;
    list.forEach(item => {
      item._selected = selectedIds.indexOf(item._id) !== -1;
    });
    this.setData({ list });
  },

  // 进入多选模式
  onEnterSelectMode() {
    this.setData({ selectMode: true, selectedIds: [], selectAll: false });
  },

  // 退出多选模式
  onExitSelectMode() {
    this.setData({ selectMode: false, selectedIds: [], selectAll: false });
  },

  // 切换单选
  onToggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    const selectedIds = [...this.data.selectedIds];
    const idx = selectedIds.indexOf(id);
    if (idx === -1) {
      selectedIds.push(id);
    } else {
      selectedIds.splice(idx, 1);
    }
    const selectAll = selectedIds.length === this.data.list.length;
    this.setData({ selectedIds, selectAll });
    this._syncSelectedState();
  },

  // 切换全选
  onToggleSelectAll() {
    if (this.data.selectAll) {
      this.setData({ selectedIds: [], selectAll: false });
    } else {
      const selectedIds = this.data.list.map(item => item._id);
      this.setData({ selectedIds, selectAll: true });
    }
    this._syncSelectedState();
  },

  // 批量删除
  onBatchDelete() {
    const { selectedIds } = this.data;
    if (selectedIds.length === 0) return;

    wx.showModal({
      title: '确认删除',
      content: `确定要删除选中的 ${selectedIds.length} 张图片吗？删除后不可恢复。`,
      confirmColor: '#D4786E',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          const promises = selectedIds.map(id => api.images.delete(id));
          Promise.all(promises.map(p =>
            Promise.resolve(p).then(
              value => ({ status: 'fulfilled', value }),
              reason => ({ status: 'rejected', reason })
            )
          )).then(results => {
            wx.hideLoading();
            const failed = results.filter(r => r.status === 'rejected').length;
            if (failed > 0) {
              wx.showToast({ title: `${failed} 张删除失败`, icon: 'none' });
            } else {
              wx.showToast({ title: '已删除', icon: 'success' });
            }
            this.setData({ selectMode: false, selectedIds: [], selectAll: false });
            this.loadData();
          });
        }
      }
    });
  }
});