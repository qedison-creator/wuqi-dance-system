const { request } = require('../../../utils/request');
const { cropImageSafe } = require('../../../utils/util');
const app = getApp();

// 把图片URL升级为 HTTPS（修复存量 HTTP 图片在小程序端无法显示的问题）
function upgradeImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://')) return url.replace(/^http:\/\//i, 'https://');
  return url;
}

Page({
  data: {
    banners: [],
    showModal: false,
    editingBanner: null,
    uploading: false,
    deleting: false, // 防抖标志位
    isSingleStoreRole: false,
    isSuperAdmin: false,
    // 门店选择
    storeList: [],
    storeOptions: [], // [{ _id: '', name: '多门店展示' }, { _id: 'xxx', name: '门店A' }, ...]
    storeIndex: 0,
    selectedStoreName: '', // 当前全局统一门店选择的门店名称（用于页面展示）
    formData: {
      title: '',
      subtitle: '',
      image_url: '',
      link_url: '',
      sort_order: 1,
      status: 'active',
      store_id: ''  // '' = 多门店展示；ObjectId = 指定门店
    }
  },

  onShow() {
    if (!app.checkAuth()) return;
    const userInfo = app.globalData.userInfo;
    this.setData({
      isSingleStoreRole: app.isSingleStoreRole(),
      isSuperAdmin: !!(userInfo && userInfo.role === 'super_admin'),
      selectedStoreName: app.getShopStoreName()
    });
    this.loadStores();
    this.loadBanners();
  },

  async loadStores() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      // 单门店角色仅显示所属门店（不显示"多门店展示"选项）
      if (app.isSingleStoreRole()) {
        const defaultStoreId = app.getDefaultStoreId();
        const ownStore = list.find(s => String(s._id) === String(defaultStoreId));
        this.setData({
          storeList: list,
          storeOptions: ownStore ? [ownStore] : []
        });
      } else {
        // 超管/审核员/多门店店长：可创建"多门店展示"或指定门店
        this.setData({
          storeList: list,
          storeOptions: [{ _id: '', name: '多门店展示' }, ...list]
        });
      }
    } catch (err) {
      console.error('加载门店失败', err);
    }
  },

  async loadBanners() {
    try {
      const res = await request({ url: '/banners', method: 'GET', data: { pageSize: 100 } });
      const rawList = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      // 标记每条 banner 的可操作性和显示门店名
      let list = rawList.map(b => {
        const storeId = b.store_id ? (b.store_id._id || b.store_id) : '';
        const storeName = b.store_id && b.store_id.name ? b.store_id.name : '';
        const isMultiStore = !storeId; // store_id 为空 = 多门店展示
        // 可操作性：多门店展示仅超管可操作；门店专属仅所属门店可操作（由后端校验，前端做提示）
        let canOperate = true;
        if (app.globalData.userInfo && app.globalData.userInfo.role !== 'super_admin' && app.globalData.userInfo.role !== 'reviewer') {
          if (isMultiStore) {
            canOperate = false;
          } else {
            const allowed = app.getAllowedStoreIds();
            if (allowed && !allowed.includes(String(storeId))) canOperate = false;
          }
        }
        return {
          ...b,
          image_url: upgradeImageUrl(b.image_url),
          store_id: storeId,
          store_name: storeName,
          is_multi_store: isMultiStore,
          store_label: isMultiStore ? '多门店展示' : (storeName || '指定门店'),
          can_operate: canOperate
        };
      });
      // 前端按全局门店选择过滤（后端 GET /banners 不支持 store_id 查询参数）
      const shopStoreId = app.globalData.shopStoreId || '';
      if (shopStoreId) {
        list = list.filter(banner => {
          // store_id 为空表示多门店展示，保留
          if (!banner.store_id) return true;
          return String(banner.store_id) === String(shopStoreId);
        });
      }
      this.setData({ banners: list });
    } catch (err) {
      console.error('加载轮播图失败', err);
    }
  },

  onAddBanner() {
    // 默认使用全局统一门店选择；单门店角色固定所属门店；均为空时为"多门店展示"
    const shopStoreId = app.globalData.shopStoreId || '';
    let defaultStoreId = shopStoreId || (app.isSingleStoreRole() ? app.getDefaultStoreId() : '');
    let defaultStoreIndex = 0;
    if (defaultStoreId) {
      const idx = this.data.storeOptions.findIndex(s => String(s._id) === String(defaultStoreId));
      if (idx >= 0) defaultStoreIndex = idx;
    } else {
      defaultStoreIndex = 0; // 多门店展示
    }
    this.setData({
      showModal: true,
      editingBanner: null,
      storeIndex: defaultStoreIndex,
      formData: {
        title: '',
        subtitle: '',
        image_url: '',
        link_url: '',
        sort_order: 1,
        status: 'active',
        store_id: defaultStoreId
      }
    });
  },

  onEditBanner(e) {
    const { id } = e.currentTarget.dataset;
    const banner = this.data.banners.find(b => b._id === id);
    if (!banner) return;
    if (banner.can_operate === false) {
      wx.showToast({ title: '多门店展示仅超级管理员可编辑', icon: 'none' });
      return;
    }
    const storeId = banner.store_id || '';
    const idx = this.data.storeOptions.findIndex(s => String(s._id) === String(storeId));
    this.setData({
      showModal: true,
      editingBanner: banner,
      storeIndex: idx >= 0 ? idx : 0,
      formData: {
        title: banner.title || '',
        subtitle: banner.subtitle || '',
        image_url: banner.image_url || '',
        link_url: banner.link_url || '',
        sort_order: banner.sort_order || 1,
        status: banner.status || 'active',
        store_id: storeId
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

  onStoreChange(e) {
    const idx = Number(e.detail.value);
    const store = this.data.storeOptions[idx];
    this.setData({
      storeIndex: idx,
      'formData.store_id': store ? store._id : ''
    });
  },

  // 隐私授权同意回调
  onPrivacyAgreed(e) {
    console.log('[Privacy] 用户点击同意隐私授权');
    const buttonId = e.currentTarget.id || e.target.id || 'agree-btn';
    app.resolvePrivacyAuthorization(buttonId);
  },

  // 选择并上传图片（含裁剪）
  onChooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        let filePath = res.tempFiles[0].tempFilePath;
        // 裁剪：16:9横屏比例，开发者工具不支持时自动跳过裁剪
        try {
          filePath = await cropImageSafe(filePath, '16:9');
        } catch (cropErr) {
          // 用户取消裁剪：中断流程
          if (cropErr.errMsg && cropErr.errMsg.indexOf('cancel') !== -1) return;
          // 其他异常：跳过裁剪继续上传（兜底）
          console.warn('裁剪异常，使用原图', cropErr);
        }
        that.uploadImage(filePath);
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

      // 升级为 HTTPS（小程序不再支持 HTTP）
      imageUrl = upgradeImageUrl(imageUrl);

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
      const payload = { ...formData };
      if (editingBanner) {
        await request({
          url: `/banners/${editingBanner._id}`,
          method: 'PUT',
          data: payload
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/banners',
          method: 'POST',
          data: payload
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
    // 防抖处理：如果正在删除中，则直接返回
    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }

    const { id } = e.currentTarget.dataset;
    const banner = this.data.banners.find(b => b._id === id);
    if (banner && banner.can_operate === false) {
      wx.showToast({ title: '多门店展示仅超级管理员可删除', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个轮播图吗？',
      success: async (res) => {
        if (res.confirm) {
          // 设置防抖标志位
          this.setData({ deleting: true });
          try {
            await request({ url: `/banners/${id}`, method: 'DELETE' });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadBanners();
          } catch (err) {
            console.error('删除失败', err);
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
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

  async onToggleStatus(e) {
    const { id, index } = e.currentTarget.dataset;
    const banner = this.data.banners[index];
    if (banner && banner.can_operate === false) {
      wx.showToast({ title: '多门店展示仅超级管理员可操作', icon: 'none' });
      return;
    }
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
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  // 多门店展示对非超管禁用操作的提示
  onDisabledBannerAction() {
    wx.showToast({ title: '多门店展示仅超级管理员可操作', icon: 'none' });
  }
});
