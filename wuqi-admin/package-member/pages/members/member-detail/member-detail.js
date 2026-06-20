const { request } = require('../../../../utils/request');
const { getBeijingDate } = require('../../../../utils/helpers');

// 预约状态文案映射（booking 专属状态，与课程状态不同）
// 统一分类：待上课 / 已完成 / 已取消
const BOOKING_STATUS_TEXT_MAP = {
  'booked': '待上课',
  'completed': '已完成',
  'cancelled': '已取消',
  'exempted': '已豁免'
};

const getBookingStatusText = (status) => {
  return BOOKING_STATUS_TEXT_MAP[status] || '已取消';
};

Page({
  data: {
    memberId: '',
    member: {},
    packages: [],
    bookings: [],
    displayBookings: [], // 只显示前5条
    memberStatusText: '',
    memberStatusClass: '',
    hasActivePackage: false,
    hasSuspendedPackage: false,
    // 门店修改弹窗
    showStoreModal: false,
    storeList: [],
    selectedStoreId: '',
    // 套餐编辑弹窗
    showPackageEditModal: false,
    editingPackage: null,
    editPackageForm: {},
    // 编辑姓名弹窗
    showEditNameModal: false,
    editNameForm: {},
    // 停卡弹窗
    showSuspendModal: false,
    suspendDays: 7,
    customSuspendDays: '',
    suspendReason: '',
    // 新增套餐弹窗
    showAddPackageModal: false,
    addPackageForm: {},
    addPackageStoreList: [],
    addPackageFormStoreIndex: 0,
    // 删除会员
    showDeleteModal: false,
    deleteConfirmName: '',
    isAdmin: false,
    // 删除套餐
    showDeletePackageModal: false,
    deletingPackage: null,
    deletePackageConfirmText: '',
    loading: false
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ memberId: options.id });
      this.loadMemberDetail();
    }
    // 判断是否是超级管理员

    const app = getApp();
    const userInfo = app.globalData.userInfo || {};
    this.setData({ isAdmin: userInfo.role === 'super_admin' });
  },

  onPullDownRefresh() {
    this.loadMemberDetail().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  loadMemberDetail() {
    this.setData({ loading: true });
    return request({
      url: `/members/${this.data.memberId}`,
      method: 'GET',
      timeout: 30000
    }).then(res => {
      const data = res.data || {};
      const member = { ...data };

      // 性别显示映射

      const genderMap = { 0: '未知', 1: '男', 2: '女' };
      member.gender_display = genderMap[member.gender] || '未知';

      // 门店名称处理

      if (member.store_id && typeof member.store_id === 'object' && member.store_id.name) {
        member.store_name = member.store_id.name;
      } else if (member.store_id && typeof member.store_id === 'string') {
        member.store_name = null;
      }

      // 从套餐推导关联门店

      const linkedStoreMap = {};
      const allPkgs = data.packages || [];
      allPkgs.forEach(pkg => {
        if (pkg.store_id && pkg.store_id.name && ['active', 'pending'].includes(pkg.status)) {
          const sid = pkg.store_id._id || pkg.store_id;
          if (!linkedStoreMap[sid]) {
            linkedStoreMap[sid] = { _id: sid, name: pkg.store_id.name };
          }
        }
      });
      member.linkedStores = Object.values(linkedStoreMap);

      // 格式化注册时间

      if (member.created_at) {
        member.created_at_display = this.formatDate(member.created_at);
      }

      // 录入套餐时间（取最早的套餐创建时间）

      const allPkgsRaw = data.packages || [];
      if (allPkgsRaw.length > 0) {
        const earliestPkg = allPkgsRaw.reduce((earliest, pkg) => {
          if (!pkg.created_at) return earliest;
          if (!earliest || new Date(pkg.created_at) < new Date(earliest.created_at)) return pkg;
          return earliest;
        }, null);
        if (earliestPkg && earliestPkg.created_at) {
          member.package_created_at_display = this.formatDate(earliestPkg.created_at);
        }
      }

      // 格式化套餐日期

      const packages = (data.packages || []).map(pkg => {
        if (pkg.start_date) {
          pkg.start_date_display = this.formatDate(pkg.start_date);
        }
        if (pkg.end_date) {
          pkg.end_date_display = this.formatDate(pkg.end_date);
        }
        // 计算剩余天数（已激活的套餐）

        if (pkg.is_activated && pkg.end_date) {
          const now = getBeijingDate();
          const end = getBeijingDate(pkg.end_date);
          const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
          pkg.remaining_days = diff;
          // 动态修正状态：已激活但有效期已过的，标记为已过期

          if (diff < 0 && (pkg.status === 'active' || pkg.status !== 'expired')) {
            pkg._displayStatus = 'expired';
          }
        } else {
          pkg.remaining_days = null;
        }
        // 格式化自动激活日期（未激活的套餐）

        if (!pkg.is_activated && pkg.auto_activate_at) {
          pkg.auto_activate_at_display = this.formatDate(pkg.auto_activate_at);
        }
        return pkg;
      });

      // 格式化预约记录日期

      const bookings = (data.bookings || []).map(booking => {
        if (booking.created_at) {
          booking.created_at_display = this.formatDateTime(booking.created_at);
        }
        // 计算课程星期

        const date = booking.schedule_id ? booking.schedule_id.date : booking.booking_date;
        if (date) {
          booking._weekday = this.getWeekDay(date);
        }
        // 统一预约状态文案
        booking.statusText = getBookingStatusText(booking.status);
        return booking;
      });

      // 计算综合会员状态

      const { statusText, statusClass, hasActive, hasSuspended } = this.calcMemberStatus(member, packages);

      this.setData({
        member: member,
        packages: packages,
        bookings: bookings || [],
        displayBookings: (bookings || []).slice(0, 5), // 只显示前5条
        memberStatusText: statusText,
        memberStatusClass: statusClass,
        hasActivePackage: hasActive,
        hasSuspendedPackage: hasSuspended,
        loading: false
      });
    }).catch(err => {
      console.error('加载会员详情失败', err);
      this.setData({ loading: false });
    });
  },

  /**
   * 计算综合会员状态
   * 优先级：已停卡 > 有使用中 > 待激活 > 已到期 > 次卡已用完 > 时间卡周期次数已用完 > 套餐已失效
   */
  calcMemberStatus(member, packages) {
    const pkgList = packages || [];
    const suspendedPackages = pkgList.filter(p => p.is_suspended);
    const hasSuspended = suspendedPackages.length > 0;

    // 账户已停用

    if (member.status === 'disabled') {
      return { statusText: '已停卡', statusClass: 'suspended', hasActive: false, hasSuspended };
    }

    // 没有套餐

    if (pkgList.length === 0) {
      return { statusText: '无套餐', statusClass: 'no-package', hasActive: false, hasSuspended: false };
    }

    // 检查是否有使用中的套餐（已激活、未停卡、未过期）

    const activePackages = pkgList.filter(p => p.status === 'active' && !p._displayStatus && p.is_activated && !p.is_suspended);
    if (activePackages.length > 0) {
      // 有活跃套餐，同时可能也有已停卡套餐（混合状态：仍算已激活，可操作停卡/复卡）

      return { statusText: '已激活', statusClass: 'activated', hasActive: true, hasSuspended };
    }

    // 所有活跃套餐都停卡了

    if (hasSuspended) {
      return { statusText: '已停卡', statusClass: 'suspended', hasActive: false, hasSuspended: true };
    }

    // 检查是否有待激活的套餐

    const pendingPackages = pkgList.filter(p => p.status === 'pending' || !p.is_activated);
    if (pendingPackages.length > 0) {
      return { statusText: '待激活', statusClass: 'pending', hasActive: false, hasSuspended: false };
    }

    // 检查是否全部过期（考虑动态修正的显示状态）

    const allExpired = pkgList.every(p => p.status === 'expired' || p._displayStatus === 'expired');
    if (allExpired) {
      return { statusText: '已到期', statusClass: 'expired', hasActive: false, hasSuspended: false };
    }

    // 检查是否全部用完

    const allExhausted = pkgList.every(p => p.status === 'exhausted');
    if (allExhausted) {
      const hasCountCard = pkgList.some(p => p.package_type === 'count_card');
      const hasTimeCard = pkgList.some(p => p.package_type === 'time_card');
      if (hasCountCard && hasTimeCard) {
        return { statusText: '套餐已用完', statusClass: 'exhausted', hasActive: false, hasSuspended: false };
      } else if (hasCountCard) {
        return { statusText: '次卡已用完', statusClass: 'exhausted', hasActive: false, hasSuspended: false };
      } else {
        return { statusText: '时间卡周期次数已用完', statusClass: 'exhausted', hasActive: false, hasSuspended: false };
      }
    }

    // 混合状态（部分过期、部分用完等）

    return { statusText: '套餐已失效', statusClass: 'expired', hasActive: false, hasSuspended: false };
  },

  /**
   * 格式化日期为 YYYY-MM-DD（北京时间）
   */
  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = getBeijingDate(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * 获取星期几（北京时间）
   */
  getWeekDay(dateStr) {
    if (!dateStr) return '';
    const d = getBeijingDate(dateStr);
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    return `周${weekDays[d.getDay()]}`;
  },

  /**
   * 格式化日期时间为 YYYY-MM-DD HH:mm（北京时间）
   */
  formatDateTime(dateStr) {
    if (!dateStr) return '';
    const d = getBeijingDate(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },

  /**
   * 修改套餐
   */
  onEditPackage(e) {
    const { id } = e.currentTarget.dataset;
    const pkg = this.data.packages.find(p => p._id === id);
    if (!pkg) return;

    this.setData({
      showPackageEditModal: true,
      editingPackage: pkg,
      editPackageForm: {
        package_type: pkg.package_type,
        total_credits: pkg.total_credits || '',
        remaining_credits: pkg.remaining_credits || '',
        duration_value: pkg.duration_value || '',
        duration_unit: pkg.duration_unit || 'month',
        limit_type: pkg.daily_limit ? 'daily' : (pkg.weekly_limit ? 'weekly' : 'unlimited'),
        limit_value: pkg.daily_limit || pkg.weekly_limit || '',
        remark: pkg.remark || ''
      }
    });
  },

  /**
   * 删除套餐 - 打开确认弹窗
   */
  onDeletePackage(e) {
    const { id } = e.currentTarget.dataset;
    const pkg = this.data.packages.find(p => p._id === id);
    if (!pkg) return;

    this.setData({
      showDeletePackageModal: true,
      deletingPackage: pkg,
      deletePackageConfirmText: ''
    });
  },

  onCloseDeletePackageModal() {
    this.setData({
      showDeletePackageModal: false,
      deletingPackage: null,
      deletePackageConfirmText: ''
    });
  },

  onDeletePackageConfirmInput(e) {
    this.setData({ deletePackageConfirmText: e.detail.value });
  },

  async onConfirmDeletePackage() {
    const { deletingPackage, deletePackageConfirmText } = this.data;
    if (!deletingPackage) return;

    const expectedText = '确认删除';
    if (deletePackageConfirmText !== expectedText) {
      wx.showToast({ title: '请输入"确认删除"', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '删除中...', mask: true });
    try {
      await request({
        url: `/packages/user/${deletingPackage._id}`,
        method: 'DELETE'
      });
      wx.hideLoading();
      wx.showToast({ title: '删除成功', icon: 'success' });
      this.setData({
        showDeletePackageModal: false,
        deletingPackage: null,
        deletePackageConfirmText: ''
      });
      this.loadMemberDetail();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.data?.message || '删除失败', icon: 'none' });
    }
  },

  /**
   * 套餐编辑弹窗 - 类型切换
   */
  onEditPackageTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      'editPackageForm.package_type': type
    });
  },

  onEditLimitTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      'editPackageForm.limit_type': type,
      'editPackageForm.limit_value': ''
    });
  },

  /**
   * 套餐编辑弹窗 - 单位切换
   */
  onEditDurationUnitChange(e) {
    const unit = e.currentTarget.dataset.unit;
    this.setData({
      'editPackageForm.duration_unit': unit
    });
  },

  /**
   * 套餐编辑弹窗 - 输入处理
   */
  onEditPackageInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({
      [`editPackageForm.${field}`]: value
    });
  },

  /**
   * 关闭套餐编辑弹窗
   */
  onClosePackageEditModal() {
    this.setData({
      showPackageEditModal: false,
      editingPackage: null,
      editPackageForm: {}
    });
  },

  onPackageEditModalTap() {},

  /**
   * 提交套餐编辑
   */
  async onSubmitPackageEdit() {
    const { editingPackage, editPackageForm } = this.data;

    // 验证必填字段

    if (editPackageForm.package_type === 'count_card' && !editPackageForm.total_credits) {
      wx.showToast({ title: '请输入次数', icon: 'none' });
      return;
    }
    if (!editPackageForm.duration_value) {
      wx.showToast({ title: '请输入有效时长', icon: 'none' });
      return;
    }

    if (editPackageForm.package_type === 'time_card') {
      if (!editPackageForm.limit_type) {
        wx.showToast({ title: '请选择限制方式', icon: 'none' });
        return;
      }
      if (editPackageForm.limit_type !== 'unlimited' && !editPackageForm.limit_value) {
        wx.showToast({ title: editPackageForm.limit_type === 'daily' ? '请输入每日限制' : '请输入每周限制', icon: 'none' });
        return;
      }
    }

    try {
      const postData = {
        remark: editPackageForm.remark,
        package_type: editPackageForm.package_type,
        duration_value: parseInt(editPackageForm.duration_value),
        duration_unit: editPackageForm.duration_unit
      };

      if (editPackageForm.package_type === 'count_card') {
        postData.total_credits = parseInt(editPackageForm.total_credits);
        postData.remaining_credits = parseInt(editPackageForm.remaining_credits);
      }

      // 时间卡可以修改限制次数

      if (editPackageForm.package_type === 'time_card') {
        if (editPackageForm.limit_type === 'daily') {
          postData.daily_limit = parseInt(editPackageForm.limit_value);
          postData.weekly_limit = null;
        } else if (editPackageForm.limit_type === 'weekly') {
          postData.weekly_limit = parseInt(editPackageForm.limit_value);
          postData.daily_limit = null;
        } else {
          postData.daily_limit = null;
          postData.weekly_limit = null;
        }
      }

      await request({
        url: `/packages/${editingPackage._id}`,
        method: 'PUT',
        data: postData
      });

      wx.showToast({ title: '修改成功', icon: 'success' });
      this.setData({ showPackageEditModal: false, editingPackage: null, editPackageForm: {} });
      this.loadMemberDetail();
    } catch (err) {
      console.error('修改套餐失败', err);
      wx.showToast({ title: err.data?.message || '修改失败', icon: 'none' });
    }
  },

  // ========== 新增套餐 ==========
  async onAddPackage() {
    const { member } = this.data;
    const defaultForm = {
      package_type: 'count_card',
      store_id: '',
      store_name: '',
      total_credits: '',
      duration_value: '',
      duration_unit: 'month',
      limit_type: 'weekly',
      limit_value: '',
      remark: ''
    };

    const memberStoreId = member.store_id && (member.store_id._id || member.store_id);
    const memberStoreName = member.store_name || '';
    if (memberStoreId) {
      defaultForm.store_id = memberStoreId;
      defaultForm.store_name = memberStoreName;
    }

    let storeList = [];
    let storeIndex = 0;
    try {
      const storeRes = await request({ url: '/stores' });
      const stores = storeRes.data && (Array.isArray(storeRes.data) ? storeRes.data : (storeRes.data.list || []));
      storeList = stores.filter(s => s.status === 'active');
      if (memberStoreId) {
        const idx = storeList.findIndex(s => s._id === memberStoreId || s._id.toString() === memberStoreId.toString());
        if (idx >= 0) storeIndex = idx;
      }
    } catch (err) {
      console.error('获取门店列表失败', err);
    }

    this.setData({
      showAddPackageModal: true,
      addPackageForm: defaultForm,
      addPackageStoreList: storeList,
      addPackageFormStoreIndex: storeIndex
    });
  },

  onAddPackageStoreChange(e) {
    const idx = e.detail.value;
    const store = this.data.addPackageStoreList[idx];
    if (store) {
      this.setData({
        addPackageFormStoreIndex: idx,
        'addPackageForm.store_id': store._id,
        'addPackageForm.store_name': store.name
      });
    }
  },

  onAddPackageTypeChange(e) {
    this.setData({ 'addPackageForm.package_type': e.currentTarget.dataset.type });
  },

  onAddPackageLimitTypeChange(e) {
    this.setData({
      'addPackageForm.limit_type': e.currentTarget.dataset.type,
      'addPackageForm.limit_value': ''
    });
  },

  onAddPackageDurationUnitChange(e) {
    this.setData({ 'addPackageForm.duration_unit': e.currentTarget.dataset.unit });
  },

  onAddPackageInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`addPackageForm.${field}`]: e.detail.value });
  },

  onCloseAddPackageModal() {
    this.setData({ showAddPackageModal: false, addPackageForm: {} });
  },

  onAddPackageModalTap() {},

  async onSubmitAddPackage() {
    const { memberId, addPackageForm, member } = this.data;

    if (!addPackageForm.store_id) {
      wx.showToast({ title: '请选择门店', icon: 'none' });
      return;
    }
    if (addPackageForm.package_type === 'count_card' && !addPackageForm.total_credits) {
      wx.showToast({ title: '请输入次数', icon: 'none' });
      return;
    }
    if (addPackageForm.package_type === 'count_card' && !addPackageForm.duration_value) {
      wx.showToast({ title: '请输入服务有效期', icon: 'none' });
      return;
    }
    if (addPackageForm.package_type === 'time_card' && !addPackageForm.duration_value) {
      wx.showToast({ title: '请输入有效时长', icon: 'none' });
      return;
    }
    if (addPackageForm.package_type === 'time_card' && !addPackageForm.limit_type) {
      wx.showToast({ title: '请选择限制方式', icon: 'none' });
      return;
    }
    if (addPackageForm.package_type === 'time_card' && addPackageForm.limit_type !== 'unlimited' && !addPackageForm.limit_value) {
      wx.showToast({ title: addPackageForm.limit_type === 'daily' ? '请输入每日限制' : '请输入每周限制', icon: 'none' });
      return;
    }

    try {
      const postData = {
        user_id: memberId,
        store_id: addPackageForm.store_id || (member.store_id && (member.store_id._id || member.store_id)) || null,
        package_type: addPackageForm.package_type,
        duration_value: parseInt(addPackageForm.duration_value),
        duration_unit: addPackageForm.duration_unit,
        remark: addPackageForm.remark
      };

      if (addPackageForm.package_type === 'count_card') {
        postData.total_credits = parseInt(addPackageForm.total_credits);
      } else {
        postData.total_credits = 9999;
        if (addPackageForm.limit_type === 'daily') {
          postData.daily_limit = parseInt(addPackageForm.limit_value);
        } else if (addPackageForm.limit_type === 'weekly') {
          postData.weekly_limit = parseInt(addPackageForm.limit_value);
        }
      }

      await request({
        url: '/packages',
        method: 'POST',
        data: postData
      });

      wx.showToast({ title: '录入成功', icon: 'success' });
      this.setData({ showAddPackageModal: false, addPackageForm: {} });
      this.loadMemberDetail();
    } catch (err) {
      console.error('录入套餐失败', err);
      wx.showToast({ title: err.data?.message || '录入失败', icon: 'none' });
    }
  },

  onSuspendCard() {
    this.setData({
      showSuspendModal: true,
      suspendDays: 7,
      customSuspendDays: '',
      suspendReason: ''
    });
  },

  onToggleMemberStatus() {
    const { member, memberId } = this.data;
    const newStatus = member.status === 'disabled' ? 'active' : 'disabled';
    const actionText = newStatus === 'disabled' ? '限制使用' : '解除限制';
    wx.showModal({
      title: `确认${actionText}`,
      content: newStatus === 'disabled'
        ? '限制后该会员将无法预约课程和查看预约人数，确定要限制吗？'
        : '解除限制后该会员将恢复使用，确定要解除吗？',
      confirmColor: newStatus === 'disabled' ? '#FF3B30' : '#C5744B',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          request({
            url: `/members/${memberId}/status`,
            method: 'PUT',
            data: { status: newStatus }
          }).then(() => {
            wx.hideLoading();
            wx.showToast({ title: newStatus === 'disabled' ? '已限制使用' : '已解除限制', icon: 'success' });
            this.loadMemberDetail();
          }).catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
        }
      }
    });
  },

  onCloseSuspendModal() {
    this.setData({ showSuspendModal: false });
  },

  onSuspendDaysSelect(e) {
    const days = parseInt(e.currentTarget.dataset.days);
    this.setData({
      suspendDays: days,
      customSuspendDays: ''
    });
  },

  onCustomSuspendDaysInput(e) {
    const value = e.detail.value;
    this.setData({
      customSuspendDays: value,
      suspendDays: value ? parseInt(value) : 0
    });
  },

  onSuspendReasonInput(e) {
    this.setData({ suspendReason: e.detail.value });
  },

  async onConfirmSuspendCard() {
    const { memberId, suspendDays, suspendReason } = this.data;
    
    if (!suspendDays || suspendDays < 1) {
      wx.showToast({ title: '请选择停卡天数', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '处理中...', mask: true });
    
    try {
      await request({
        url: `/members/${memberId}/suspend`,
        method: 'PUT',
        data: {
          suspend_days: suspendDays,
          reason: suspendReason
        }
      });
      
      wx.hideLoading();
      wx.showToast({ title: '停卡成功', icon: 'success' });
      this.setData({ showSuspendModal: false });
      this.loadMemberDetail();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.data?.message || '停卡失败', icon: 'none' });
    }
  },

  // 恢复停卡
  onUnsuspendCard() {
    const { memberId } = this.data;
    wx.showModal({
      title: '确认恢复停卡',
      content: '确定要恢复该会员的使用吗？所有停卡中的套餐将恢复正常。',
      confirmText: '确认恢复',
      confirmColor: '#C5744B',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...', mask: true });
          try {
            await request({
              url: `/members/${memberId}/unsuspend`,
              method: 'PUT'
            });
            wx.hideLoading();
            wx.showToast({ title: '已恢复使用', icon: 'success' });
            this.loadMemberDetail();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: err.data?.message || '恢复失败', icon: 'none' });
          }
        }
      }
    });
  },

  // ========== 门店修改 ==========
  async onChangeStore() {
    try {
      const res = await request({ url: '/stores' });
      const storeList = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({
        storeList: storeList,
        selectedStoreId: this.data.member.store_id?._id || this.data.member.store_id || '',
        showStoreModal: true
      });
    } catch (err) {
      wx.showToast({ title: '获取门店失败', icon: 'none' });
    }
  },

  onStoreSelect(e) {
    this.setData({ selectedStoreId: e.currentTarget.dataset.id });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  onModalTap() {},

  async onConfirmStoreChange() {
    const { memberId, selectedStoreId } = this.data;
    if (!selectedStoreId) return;
    try {
      await request({
        url: `/members/${memberId}/store`,
        method: 'PUT',
        data: { store_id: selectedStoreId }
      });
      wx.showToast({ title: '门店已修改', icon: 'success' });
      this.setData({ showStoreModal: false });
      this.loadMemberDetail();
    } catch (err) {
      wx.showToast({ title: '修改失败', icon: 'none' });
    }
  },

  // ========== 编辑姓名 ==========
  onEditName() {
    this.setData({
      showEditNameModal: true,
      editNameForm: {
        real_name: this.data.member.real_name || ''
      }
    });
  },

  onEditNameInput(e) {
    this.setData({
      'editNameForm.real_name': e.detail.value
    });
  },

  onCloseEditNameModal() {
    this.setData({
      showEditNameModal: false,
      editNameForm: {}
    });
  },

  async onSubmitEditName() {
    const { memberId, editNameForm } = this.data;
    try {
      await request({
        url: `/members/${memberId}`,
        method: 'PUT',
        data: { real_name: editNameForm.real_name }
      });
      wx.showToast({ title: '姓名已更新', icon: 'success' });
      this.setData({ showEditNameModal: false });
      this.loadMemberDetail();
    } catch (err) {
      wx.showToast({ title: '修改失败', icon: 'none' });
    }
  },

  /**
   * 查看全部预约记录
   */
  onViewAllBookings() {
    const { memberId, member } = this.data;
    wx.navigateTo({
      url: `/package-member/pages/members/booking-list/booking-list?memberId=${memberId}&memberName=${encodeURIComponent(member.real_name || member.nick_name || '会员')}`
    });
  },

  // ========== 删除会员 ==========
  onDeleteMember() {
    this.setData({ showDeleteModal: true, deleteConfirmName: '' });
  },

  onCloseDeleteModal() {
    this.setData({ showDeleteModal: false, deleteConfirmName: '' });
  },

  onDeleteConfirmInput(e) {
    this.setData({ deleteConfirmName: e.detail.value });
  },

  async onConfirmDeleteMember() {
    const { memberId, deleteConfirmName, member } = this.data;
    const expectedName = member.real_name || member.nick_name;

    if (deleteConfirmName !== expectedName) {
      wx.showToast({ title: '输入的姓名不匹配', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '删除中...', mask: true });
    try {
      await request({
        url: `/members/${memberId}`,
        method: 'DELETE'
      });
      wx.hideLoading();
      wx.showToast({ title: '会员已删除', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.data?.message || '删除失败', icon: 'none' });
    }
  }
});
