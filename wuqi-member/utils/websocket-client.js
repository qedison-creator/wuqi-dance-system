/**
 * 微信小程序 WebSocket 工具类
 *
 * 功能：
 * - 封装 wx.connectSocket，管理连接生命周期
 * - 心跳保活：每 30 秒发送心跳包，超时 5 秒未响应判定断开
 * - 自动重连：断开后按 2s/5s/10s 递增延迟重试，最多 5 次
 * - 降级兜底：连续重连失败后降级为 60 秒低频轮询，连接恢复后自动关闭轮询
 * - 消息分发：按 event 事件类型分发，预留扩展能力
 *
 * 使用示例：
 *   const ws = require('../../utils/websocket-client');
 *   // 页面 onShow 时连接
 *   ws.connect({
 *     onMessage: { course_update: () => this.loadCourses() }
 *   });
 *   // 页面 onHide/onUnload 时断开
 *   ws.disconnect();
 */
const config = require('../config/index.js');

// ========== 可配置项 ==========
const HEARTBEAT_INTERVAL = 30000;  // 心跳发送间隔（毫秒）
const HEARTBEAT_TIMEOUT = 5000;    // 心跳响应超时（毫秒）
const RECONNECT_DELAYS = [2000, 5000, 10000]; // 重连递增延迟
const MAX_RECONNECT = 5;           // 最大重连次数
const FALLBACK_POLL_INTERVAL = 60000; // 降级轮询间隔（毫秒）
const CONNECT_TIMEOUT = 10000;     // 连接建立超时（毫秒）

// 根据 HTTP baseUrl 推导 WebSocket 地址
function getWsUrl() {
  const baseUrl = config.baseUrl || '';
  // https -> wss, http -> ws
  const wsUrl = baseUrl.replace(/^http/, 'ws').replace('/api/v1', '/ws');
  const token = wx.getStorageSync('token');
  return `${wsUrl}?token=${encodeURIComponent(token)}`;
}

// 单例状态
let socketTask = null;
let isConnected = false;
let isConnecting = false;
let isDisconnecting = false;       // 是否正在主动断开（防止 onClose 误触重连）
let isHandlingDisconnect = false;   // 防重入标志：onError/onClose 可能同时触发
let reconnectCount = 0;
let connectionId = 0;              // 连接代次：每次新建连接递增，用于忽略旧连接的回调
let heartbeatTimer = null;
let heartbeatTimeoutTimer = null;
let reconnectTimer = null;
let fallbackPollTimer = null;
let connectTimeoutTimer = null;     // 连接建立超时定时器

// 事件处理器映射：{ event: handler }
let messageHandlers = {};
// 降级轮询回调
let fallbackPollCallback = null;
// 连接状态变化回调
let onStatusChange = null;

/**
 * 建立 WebSocket 连接
 * @param {Object} options
 * @param {Object} options.onMessage - 事件处理器映射，如 { course_update: fn, booking_update: fn }
 * @param {Function} options.onFallback - 降级轮询回调（降级时被调用，用于拉取数据）
 * @param {Function} options.onStatusChange - 连接状态变化回调 (status: 'connected'|'disconnected'|'reconnecting'|'fallback')
 */
function connect(options = {}) {
  messageHandlers = options.onMessage || {};
  fallbackPollCallback = options.onFallback || null;
  onStatusChange = options.onStatusChange || null;

  // 已连接或正在连接中，不重复建立
  if (isConnected || isConnecting) return;

  // 无 token 不连接
  const token = wx.getStorageSync('token');
  if (!token) return;

  // 先清理旧连接：关闭旧 socketTask 并置空，避免"未完成的操作"
  _closeSocketTask();

  isConnecting = true;
  isDisconnecting = false;
  isHandlingDisconnect = false;
  const myId = ++connectionId;  // 本次连接的唯一标识
  const url = getWsUrl();

  socketTask = wx.connectSocket({
    url,
    fail: (err) => {
      if (myId !== connectionId) return;  // 旧连接的回调，忽略
      console.error('[WebSocket] 连接请求失败:', err);
      isConnecting = false;
      _clearConnectTimeout();
      _handleDisconnect();
    }
  });

  // 连接建立超时保护：超时未 onOpen 则主动关闭重连
  _startConnectTimeout();

  // 连接打开
  socketTask.onOpen(() => {
    if (myId !== connectionId) return;  // 旧连接的回调，忽略
    isConnecting = false;
    _clearConnectTimeout();
    // 记录是否为重连（在重置 reconnectCount 之前判断）
    const isReconnect = reconnectCount > 0;
    isConnected = true;
    reconnectCount = 0;

    // 连接恢复后关闭降级轮询
    _stopFallbackPoll();

    _notifyStatus('connected');
    _startHeartbeat();

    // 重连后发送 sync 请求，同步断连期间缺失的状态
    if (isReconnect) {
      try {
        const lastVersion = wx.getStorageSync('ws_last_version') || 0;
        if (socketTask) {
          socketTask.send({
            data: JSON.stringify({
              type: 'sync',
              last_version: lastVersion,
              timestamp: Date.now()
            })
          });
        }
      } catch (e) {}
    }
  });

  // 接收消息
  socketTask.onMessage((res) => {
    if (myId !== connectionId) return;  // 旧连接的回调，忽略
    try {
      const msg = JSON.parse(res.data);

      // 心跳响应
      if (msg.type === 'pong') {
        _clearHeartbeatTimeout();
        return;
      }

      // 连接确认
      if (msg.type === 'connected') return;

      // 重连后状态同步响应
      if (msg.type === 'sync_ack') {
        if (msg.need_refresh && fallbackPollCallback) {
          try {
            fallbackPollCallback();
          } catch (e) {}
        }
        return;
      }

      // 按事件类型分发
      if (msg.event && messageHandlers[msg.event]) {
        messageHandlers[msg.event](msg.data || {}, msg);
      }
    } catch (e) {
      console.error('[WebSocket] 消息解析失败:', e);
    }
  });

  // 连接关闭：统一在此处理断连逻辑
  socketTask.onClose(() => {
    if (myId !== connectionId) return;  // 旧连接的回调，忽略
    // 主动断开时不触发重连
    if (isDisconnecting) {
      isConnecting = false;
      _clearConnectTimeout();
      return;
    }
    _handleDisconnect();
  });

  // 连接错误：仅记录日志，断连处理交给 onClose 统一处理
  socketTask.onError((err) => {
    if (myId !== connectionId) return;  // 旧连接的回调，忽略
    console.warn('[WebSocket] 连接错误（将自动降级为轮询）:', err && err.errMsg ? err.errMsg : err);
  });
}

/**
 * 主动断开连接，清理所有定时器
 */
function disconnect() {
  isDisconnecting = true;
  connectionId++;  // 使所有旧连接的回调失效
  _stopHeartbeat();
  _stopReconnect();
  _stopFallbackPoll();
  _clearConnectTimeout();
  reconnectCount = 0;

  _closeSocketTask();

  isConnected = false;
  isConnecting = false;
  isHandlingDisconnect = false;
}

/**
 * 获取当前连接状态
 */
function getConnectionStatus() {
  if (isConnected) return 'connected';
  if (isConnecting) return 'connecting';
  if (fallbackPollTimer) return 'fallback';
  return 'disconnected';
}

// ========== 内部方法 ==========

/**
 * 关闭旧 socketTask 并置空引用
 */
function _closeSocketTask() {
  if (socketTask) {
    try {
      socketTask.close({ code: 1000, reason: '清理旧连接' });
    } catch (e) {}
    socketTask = null;
  }
}

/**
 * 连接建立超时保护
 */
function _startConnectTimeout() {
  _clearConnectTimeout();
  connectTimeoutTimer = setTimeout(() => {
    if (isConnecting && !isConnected) {
      console.warn('[WebSocket] 连接建立超时，主动关闭重连');
      _closeSocketTask();
      isConnecting = false;
      _handleDisconnect();
    }
  }, CONNECT_TIMEOUT);
}

function _clearConnectTimeout() {
  if (connectTimeoutTimer) {
    clearTimeout(connectTimeoutTimer);
    connectTimeoutTimer = null;
  }
}

/**
 * 启动心跳保活
 */
function _startHeartbeat() {
  _stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!isConnected || !socketTask) return;

    // 发送心跳包
    socketTask.send({
      data: JSON.stringify({ type: 'ping', timestamp: Date.now() }),
      fail: () => {
        // 发送失败：socket 可能已断开，先关闭再处理断连
        _closeSocketTask();
        _handleDisconnect();
      }
    });

    // 启动心跳超时检测
    heartbeatTimeoutTimer = setTimeout(() => {
      // 心跳超时：socket 无响应，先关闭再处理断连
      _closeSocketTask();
      _handleDisconnect();
    }, HEARTBEAT_TIMEOUT);
  }, HEARTBEAT_INTERVAL);
}

function _stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  _clearHeartbeatTimeout();
}

function _clearHeartbeatTimeout() {
  if (heartbeatTimeoutTimer) {
    clearTimeout(heartbeatTimeoutTimer);
    heartbeatTimeoutTimer = null;
  }
}

/**
 * 处理连接断开：停止心跳、尝试重连或降级轮询
 * 注意：本函数不关闭 socketTask（onClose 触发时 socket 已关闭，再调 close() 会报错）
 * 需要主动关闭 socket 的场景（心跳超时、连接超时）请在调用本函数前执行 _closeSocketTask()
 */
function _handleDisconnect() {
  // 防重入：避免 onClose/心跳超时/发送失败 重复触发
  if (isHandlingDisconnect) return;
  isHandlingDisconnect = true;

  _stopHeartbeat();
  _clearConnectTimeout();
  // 不调 _closeSocketTask()：onClose 触发时 socket 已关闭，再调 close() 会报 "closed before established"
  socketTask = null;
  connectionId++;  // 使旧连接的后续回调（onError/onClose）全部失效
  isConnected = false;
  isConnecting = false;

  // 主动断开时不触发重连
  if (isDisconnecting) {
    isHandlingDisconnect = false;
    return;
  }

  // 尝试重连
  if (reconnectCount < MAX_RECONNECT) {
    _reconnect();
  } else {
    // 超过最大重连次数，降级为轮询
    _startFallbackPoll();
  }

  // 重置防重入标志（延迟，确保本轮事件处理完毕）
  setTimeout(() => {
    isHandlingDisconnect = false;
  }, 500);
}

/**
 * 自动重连：按递增延迟重试
 */
function _reconnect() {
  if (reconnectTimer) return;

  const delay = RECONNECT_DELAYS[Math.min(reconnectCount, RECONNECT_DELAYS.length - 1)];
  reconnectCount++;
  _notifyStatus('reconnecting');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // 递归调用 connect，复用已注册的 handlers
    connect({
      onMessage: messageHandlers,
      onFallback: fallbackPollCallback,
      onStatusChange: onStatusChange
    });
  }, delay);
}

function _stopReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * 降级轮询：低频调用 fallbackPollCallback 拉取数据
 */
function _startFallbackPoll() {
  _stopFallbackPoll();
  if (!fallbackPollCallback) return;

  _notifyStatus('fallback');
  // 立即执行一次
  fallbackPollCallback();
  fallbackPollTimer = setInterval(() => {
    fallbackPollCallback();
  }, FALLBACK_POLL_INTERVAL);
}

function _stopFallbackPoll() {
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
}

/**
 * 通知连接状态变化
 */
function _notifyStatus(status) {
  if (onStatusChange) {
    onStatusChange(status);
  }
}

module.exports = {
  connect,
  disconnect,
  getConnectionStatus
};
