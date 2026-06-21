const { request } = require('../../../utils/request');

Page({
  data: {
    loading: false,
    list: [],
    storeList: [],
    storeListForPicker: [],
    currentStoreId: '',
    currentStoreName: '',
    keyword: '',
    currentStatus: 'pending',  // pending / claimed / all
    // 新建/编辑弹窗
    showFormModal: false,
    editingId: '',
    form: {
      real_name: '',
      gender: 0,
      reserve_phone: '',
      store_id: '',
      store_name: '',
      package_type: '',
      start_date: '',
      end_date: '',
      total_credits: '',
      period_type: 'weekly',
      period_count: '',
      remark: ''
    },
    // 门店选择弹窗
    showStorePicker: false,
    // 日期选择器
    showDatePicker: false,
    datePickerField: '', // start_date / end_date
    datePickerValue: '',
    datePickerTitle: ''
  },

  onLoad() {
    this.loadStoreList();
  },

  onShow() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadStoreList() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({
        storeList: list,
        storeListForPicker: list
      });
    } catch (err) {
      console.error('加载门店列表失败', err);
    }
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const params = {
        store_id: this.data.currentStoreId,
        keyword: this.data.keyword,
        status: this.data.currentStatus,
        pageSize: 100
      };
      const res = await request({
        url: '/pre-members',
        method: 'GET',
        data: params
      });
      const list = res.data && res.data.list ? res.data.list : [];
      // 格式化显示
      const formattedList = list.map(item => {
        return {
          ...item,
          created_at_text: item.created_at ? this._formatDate(item.created_at) : '',
          package_text: this._formatPackageText(item.packages)
        };
      });
      this.setData({ list: formattedList, loading: false });
    } catch (err) {
      console.error('加载预建档列表失败', err);
      this.setData({ loading: false });
    }
  },

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  _formatPackageText(packages) {
    if (!packages || packages.length === 0) return '';
    const pkg = packages[0];
    const typeText = pkg.package_type === 'count_card' ? '次卡' : '时间卡';
    const startText = pkg.start_date ? this._formatDate(pkg.start_date) : '';
    const endText = pkg.end_date ? this._formatDate(pkg.end_date) : '';
    let detail = '';
    if (pkg.package_type === 'count_card') {
      detail = `${pkg.total_credits}次`;
    } else {
      if (pkg.weekly_limit) detail = `每周${pkg.weekly_limit}次`;
      else if (pkg.daily_limit) detail = `每天${pkg.daily_limit}次`;
      else detail = '不限';
    }
    return `${typeText} · ${detail} · ${startText}~${endText}`;
  },

  // 门店筛选
  onStoreFilterChange(e) {
    const id = e.currentTarget.dataset.id;
    const store = this.data.storeList.find(s => s._id === id);
    this.setData({
      currentStoreId: id,
      currentStoreName: store ? store.name : ''
    });
    this.loadList();
  },

  // 搜索
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.loadList();
  },

  onClearSearch() {
    this.setData({ keyword: '' });
    this.loadList();
  },

  // 状态标签切换
  onStatusTabChange(e) {
    this.setData({ currentStatus: e.currentTarget.dataset.status });
    this.loadList();
  },

  // ========== 新建/编辑弹窗 ==========
  onCreatePreMember() {
    const defaultStore = this.data.currentStoreId ? this.data.storeList.find(s => s._id === this.data.currentStoreId) : null;
    this.setData({
      showFormModal: true,
      editingId: '',
      form: {
        real_name: '',
        gender: 0,
        reserve_phone: '',
        store_id: defaultStore ? defaultStore._id : '',
        store_name: defaultStore ? defaultStore.name : '',
        package_type: '',
        start_date: '',
        end_date: '',
        total_credits: '',
        period_type: 'weekly',
        period_count: '',
        remark: ''
      }
    });
  },

  async onEditPreMember(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const res = await request({ url: `/pre-members/${id}`, method: 'GET' });
      const data = res.data;
      const storeObj = data.store_id && data.store_id._id ? data.store_id : { _id: data.store_id, name: '' };
      const pkg = data.packages && data.packages.length > 0 ? data.packages[0] : null;
      this.setData({
        showFormModal: true,
        editingId: id,
        form: {
          real_name: data.real_name || '',
          gender: data.gender || 0,
          reserve_phone: data.reserve_phone || '',
          store_id: storeObj._id || '',
          store_name: storeObj.name || '',
          package_type: pkg ? pkg.package_type : '',
          start_date: pkg && pkg.start_date ? this._formatDate(pkg.start_date) : '',
          end_date: pkg && pkg.end_date ? this._formatDate(pkg.end_date) : '',
          total_credits: pkg && pkg.total_credits ? String(pkg.total_credits) : '',
          period_type: pkg && pkg.weekly_limit ? 'weekly' : (pkg && pkg.daily_limit ? 'daily' : 'unlimited'),
          period_count: pkg && pkg.weekly_limit ? String(pkg.weekly_limit) : (pkg && pkg.daily_limit ? String(pkg.daily_limit) : ''),
          remark: data.remark || ''
        }
      });
    } catch (err) {
      wx.showToast({ title: '加载详情失败', icon: 'none' });
    }
  },

  onCloseFormModal() {
    this.setData({ showFormModal: false, editingId: '' });
  },

  onModalTap() {
    // 阻止冒泡
  },

  onModalTouchMove() {
    // 阻止弹窗滑动时穿透到后面页面
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onGenderSelect(e) {
    this.setData({ 'form.gender': Number(e.currentTarget.dataset.gender) });
  },

  onPackageTypeChange(e) {
    this.setData({ 'form.package_type': e.currentTarget.dataset.type });
  },

  onPeriodTypeChange(e) {
    this.setData({ 'form.period_type': e.currentTarget.dataset.period });
  },

  // ========== 自定义门店选择弹窗 ==========
  onOpenStorePicker() {
    this.setData({ showStorePicker: true });
  },

  onCloseStorePicker() {
    this.setData({ showStorePicker: false });
  },

  onSelectStore(e) {
    const { id, name } = e.currentTarget.dataset;
    // 先更新选中态，让用户立即看到高亮反馈
    this.setData({
      'form.store_id': id,
      'form.store_name': name
    });
    // 延迟 300ms 关闭弹窗，让用户看到选中动画
    setTimeout(() => {
      this.setData({ showStorePicker: false });
    }, 300);
  },

  // ========== 自定义日期选择器 ==========
  onOpenDatePicker(e) {
    const field = e.currentTarget.dataset.field;
    const currentValue = this.data.form[field] || '';
    const title = field === 'start_date' ? '选择开始日期' : '选择结束日期';
    this.setData({
      showDatePicker: true,
      datePickerField: field,
      datePickerValue: currentValue,
      datePickerTitle: title
    });
  },

  onDatePickerConfirm(e) {
    const { value } = e.detail;
    const field = this.data.datePickerField;
    this.setData({
      [`form.${field}`]: value,
      showDatePicker: false,
      datePickerField: '',
      datePickerValue: ''
    });
  },

  onDatePickerCancel() {
    this.setData({
      showDatePicker: false,
      datePickerField: '',
      datePickerValue: ''
    });
  },

  async onSubmitForm() {
    const { form, editingId } = this.data;

    // 基础校验
    if (!form.store_id) {
      wx.showToast({ title: '请选择门店', icon: 'none' });
      return;
    }
    if (!form.real_name || !form.real_name.trim()) {
      wx.showToast({ title: '请输入会员姓名', icon: 'none' });
      return;
    }
    if (form.gender !== 1 && form.gender !== 2) {
      wx.showToast({ title: '请选择性别', icon: 'none' });
      return;
    }
    if (!form.reserve_phone || form.reserve_phone.length !== 11) {
      wx.showToast({ title: '请输入11位手机号', icon: 'none' });
      return;
    }

    // 套餐校验
    if (form.package_type) {
      if (!form.start_date || !form.end_date) {
        wx.showToast({ title: '请选择有效期', icon: 'none' });
        return;
      }
      if (form.package_type === 'count_card' && (!form.total_credits || Number(form.total_credits) <= 0)) {
        wx.showToast({ title: '请输入总次数', icon: 'none' });
        return;
      }
      if (form.package_type === 'time_card' && form.period_type !== 'unlimited' && (!form.period_count || Number(form.period_count) <= 0)) {
        wx.showToast({ title: '请输入周期次数', icon: 'none' });
        return;
      }
    }

    // 构造请求数据
    const payload = {
      real_name: form.real_name.trim(),
      gender: form.gender,
      reserve_phone: form.reserve_phone,
      store_id: form.store_id,
      remark: form.remark || ''
    };

    if (form.package_type) {
      const packageData = {
        package_type: form.package_type,
        start_date: form.start_date,
        end_date: form.end_date
      };
      if (form.package_type === 'count_card') {
        packageData.total_credits = Number(form.total_credits);
      } else {
        if (form.period_type === 'weekly') {
          packageData.weekly_limit = Number(form.period_count);
        } else if (form.period_type === 'daily') {
          packageData.daily_limit = Number(form.period_count);
        }
      }
      payload.package = packageData;
    }

    wx.showLoading({ title: '提交中...' });
    try {
      if (editingId) {
        await request({ url: `/pre-members/${editingId}`, method: 'PUT', data: payload });
        wx.showToast({ title: '更新成功', icon: 'success' });
      } else {
        await request({ url: '/pre-members', method: 'POST', data: payload });
        wx.showToast({ title: '创建成功', icon: 'success' });
      }
      this.setData({ showFormModal: false, editingId: '' });
      this.loadList();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // ========== 删除 ==========
  onDeletePreMember(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定删除该预建档记录？',
      confirmColor: '#D4786E',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({ url: `/pre-members/${id}`, method: 'DELETE' });
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadList();
          } catch (err) {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 查看详情
  onViewDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/package-member/pages/members/member-detail/member-detail?id=${id}` });
  },

  // 查看正式会员详情
  onViewOfficialMember(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/package-member/pages/members/member-detail/member-detail?id=${id}` });
  },

  // ========== 批量导入 ==========
  onGoImport() {
    wx.navigateTo({ url: '/package-member/pages/pre-member/pre-member-import' });
  }
});
