const { request } = require('../../../utils/request');

Page({
  data: {
    logs: [],
    loading: true,
    page: 1,
    pageSize: 20,
    hasMore: true,
    // 模块选项（易懂的中文标签）
    moduleOptions: [
      { value: '', label: '全部模块' },
      { value: 'member', label: '会员管理' },
      { value: 'package', label: '套餐管理' },
      { value: 'booking', label: '预约管理' },
      { value: 'schedule', label: '排课管理' },
      { value: 'store', label: '门店管理' },
      { value: 'auth', label: '登录认证' },
      { value: 'system', label: '系统设置' }
    ],
    moduleIndex: 0,
    // 操作选项（易懂的中文标签）
    actionOptions: [
      { value: '', label: '全部操作' },
      { value: 'create', label: '新增' },
      { value: 'update', label: '修改' },
      { value: 'delete', label: '删除' },
      { value: 'login', label: '登录' },
      { value: 'logout', label: '登出' },
      { value: 'approve', label: '审核通过' },
      { value: 'reject', label: '审核拒绝' }
    ],
    actionIndex: 0,
    filters: {
      module: '',
      action: '',
      startDate: '',
      endDate: ''
    }
  },
  
  onLoad() {
    this.loadLogs();
  },
  
  onReachBottom() {
    if (this.data.hasMore) {
      this.setData({ page: this.data.page + 1 });
      this.loadLogs(true);
    }
  },
  
  // 模块选择变化
  onModuleChange(e) {
    const index = e.detail.value;
    const value = this.data.moduleOptions[index].value;
    this.setData({
      moduleIndex: index,
      'filters.module': value,
      page: 1
    });
    this.loadLogs();
  },
  
  // 操作选择变化
  onActionChange(e) {
    const index = e.detail.value;
    const value = this.data.actionOptions[index].value;
    this.setData({
      actionIndex: index,
      'filters.action': value,
      page: 1
    });
    this.loadLogs();
  },
  
  loadLogs(append = false) {
    this.setData({ loading: true });
    const params = {
      page: this.data.page,
      pageSize: this.data.pageSize,
      ...this.data.filters
    };
    
    request({
      url: '/logs',
      method: 'GET',
      data: params
    }).then(res => {
      const list = res.data && res.data.list ? res.data.list : [];
      const newLogs = append ? [...this.data.logs, ...list] : list;
      this.setData({
        logs: newLogs,
        hasMore: list.length >= this.data.pageSize,
        loading: false
      });
    }).catch(err => {
      this.setData({ loading: false });
    });
  },
  
  onRefresh() {
    this.setData({ page: 1, logs: [] });
    this.loadLogs();
  }
});
