const { request } = require('../../../utils/request');
const { cropImageSafe } = require('../../../utils/util');
const app = getApp();

// 把图片URL升级为 HTTPS（修复存量 HTTP 图片在小程序端无法显示的问题）
function upgradeImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://')) return url.replace(/^http:\/\//i, 'https://');
  return url;
}

// 轮播切换方式定义（key 与后端 BANNER_MODES 一致）
const BANNER_MODE_LIST = [
  { key: 'smooth', name: '平滑滑动（默认）' },
  { key: 'fade', name: '淡入淡出' },
  { key: 'slideFade', name: '滑动淡入' },
  { key: 'zoomIn', name: '放大显现' },
  { key: 'zoomOut', name: '缩小显现' },
  { key: 'flipH', name: '横向翻转' },
  { key: 'flipV', name: '纵向翻转' },
  { key: 'rotateZoom', name: '旋转放大' },
  { key: 'rotateIn', name: '旋转进入' },
  { key: 'slideUp', name: '上滑显现' },
  { key: 'slideDown', name: '下滑显现' },
  { key: 'blurIn', name: '清晰聚焦' },
  { key: 'breath', name: '呼吸缩放' },
  { key: 'curtain', name: '窗帘展开' },
  { key: 'door', name: '开门显现' }
];
const INTERVAL_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // 秒

Page({
  data: {
    banners: [],
    showModal: false,
    editingBanner: null,
    uploading: false,
    deleting: false, // 防抖标志位
    isSuperAdmin: false,
    can_operate: false, // 是否可操作（仅超管/审核员可编辑/删除/启禁用）
    // 轮播展示设置（仅超管可修改，其他角色置灰）
    configExpanded: false,  // 设置区折叠状态：默认收起
    displayConfig: { interval: 2, mode: 'smooth' },
    intervalOptions: INTERVAL_OPTIONS,
    intervalIndex: 1, // 2秒
    modeOptions: BANNER_MODE_LIST,
    modeIndex: 0,
    savingConfig: false,
    // 全平台轮播图：store_id 固定为空字符串（多门店展示）
    formData: {
      title: '',
      subtitle: '',
      image_url: '',
      link_url: '',
      sort_order: 1,
      status: 'active',
      store_id: ''  // '' = 多门店展示（全平台轮播图）
    }
  },

  onShow() {
    if (!app.checkAuth()) return;
    const userInfo = app.globalData.userInfo;
    const role = userInfo && userInfo.role;
    // 权限控制：仅超级管理员和审核员可操作（编辑/删除/启禁用），其他角色只读
    const canOperate = role === 'super_admin' || role === 'reviewer';
    this.setData({
      isSuperAdmin: !!(userInfo && userInfo.role === 'super_admin'),
      can_operate: canOperate
    });
    this.loadBanners();
    this.loadDisplayConfig();
  },

  // 加载轮播展示配置（轮换间隔 + 切换方式）
  async loadDisplayConfig() {
    try {
      const res = await request({ url: '/banners/display-config', method: 'GET' });
      const cfg = res.data || {};
      const interval = parseInt(cfg.interval, 10) >= 1 ? parseInt(cfg.interval, 10) : 2;
      const mode = cfg.mode || 'smooth';
      const intervalIndex = Math.max(0, INTERVAL_OPTIONS.indexOf(interval));
      const modeIndex = Math.max(0, BANNER_MODE_LIST.findIndex(m => m.key === mode));
      this.setData({
        displayConfig: { interval, mode },
        intervalIndex,
        modeIndex
      });
    } catch (err) {
      console.error('加载轮播展示设置失败', err);
    }
  },

  // 非超管点击置灰项提示
  onConfigDisabled() {
    wx.showToast({ title: '仅超级管理员可修改轮播展示设置', icon: 'none' });
  },

  // 展开/收起轮播展示设置区
  onToggleConfigExpand() {
    this.setData({ configExpanded: !this.data.configExpanded });
  },

  onIntervalChange(e) {
    if (!this.data.isSuperAdmin) return;
    const idx = Number(e.detail.value);
    this.setData({
      intervalIndex: idx,
      'displayConfig.interval': INTERVAL_OPTIONS[idx]
    });
  },

  onModeChange(e) {
    if (!this.data.isSuperAdmin) return;
    const idx = Number(e.detail.value);
    this.setData({
      modeIndex: idx,
      'displayConfig.mode': BANNER_MODE_LIST[idx].key
    });
  },

  // 保存轮播展示配置（仅超管）
  async onSaveDisplayConfig() {
    if (!this.data.isSuperAdmin) {
      wx.showToast({ title: '仅超级管理员可修改', icon: 'none' });
      return;
    }
    if (this.data.savingConfig) return;
    const { interval, mode } = this.data.displayConfig;
    this.setData({ savingConfig: true });
    try {
      await request({
        url: '/banners/display-config',
        method: 'PUT',
        data: { interval, mode }
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
      // 保存成功后收起设置区
      this.setData({ configExpanded: false });
    } catch (err) {
      console.error('保存轮播展示设置失败', err);
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingConfig: false });
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
        // 可操作性：仅超管/审核员可操作全平台轮播图
        const role = app.globalData.userInfo && app.globalData.userInfo.role;
        const canOperate = role === 'super_admin' || role === 'reviewer';
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
      // 仅展示全平台轮播图（store_id 为空 = 多门店展示）
      list = list.filter(banner => !banner.store_id);
      this.setData({ banners: list });
    } catch (err) {
      console.error('加载轮播图失败', err);
    }
  },

  onAddBanner() {
    // 权限校验：非超管/审核员不可添加
    if (!this.data.can_operate) {
      wx.showToast({ title: '仅超级管理员/审核员可操作', icon: 'none' });
      return;
    }
    // 全平台轮播图：store_id 固定为空字符串（多门店展示）
    this.setData({
      showModal: true,
      editingBanner: null,
      formData: {
        title: '',
        subtitle: '',
        image_url: '',
        link_url: '',
        sort_order: 1,
        status: 'active',
        store_id: ''
      }
    });
  },

  onEditBanner(e) {
    const { id } = e.currentTarget.dataset;
    const banner = this.data.banners.find(b => b._id === id);
    if (!banner) return;
    if (banner.can_operate === false) {
      wx.showToast({ title: '仅超级管理员/审核员可编辑', icon: 'none' });
      return;
    }
    this.setData({
      showModal: true,
      editingBanner: banner,
      formData: {
        title: banner.title || '',
        subtitle: banner.subtitle || '',
        image_url: banner.image_url || '',
        link_url: banner.link_url || '',
        sort_order: banner.sort_order || 1,
        status: banner.status || 'active',
        store_id: '' // 全平台轮播图固定为空
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
      // 全平台轮播图：store_id 固定为空字符串
      const payload = { ...formData, store_id: '' };
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
      wx.showToast({ title: '仅超级管理员/审核员可删除', icon: 'none' });
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
      wx.showToast({ title: '仅超级管理员/审核员可操作', icon: 'none' });
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

  // 非超管/审核员禁用操作的提示
  onDisabledBannerAction() {
    wx.showToast({ title: '仅超级管理员/审核员可操作', icon: 'none' });
  }
});
