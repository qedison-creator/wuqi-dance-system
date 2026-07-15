const { request } = require('../../../utils/request');
const { fixImageUrl } = require('../../../utils/util');
const wsClient = require('../../../utils/websocket-client');

// 统一把门店 ID 转成字符串，避免 ObjectId 对象与字符串比较失败
const _normalizeStoreId = (id) => {
  if (!id) return '';
  if (typeof id === 'object') {
    return id._id || id.id || (id.toString ? id.toString() : '') || '';
  }
  return String(id);
};

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
      extra_store_ids: [],
      member_identity: 'old',
      package_type: '',
      start_date: '',
      end_date: '',
      total_credits: '',
      period_type: 'weekly',
      period_count: '',
      duration_value: '',
      duration_unit: 'month',
      remark: ''
    },
    // 门店选择弹窗
    showStorePicker: false,
    // 日期选择器
    showDatePicker: false,
    datePickerField: '', // start_date / end_date
    datePickerValue: '',
    datePickerTitle: '',
    // 附加门店开关选项（预计算 checked 状态）
    formExtraStoreOptions: [],
    // 批量管理模式
    batchMode: false,        // 是否处于批量管理模式
    selectedIds: [],         // 已选中的预建档 ID 列表
    allSelected: false       // 当前列表中可删除项是否已全部选中（半选/全选状态）
  },

  onLoad() {
    this.loadStoreList();
  },

  onShow() {
    this.loadList();
    this._connectWebSocket();
  },

  onHide() {
    wsClient.disconnect();
  },

  onUnload() {
    wsClient.disconnect();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadStoreList() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      const rawList = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const list = rawList.map(s => ({ ...s, _id: _normalizeStoreId(s._id) }));
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
          _id: String(item._id),  // 统一转为字符串，避免 indexOf/比较时类型不匹配
          _selected: false,        // 预计算选中状态，供 WXML 直接判断
          avatar_url: fixImageUrl(item.avatar_url),
          created_at_text: item.created_at ? this._formatDate(item.created_at) : '',
          package_text: this._formatPackageText(item.packages)
        };
      });
      this.setData({ list: formattedList, loading: false });
      // 列表刷新后同步批量管理状态（清理已不存在的选中项并更新全选标记 + 重算 _selected）
      // 容错：热重载可能导致新方法尚未注入到已存在的 Page 实例，此时跳过避免阻断列表加载
      if (typeof this._syncBatchState === 'function') {
        this._syncBatchState();
      }
    } catch (err) {
      console.error('加载预建档列表失败', err);
      this.setData({ loading: false });
    }
  },

  // 连接 WebSocket，接收后端预建档变更推送
  _connectWebSocket() {
    wsClient.connect({
      onMessage: {
        pre_member_change: () => {
          this._debouncedLoadList();
        }
      },
      onFallback: () => {
        this._debouncedLoadList();
      }
    });
  },

  // WebSocket 推送防抖：避免短时间内多次刷新列表
  _debouncedLoadList() {
    if (this._preMemberRefreshTimer) {
      clearTimeout(this._preMemberRefreshTimer);
    }
    this._preMemberRefreshTimer = setTimeout(() => {
      this._preMemberRefreshTimer = null;
      this.loadList();
    }, 500);
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
        store_id: defaultStore ? _normalizeStoreId(defaultStore._id) : '',
        store_name: defaultStore ? defaultStore.name : '',
        extra_store_ids: [],
        member_identity: 'old',
        package_type: '',
        start_date: '',
        end_date: '',
        total_credits: '',
        period_type: 'weekly',
        period_count: '',
        duration_value: '',
        duration_unit: 'month',
        remark: ''
      }
    });
    this._buildFormExtraStoreOptions();
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
          store_id: _normalizeStoreId(storeObj._id) || '',
          store_name: storeObj.name || '',
          extra_store_ids: pkg && pkg.extra_store_ids ? pkg.extra_store_ids.map(s => _normalizeStoreId(typeof s === 'object' ? (s._id || s.id) : s)) : [],
          member_identity: data.member_identity || 'new',
          package_type: pkg ? pkg.package_type : '',
          start_date: pkg && pkg.start_date ? this._formatDate(pkg.start_date) : '',
          end_date: pkg && pkg.end_date ? this._formatDate(pkg.end_date) : '',
          total_credits: pkg && pkg.total_credits ? String(pkg.total_credits) : '',
          period_type: pkg && pkg.weekly_limit ? 'weekly' : (pkg && pkg.daily_limit ? 'daily' : 'unlimited'),
          period_count: pkg && pkg.weekly_limit ? String(pkg.weekly_limit) : (pkg && pkg.daily_limit ? String(pkg.daily_limit) : ''),
          duration_value: pkg && pkg.duration_value ? String(pkg.duration_value) : '',
          duration_unit: pkg && pkg.duration_unit ? pkg.duration_unit : 'month',
          remark: data.remark || ''
        }
      });
      this._buildFormExtraStoreOptions();
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

  onMemberIdentityChange(e) {
    this.setData({ 'form.member_identity': e.currentTarget.dataset.identity });
  },

  onDurationUnitChange(e) {
    this.setData({ 'form.duration_unit': e.currentTarget.dataset.unit });
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
    const normalizedId = _normalizeStoreId(id);
    this.setData({
      'form.store_id': normalizedId,
      'form.store_name': name
    });
    // 主门店变更时，从附加门店中移除新主门店
    let { extra_store_ids } = this.data.form;
    extra_store_ids = (extra_store_ids || []).slice();
    const idx = extra_store_ids.indexOf(normalizedId);
    if (idx > -1) {
      extra_store_ids.splice(idx, 1);
      this.setData({ 'form.extra_store_ids': extra_store_ids });
    }
    // 重建开关选项（主门店变更后过滤条件变化）
    this._buildFormExtraStoreOptions();
    // 延迟 300ms 关闭弹窗，让用户看到选中动画
    setTimeout(() => {
      this.setData({ showStorePicker: false });
    }, 300);
  },

  /**
   * 构建附加门店开关选项列表（预计算 checked 状态，避免 WXML 中 indexOf 不可靠）
   */
  _buildFormExtraStoreOptions() {
    const { storeList, form } = this.data;
    const storeId = _normalizeStoreId(form.store_id);
    const extraIds = form.extra_store_ids || [];
    const options = storeList
      .filter(s => s.status === 'active' && _normalizeStoreId(s._id) !== storeId)
      .map(s => ({
        _id: _normalizeStoreId(s._id),
        name: s.name,
        checked: extraIds.indexOf(_normalizeStoreId(s._id)) > -1
      }));
    this.setData({ formExtraStoreOptions: options });
  },

  onToggleExtraStore(e) {
    const { id } = e.currentTarget.dataset;
    const checked = e.detail.value;
    const normalizedId = _normalizeStoreId(id);
    const storeId = _normalizeStoreId(this.data.form.store_id);
    if (normalizedId === storeId) {
      wx.showToast({ title: '该门店已为主门店', icon: 'none' });
      return;
    }
    const extraStoreIds = (this.data.form.extra_store_ids || []).slice();
    const idx = extraStoreIds.indexOf(normalizedId);
    if (checked && idx === -1) {
      extraStoreIds.push(normalizedId);
    } else if (!checked && idx > -1) {
      extraStoreIds.splice(idx, 1);
    }
    this.setData({ 'form.extra_store_ids': extraStoreIds });
    // 同步更新开关选项的 checked 状态
    this._buildFormExtraStoreOptions();
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
      if (form.member_identity === 'new') {
        // 新会员：校验时长
        if (!form.duration_value || Number(form.duration_value) <= 0) {
          const tip = form.package_type === 'count_card' ? '请输入服务有效期' : '请输入有效时长';
          wx.showToast({ title: tip, icon: 'none' });
          return;
        }
      } else {
        // 老会员：校验起止日期
        if (!form.start_date || !form.end_date) {
          wx.showToast({ title: '请选择有效期', icon: 'none' });
          return;
        }
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
      member_identity: form.member_identity,
      remark: form.remark || ''
    };

    if (form.package_type) {
      const packageData = {
        package_type: form.package_type,
        extra_store_ids: form.extra_store_ids || []
      };
      if (form.member_identity === 'new') {
        // 新会员：传时长，后端激活时计算起止日期
        packageData.duration_value = Number(form.duration_value);
        packageData.duration_unit = form.duration_unit;
      } else {
        // 老会员：传起止日期
        packageData.start_date = form.start_date;
        packageData.end_date = form.end_date;
      }
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
      } else {
        await request({ url: '/pre-members', method: 'POST', data: payload });
      }
      wx.hideLoading();
      wx.showToast({ title: editingId ? '更新成功' : '创建成功', icon: 'success' });
      this.setData({ showFormModal: false, editingId: '' });
      this.loadList();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
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

  // ========== 批量管理 ==========

  // 进入批量管理模式
  onEnterBatchMode() {
    this.setData({ batchMode: true, selectedIds: [], allSelected: false });
  },

  // 退出批量管理模式
  onExitBatchMode() {
    this.setData({ batchMode: false, selectedIds: [], allSelected: false });
  },

  // 切换某条记录的选中状态
  onToggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const selectedIds = this.data.selectedIds.slice();
    const idx = selectedIds.indexOf(id);
    if (idx > -1) {
      selectedIds.splice(idx, 1);
    } else {
      selectedIds.push(id);
    }
    this.setData({ selectedIds });
    this._updateListSelectedState(selectedIds);
    this._updateAllSelectedFlag(selectedIds);
  },

  // 卡片点击统一入口：批量模式下切换选中，非批量模式不做任何事（交由内部按钮各自处理）
  onCardTap(e) {
    if (!this.data.batchMode) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // 仅 pending_claim 可选；其他状态点击时提示
    const item = this.data.list.find(it => it._id === id);
    if (!item || item.member_status !== 'pending_claim') {
      wx.showToast({ title: '仅待认领记录可删除', icon: 'none' });
      return;
    }
    this.onToggleSelect(e);
  },

  // 全选/取消全选（仅对当前列表中可删除的 pending_claim 记录生效）
  onToggleSelectAll() {
    const { list, allSelected } = this.data;
    const deletableIds = list
      .filter(item => item.member_status === 'pending_claim')
      .map(item => item._id);
    let newSelected;
    if (allSelected) {
      // 取消全选：从已选中移除当前列表的所有可删除项
      const set = new Set(this.data.selectedIds);
      deletableIds.forEach(id => set.delete(id));
      newSelected = Array.from(set);
      this.setData({ selectedIds: newSelected, allSelected: false });
    } else {
      // 全选：合并当前列表的可删除项
      const set = new Set(this.data.selectedIds);
      deletableIds.forEach(id => set.add(id));
      newSelected = Array.from(set);
      this.setData({ selectedIds: newSelected, allSelected: true });
    }
    this._updateListSelectedState(newSelected);
  },

  // 批量删除
  onBatchDelete() {
    const { selectedIds } = this.data;
    if (!selectedIds || selectedIds.length === 0) {
      wx.showToast({ title: '请至少选择一条记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认批量删除',
      content: `将删除选中的 ${selectedIds.length} 条预建档记录，删除后不可恢复，确定继续？`,
      confirmColor: '#D4786E',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...', mask: true });
        try {
          const result = await request({
            url: '/pre-members/batch-delete',
            method: 'POST',
            data: { ids: selectedIds }
          });
          wx.hideLoading();
          const data = result.data || {};
          const deleted = data.deleted || 0;
          const failedCount = data.failed ? data.failed.length : 0;
          if (failedCount > 0) {
            wx.showToast({ title: `成功${deleted}条，${failedCount}条不可删除`, icon: 'none' });
          } else {
            wx.showToast({ title: `删除${deleted}条成功`, icon: 'success' });
          }
          // 退出批量模式并刷新列表
          this.setData({ batchMode: false, selectedIds: [], allSelected: false });
          this.loadList();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '批量删除失败', icon: 'none' });
        }
      }
    });
  },

  // 列表刷新后同步批量管理状态：清理已不存在的选中项 + 更新全选标记 + 重算 _selected
  _syncBatchState() {
    if (!this.data.batchMode) return;
    const { list, selectedIds } = this.data;
    const currentIds = new Set(list.map(item => item._id));
    // 过滤掉不在当前列表中的选中项（如已被删除或被筛选条件排除）
    const filtered = selectedIds.filter(id => currentIds.has(id));
    if (filtered.length !== selectedIds.length) {
      this.setData({ selectedIds: filtered });
    }
    this._updateListSelectedState(filtered);
    this._updateAllSelectedFlag(filtered);
  },

  // 根据 selectedIds 更新 list 中每条记录的 _selected 字段（供 WXML 直接判断，避免在模板中用 indexOf）
  _updateListSelectedState(selectedIds) {
    const selectedSet = new Set(selectedIds || this.data.selectedIds);
    const updates = {};
    this.data.list.forEach((item, index) => {
      const newSelected = selectedSet.has(item._id);
      if (item._selected !== newSelected) {
        updates[`list[${index}]._selected`] = newSelected;
      }
    });
    if (Object.keys(updates).length > 0) {
      this.setData(updates);
    }
  },

  // 根据 selectedIds 和当前列表计算全选标记
  _updateAllSelectedFlag(selectedIds) {
    const { list } = this.data;
    const deletableIds = list
      .filter(item => item.member_status === 'pending_claim')
      .map(item => item._id);
    if (deletableIds.length === 0) {
      this.setData({ allSelected: false });
      return;
    }
    const selectedSet = new Set(selectedIds);
    const allIn = deletableIds.every(id => selectedSet.has(id));
    this.setData({ allSelected: allIn });
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
