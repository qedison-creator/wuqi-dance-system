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
let reconnectCount = 0;
let heartbeatTimer = null;
let heartbeatTimeoutTimer = null;
let reconnectTimer = null;
let fallbackPollTimer = null;

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

  isConnecting = true;
  const url = getWsUrl();

  socketTask = wx.connectSocket({
    url,
    fail: (err) => {
      console.error('[WebSocket] 连接请求失败:', err);
      isConnecting = false;
      _handleDisconnect();
    }
  });

  // 连接打开
  socketTask.onOpen(() => {
    isConnecting = false;
    // 记录是否为重连（在重置 reconnectCount 之前判断）
    const isReconnect = reconnectCount > 0;
    isConnected = true;
    reconnectCount = 0;

    // 连接恢复后关闭降级轮询
    _stopFallbackPoll();

    _notifyStatus('connected');
    _startHeartbeat();

    // 重连后发送 sync 请求，同步断连期间缺失的状态
    // 服务端收到后会将 last_version 之后的状态重新推送（如有）
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
    try {
      const msg = JSON.parse(res.data);

      // 心跳响应
      if (msg.type === 'pong') {
        _clearHeartbeatTimeout();
        return;
      }

      // 连接确认
      if (msg.type === 'connected') return;

      // 重连后状态同步响应：服务端版本号更新时触发降级轮询拉取最新状态
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

  // 连接关闭
  socketTask.onClose(() => {
    _handleDisconnect();
  });

  // 连接错误：降级为 warn（已有自动重连+降级轮询机制，连接失败不影响功能）
  socketTask.onError((err) => {
    console.warn('[WebSocket] 连接错误（将自动降级为轮询）:', err && err.errMsg ? err.errMsg : err);
    _handleDisconnect();
  });
}

/**
 * 主动断开连接，清理所有定时器
 */
function disconnect() {
  _stopHeartbeat();
  _stopReconnect();
  _stopFallbackPoll();
  reconnectCount = 0;

  if (socketTask) {
    try {
      socketTask.close({ code: 1000, reason: '客户端主动关闭' });
    } catch (e) {}
    socketTask = null;
  }
  isConnected = false;
  isConnecting = false;
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
        _handleDisconnect();
      }
    });

    // 启动心跳超时检测
    heartbeatTimeoutTimer = setTimeout(() => {
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
 */
function _handleDisconnect() {
  _stopHeartbeat();
  isConnected = false;
  isConnecting = false;

  // 尝试重连
  if (reconnectCount < MAX_RECONNECT) {
    _reconnect();
  } else {
    // 超过最大重连次数，降级为轮询
    _startFallbackPoll();
  }
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
