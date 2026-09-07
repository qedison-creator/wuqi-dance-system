const app = getApp();
const { request } = require('../../../utils/request');
const config = require('../../../config/index.js');
const SERVER_BASE = config.serverBase;
const { normalizeImageUrl } = require('../../../utils/util');

// 画廊页请求上限（拉全部图片）
const GALLERY_LIMIT = 200;

/**
 * 格式化图片记录：补全 URL、计算宽高比与方向
 */
function formatImage(img) {
  const width = Number(img.width) || 0;
  const height = Number(img.height) || 0;
  let orientation = 'square';
  let ratio = 1;
  if (width > 0 && height > 0) {
    ratio = width / height;
    if (ratio > 1.1) orientation = 'landscape';
    else if (ratio < 0.9) orientation = 'portrait';
    else orientation = 'square';
  }
  return {
    ...img,
    image_url: normalizeImageUrl(img.image_url, SERVER_BASE),
    thumbnail_url: normalizeImageUrl(img.thumbnail_url, SERVER_BASE) || normalizeImageUrl(img.image_url, SERVER_BASE),
    orientation,
    ratio
  };
}

/**
 * 将图片列表按瀑布流分配到两列（每次放入当前较矮的一列）
 */
function buildColumns(list) {
  const colA = [];
  const colB = [];
  let heightA = 0;
  let heightB = 0;
  list.forEach(img => {
    // 相框固定内容高度按宽高比折算（内容区宽度按 1 计），取倒数代表"视觉高度"
    const visualH = 1 / (img.ratio || 1);
    if (heightA <= heightB) {
      colA.push(img);
      heightA += visualH;
    } else {
      colB.push(img);
      heightB += visualH;
    }
  });
  return { colA, colB };
}

Page({
  data: {
    loading: true,
    loadError: false,
    colA: [],
    colB: [],
    imageUrls: [],   // 全屏预览用（按展示顺序）
    imageErrors: {},  // 加载失败的图片 _id -> true
    fromCache: false  // 当前渲染是否来自本地缓存（增量同步中）
  },

  onLoad() {
    this._syncing = false;
    this.loadGallery(true);
  },

  onShow() {
    // 门店可能在外部（首页）被切换：重新按当前门店加载
    const storeId = this._currentStoreKey();
    if (this._loadedStoreId && this._loadedStoreId !== storeId) {
      this.loadGallery(true);
    }
  },

  onPullDownRefresh() {
    // 下拉刷新：强制全量拉取
    this.loadGallery(false, () => wx.stopPullDownRefresh());
  },

  // 缓存 key：按门店维度区分（公共+门店画册组合因门店而异）
  _cacheKey() {
    const storeId = this._currentStoreKey();
    return 'gallery_cache_' + (storeId || 'public');
  },

  _currentStoreKey() {
    const store = app.globalData.currentStore;
    return store && store._id ? String(store._id) : '';
  },

  /**
   * 加载画廊数据
   * @param {boolean} useCache - 优先使用本地缓存（秒开 + 静默增量同步）
   * @param {Function} done - 完成回调（下拉刷新停止用）
   */
  async loadGallery(useCache, done) {
    const storeId = this._currentStoreKey();
    this._loadedStoreId = storeId;
    const cacheKey = this._cacheKey();

    // 1. 缓存优先：立即渲染本地数据，再后台增量同步
    if (useCache) {
      const cached = wx.getStorageSync(cacheKey);
      if (cached && Array.isArray(cached.list) && cached.list.length > 0 && cached.synced_at) {
        this._renderList(cached.list, true);
        this._silentSync(cacheKey, cached.synced_at, cached.list);
        if (done) done();
        return;
      }
    }

    // 2. 全量加载
    this.setData({ loading: true, loadError: false, fromCache: false });
    try {
      const res = await request({
        url: '/home/images',
        data: { limit: GALLERY_LIMIT, store_id: storeId },
        silent: true
      });
      const raw = res.data || [];
      const list = (Array.isArray(raw) ? raw : (raw.list || [])).map(formatImage);
      this._renderList(list, false);
      wx.setStorageSync(cacheKey, { list, synced_at: new Date().toISOString() });
      this.setData({ loading: false });
    } catch (err) {
      console.error('加载画廊失败:', err);
      this.setData({ loading: false, loadError: true });
    } finally {
      if (done) done();
    }
  },

  /**
   * 静默增量同步：仅拉取 updated_at > synced_at 的变化记录
   * 无变化时零流量（图片文件由微信按 URL 缓存，列表无变化即不产生图片请求）
   */
  async _silentSync(cacheKey, syncedAt, cachedList) {
    if (this._syncing) return;
    this._syncing = true;
    try {
      const storeId = this._currentStoreKey();
      const res = await request({
        url: '/home/images',
        data: { limit: GALLERY_LIMIT, store_id: storeId, after: syncedAt },
        silent: true
      });
      const raw = res.data || {};
      if (raw.incremental !== true) return;

      const changed = (raw.changed || []).map(formatImage);
      // 本地条数与服务端 total 不一致（有删除）→ 全量重建
      if (cachedList.length !== raw.total || cachedList.length + changed.length !== raw.total) {
        // 全量拉取最新列表
        const full = await request({
          url: '/home/images',
          data: { limit: GALLERY_LIMIT, store_id: storeId },
          silent: true
        });
        const fullRaw = full.data || [];
        const list = (Array.isArray(fullRaw) ? fullRaw : (fullRaw.list || [])).map(formatImage);
        this._renderList(list, false);
        wx.setStorageSync(cacheKey, { list, synced_at: new Date().toISOString() });
        return;
      }

      if (changed.length === 0) {
        // 无变化：仅刷新同步时间戳，避免下次重复拉同一批
        wx.setStorageSync(cacheKey, { list: cachedList, synced_at: raw.server_time });
        return;
      }

      // 合并变化记录（新增/修改按 _id 覆盖），按原排序规则重排
      const map = {};
      cachedList.forEach(img => { map[img._id] = img; });
      changed.forEach(img => { map[img._id] = img; });
      const merged = Object.values(map).sort((a, b) => {
        const so = (b.sort_order || 0) - (a.sort_order || 0);
        if (so !== 0) return so;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
      this._renderList(merged, false);
      wx.setStorageSync(cacheKey, { list: merged, synced_at: raw.server_time });
    } catch (err) {
      // 增量失败静默降级：继续展示缓存，下次再同步
      console.error('画廊增量同步失败:', err);
    } finally {
      this._syncing = false;
    }
  },

  /**
   * 渲染列表：分配瀑布流两列
   */
  _renderList(list, fromCache) {
    const { colA, colB } = buildColumns(list);
    this.setData({
      colA,
      colB,
      imageUrls: list.map(img => img.image_url),
      fromCache: !!fromCache,
      loadError: false
    });
  },

  // 点击图片：全屏预览（左右滑动、双指缩放）
  onImageTap(e) {
    const { url } = e.currentTarget.dataset;
    if (!url || this.data.imageErrors['g_' + e.currentTarget.dataset.id]) return;
    wx.previewImage({
      current: url,
      urls: this.data.imageUrls
    });
  },

  onImgError(e) {
    const id = e.currentTarget.dataset.id;
    if (id) this.setData({ ['imageErrors.g_' + id]: true });
  },

  onRetry() {
    this.loadGallery(false);
  }
});
