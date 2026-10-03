const app = getApp();
const { request } = require('../../../utils/request');
const { cropImageSafe } = require('../../../utils/util');

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
    coaches: [],
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
    deleting: false, // 防抖标志位
    isSingleStore: false,
    isReviewer: false,
    currentStoreId: '', // 当前统一门店选择（店务全局 shopStoreId）
    reordering: false, // 排序请求防抖
    emptyText: '暂无教练',
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
    // 标记当前用户是否为超级管理员（用于教练列表判断是否可操作多门店执教教练）
    const userInfo = app.globalData.userInfo;
    const isSingleStore = app.isSingleStoreRole ? app.isSingleStoreRole() : false;
    this.setData({
      isSuperAdmin: userInfo && userInfo.role === 'super_admin',
      isSingleStore,
      isReviewer: userInfo && userInfo.role === 'reviewer'
    });
    // 同步全局统一门店选择的门店名称（供页面展示区域使用）
    this.setData({ currentStoreName: app.getShopStoreName() });
    this.loadCoaches();
  },

  async loadCoaches() {
    try {
      const shopStoreId = app.globalData.shopStoreId || '';

      // 未选门店时列表为空（与店务其他门店功能一致，入口处已拦截，此处兜底）
      if (!shopStoreId) {
        this.setData({
          coaches: [],
          currentStoreId: '',
          emptyText: '请先在店务管理中选择门店'
        });
        return;
      }

      // 传 store_id 让后端附带按门店解析的展示配置（store_config：有效排序/任教状态）
      const res = await request({
        url: '/coaches/admin',
        method: 'GET',
        data: { store_id: shopStoreId, pageSize: 200 }
      });
      // 后端返回 paginate 格式: { list: [...], total, page, pageSize }
      let list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);

      // 合并列表 = 本门店教练（store_ids 含本店）+ 多门店执教教练（store_ids 为空，资源库共享）
      list = list.filter(coach => {
        const sids = Array.isArray(coach.store_ids) ? coach.store_ids : [];
        return sids.length === 0 || sids.some(sid => String(sid) === String(shopStoreId));
      });

      // 按本店有效排序（store_config.sort_order，未配置回退全局 sort_order），同序按创建时间
      list.sort((a, b) => {
        const ao = a.store_config ? (a.store_config.sort_order || 0) : (a.sort_order || 0);
        const bo = b.store_config ? (b.store_config.sort_order || 0) : (b.sort_order || 0);
        if (ao !== bo) return ao - bo;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });

      // 未任教教练沉底展示（会员端已隐藏，仅管理端可见可恢复）
      const teaching = list.filter(c => !c.store_config || c.store_config.is_teaching !== false);
      const notTeaching = list.filter(c => c.store_config && c.store_config.is_teaching === false);
      const ordered = teaching.concat(notTeaching);

      const processedList = ordered.map((coach, idx) => {
        const isTeaching = !coach.store_config || coach.store_config.is_teaching !== false;
        const teachingPos = isTeaching ? teaching.indexOf(coach) : -1;
        return {
          ...coach,
          avatar_url: this.fixImageUrl(coach.avatar_url),
          // 多门店执教教练：store_ids 为空或不存在 = 多门店执教（资源库共享教练）
          isMultiStoreCoach: !coach.store_ids || coach.store_ids.length === 0,
          // 资料操作（编辑/删除/启停）：多门店执教教练仅超管可操作
          canOperate: !((!coach.store_ids || coach.store_ids.length === 0) && !(app.globalData.userInfo && app.globalData.userInfo.role === 'super_admin')),
          // 本店任教状态（关闭后会员端不再展示该教练）
          isTeaching,
          // 本店排序位置（任教中教练显示第 n 位，即会员端顺序）
          displayOrder: isTeaching ? teachingPos + 1 : 0,
          canMoveUp: isTeaching && teachingPos > 0,
          canMoveDown: isTeaching && teachingPos < teaching.length - 1
        };
      });
      this.setData({ coaches: processedList, currentStoreId: shopStoreId, emptyText: '暂无教练' });
    } catch (err) {
      console.error('加载教练列表失败', err);
      wx.showToast({ title: '加载教练列表失败', icon: 'none' });
    }
  },

  // 加载舞种列表并构建教练弹窗的多选列表（在打开弹窗时即时调用）
  async loadDanceStylesForModal() {
    try {
      const res = await request({
        url: '/dance-styles',
        method: 'GET'
      });
      // 后端返回 paginate 格式: { list: [...], total, page, pageSize }

      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.buildDanceStyleList(list);
    } catch (err) {
      console.error('加载舞种列表失败', err);
      this.setData({ danceStyleList: [] });
    }
  },

  // 根据传入的舞种列表与 coachForm.dance_style_ids 生成带 selected 的舞种列表
  buildDanceStyleList(danceStyles) {
    const { coachForm } = this.data;
    const selectedIds = coachForm.dance_style_ids || [];
    const list = (danceStyles || []).map(ds => ({
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
      // 打开弹窗时即时加载舞种列表
      this.loadDanceStylesForModal();
    });
  },

  // 多门店执教教练对非超管禁用操作的提示
  onDisabledCoachAction() {
    wx.showToast({ title: '多门店执教教练仅超级管理员可操作', icon: 'none' });
  },

  // switch 组件禁用时仍可能触发 change，做兜底拦截
  onDisabledCoachSwitch(e) {
    // disabled 状态下 switch 不应变化，但为保险做拦截提示
    wx.showToast({ title: '多门店执教教练仅超级管理员可操作', icon: 'none' });
    // 强制恢复原状态（防止 UI 误切换）
    const { index } = e.currentTarget.dataset;
    if (index !== undefined) {
      const coach = this.data.coaches[index];
      this.setData({ [`coaches[${index}].status`]: coach.status });
    }
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
      // 打开弹窗时即时加载舞种列表
      this.loadDanceStylesForModal();
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

  // ==================== 本店展示配置（排序/任教，含多门店执教教练） ====================

  // 上移/下移：仅在任教教练序列内交换，成功后把完整顺序提交后端
  async onMoveCoach(e) {
    if (this.data.isReviewer) {
      wx.showToast({ title: '当前为审核账号，仅可查看', icon: 'none' });
      return;
    }
    if (this.data.reordering) return;
    const { index, direction } = e.currentTarget.dataset;
    const list = this.data.coaches.slice();
    const i = Number(index);
    const item = list[i];
    if (!item || !item.isTeaching) return;

    // 任教教练在列表中的位置序列（未任教教练沉底，不参与排序）
    const teachingPositions = [];
    list.forEach((c, idx) => { if (c.isTeaching) teachingPositions.push(idx); });
    const pos = teachingPositions.indexOf(i);
    if (pos === -1) return;
    const targetPos = direction === 'up' ? pos - 1 : pos + 1;
    if (targetPos < 0 || targetPos >= teachingPositions.length) return;

    const j = teachingPositions[targetPos];
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;

    // 重新计算任教序列的展示位置
    const reordered = this.recalculateDisplayOrder(list);
    this.setData({ coaches: reordered, reordering: true });
    try {
      await request({
        url: '/coaches/store-configs/reorder',
        method: 'PUT',
        data: {
          store_id: this.data.currentStoreId,
          coach_ids: reordered.filter(c => c.isTeaching).map(c => c._id)
        }
      });
    } catch (err) {
      console.error('更新教练排序失败', err);
      wx.showToast({ title: err.message || '排序保存失败', icon: 'none' });
      this.loadCoaches();
    } finally {
      this.setData({ reordering: false });
    }
  },

  // 根据任教状态重新计算 displayOrder / canMoveUp / canMoveDown（任教序列内）
  recalculateDisplayOrder(list) {
    let teachingIdx = 0;
    const teachingCount = list.filter(c => c.isTeaching).length;
    return list.map((c, idx) => {
      if (!c.isTeaching) {
        return { ...c, displayOrder: 0, canMoveUp: false, canMoveDown: false };
      }
      const item = {
        ...c,
        displayOrder: teachingIdx + 1,
        canMoveUp: teachingIdx > 0,
        canMoveDown: teachingIdx < teachingCount - 1
      };
      teachingIdx += 1;
      return item;
    });
  },

  // 本店任教开关：关闭后该教练在本门店会员端（首页/教练列表）隐藏
  async onToggleTeaching(e) {
    if (this.data.isReviewer) {
      wx.showToast({ title: '当前为审核账号，仅可查看', icon: 'none' });
      return;
    }
    const { id, index } = e.currentTarget.dataset;
    const coach = this.data.coaches[index];
    if (!coach) return;
    const newValue = !coach.isTeaching;
    try {
      await request({
        url: `/coaches/${id}/store-config`,
        method: 'PUT',
        data: { store_id: this.data.currentStoreId, is_teaching: newValue }
      });
      // 恢复任教时排到任教序列末尾，避免插队打乱现有顺序
      if (newValue) {
        const teachingIds = this.data.coaches
          .filter(c => c.isTeaching && String(c._id) !== String(id))
          .map(c => c._id);
        teachingIds.push(id);
        await request({
          url: '/coaches/store-configs/reorder',
          method: 'PUT',
          data: { store_id: this.data.currentStoreId, coach_ids: teachingIds }
        });
      }
      this.loadCoaches();
    } catch (err) {
      console.error('切换任教状态失败', err);
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      this.loadCoaches();
    }
  },

  // ==================== 教练相册管理（在编辑弹窗中） ====================

  // 隐私授权同意回调
  onPrivacyAgreed(e) {
    console.log('[Privacy] 用户点击同意隐私授权');
    const buttonId = e.currentTarget.id || e.target.id || 'agree-btn';
    app.resolvePrivacyAuthorization(buttonId);
  },

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
        // 裁剪：正方形1:1，开发者工具不支持时自动跳过裁剪
        let filePath = file.tempFilePath;
        try {
          filePath = await cropImageSafe(filePath, '1:1');
        } catch (cropErr) {
          // 用户取消裁剪：中断流程
          if (cropErr.errMsg && cropErr.errMsg.indexOf('cancel') !== -1) return;
          // 其他异常：跳过裁剪继续上传（兜底）
          console.warn('裁剪异常，使用原图', cropErr);
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
  }
});
