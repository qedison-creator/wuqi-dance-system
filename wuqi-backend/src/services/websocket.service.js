/**
 * WebSocket 实时推送服务
 *
 * 功能：
 * - 维护全局内存连接池 Map<userId, Set<WebSocket>>，支持同账号多端在线
 * - 连接建立时校验 JWT token，无效身份直接拒绝连接
 * - 监听 close/error 事件，自动从连接池移除，避免内存泄漏
 * - 响应客户端心跳包，维持连接活性
 * - 封装统一广播方法，供排课等业务调用
 *
 * 依赖：ws 库（需 npm install ws）
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const crypto = require('crypto');

// 全局连接池：userId -> Set<WebSocket>
const connectionPool = new Map();

// 心跳超时时间（毫秒）：超过此时间未收到心跳则判定连接断开
const HEARTBEAT_TIMEOUT = 60000;

// 每个用户的最新状态版本号：userId -> number（单调递增）
const userVersionMap = new Map();

// 每个用户最近推送的事件ID集合：userId -> Set<event_id>（用于重连后去重）
const userEventIdsMap = new Map();
const MAX_EVENT_ID_CACHE = 50;

/**
 * 生成全局唯一事件ID
 */
function generateEventId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/**
 * 获取用户下一个版本号（单调递增）
 */
function nextVersion(userId) {
  const key = String(userId);
  const current = userVersionMap.get(key) || 0;
  const next = current + 1;
  userVersionMap.set(key, next);
  return next;
}

/**
 * 记录已推送的事件ID（用于重连后去重）
 */
function recordEventId(userId, eventId) {
  const key = String(userId);
  if (!userEventIdsMap.has(key)) {
    userEventIdsMap.set(key, new Set());
  }
  const set = userEventIdsMap.get(key);
  set.add(eventId);
  // 超过缓存上限时清空最早的（Set 保持插入顺序，直接清空重建）
  if (set.size > MAX_EVENT_ID_CACHE) {
    const arr = Array.from(set).slice(-Math.floor(MAX_EVENT_ID_CACHE / 2));
    set.clear();
    arr.forEach(id => set.add(id));
  }
}

/**
 * 初始化 WebSocket 服务，挂载到已有的 HTTP Server 上
 * @param {http.Server} server - HTTP 服务器实例（app.listen 返回值）
 */
function initWebSocketServer(server) {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // 从 URL query 中提取 token：/ws?token=xxx
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    let userId = null;

    // 校验 token 合法性
    if (!token) {
      ws.close(4001, '未提供认证令牌');
      return;
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      userId = String(decoded.id);  // 统一转为字符串，避免 ObjectId/字符串类型不匹配
      // 记录用户类型（admin / member），用于按身份定向广播
      ws._userType = decoded.user_type || (decoded.role ? 'admin' : 'member');
      ws._role = decoded.role || '';
    } catch (err) {
      ws.close(4003, '认证令牌无效或已过期');
      return;
    }

    // 注册连接到连接池（同账号多端在线用 Set 存储）
    if (!connectionPool.has(userId)) {
      connectionPool.set(userId, new Set());
    }
    connectionPool.get(userId).add(ws);

    // 在 ws 对象上标记 userId 和心跳时间，便于后续清理
    ws._userId = userId;
    ws._lastHeartbeat = Date.now();
    ws.isAlive = true;

    // 启动心跳超时检测定时器
    ws._heartbeatTimer = setInterval(() => {
      if (Date.now() - ws._lastHeartbeat > HEARTBEAT_TIMEOUT) {
        ws.terminate();
      }
    }, HEARTBEAT_TIMEOUT);

    // 监听客户端消息
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        // 处理心跳包
        if (data.type === 'ping') {
          ws._lastHeartbeat = Date.now();
          ws.isAlive = true;
          // 响应心跳
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
          return;
        }

        // 处理重连后状态同步请求
        if (data.type === 'sync') {
          const clientLastVersion = data.last_version || 0;
          const serverVersion = userVersionMap.get(userId) || 0;
          // 服务端版本号大于客户端版本号时，推送 sync_ack 让客户端主动拉取最新状态
          if (serverVersion > clientLastVersion) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'sync_ack',
                server_version: serverVersion,
                client_version: clientLastVersion,
                need_refresh: true,
                timestamp: Date.now()
              }));
            }
          } else {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'sync_ack',
                server_version: serverVersion,
                client_version: clientLastVersion,
                need_refresh: false,
                timestamp: Date.now()
              }));
            }
          }
          return;
        }
      } catch (e) {
        // 非 JSON 消息，忽略
      }
    });

    // 连接断开时清理
    ws.on('close', () => {
      removeConnection(ws);
    });

    ws.on('error', (err) => {
      console.error(`[WebSocket] 用户 ${userId} 连接错误:`, err.message);
      removeConnection(ws);
    });

    // 连接建立成功后发送欢迎消息
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'WebSocket 连接已建立',
        timestamp: Date.now()
      }));
    }
  });

  // 定期清理已断开但未触发 close 事件的僵尸连接
  const cleanupInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(cleanupInterval);
  });

  console.log('[WebSocket] 服务已启动，路径: /ws');
}

/**
 * 从连接池移除指定连接，清理定时器
 */
function removeConnection(ws) {
  if (ws._heartbeatTimer) {
    clearInterval(ws._heartbeatTimer);
    ws._heartbeatTimer = null;
  }

  const userId = ws._userId;
  if (userId && connectionPool.has(userId)) {
    const conns = connectionPool.get(userId);
    conns.delete(ws);
    if (conns.size === 0) {
      connectionPool.delete(userId);
    }
  }
}

/**
 * 获取当前在线连接总数
 */
function getOnlineCount() {
  let count = 0;
  for (const conns of connectionPool.values()) {
    count += conns.size;
  }
  return count;
}

/**
 * 广播课程更新事件给所有在线连接
 * 在管理端新增排课写入 MongoDB 成功后调用
 *
 * @param {Object} payload - 附加数据（如 storeId、scheduleId 等，可选）
 */
function broadcastCourseUpdate(payload = {}) {
  const message = JSON.stringify({
    event: 'course_update',
    updateTime: new Date().toISOString(),
    data: payload
  });

  let sentCount = 0;
  for (const conns of connectionPool.values()) {
    for (const ws of conns) {
      if (ws.readyState === 1) {
        ws.send(message);
        sentCount++;
      }
    }
  }
}

/**
 * 仅向管理端在线连接广播事件
 * 用于会员预约/取消等行为时通知管理端实时刷新
 *
 * @param {string} event - 事件类型，如 booking_create / booking_cancel
 * @param {Object} data - 推送数据
 */
function broadcastToAdmins(event, data = {}) {
  const message = JSON.stringify({
    event,
    updateTime: new Date().toISOString(),
    data
  });

  let sentCount = 0;
  for (const conns of connectionPool.values()) {
    for (const ws of conns) {
      if (ws._userType === 'admin' || ws._userType === 'staff') {
        if (ws.readyState === 1) {
          ws.send(message);
          sentCount++;
        }
      }
    }
  }
  return sentCount;
}

/**
 * 向指定用户推送消息（自动注入 version + event_id，保证幂等防乱序）
 * @param {string} userId - 用户ID
 * @param {string} event - 事件类型
 * @param {Object} data - 消息数据
 */
function sendToUser(userId, event, data = {}) {
  const key = String(userId);  // 统一转为字符串，确保与连接池 key 类型一致
  const conns = connectionPool.get(key);
  if (!conns || conns.size === 0) return false;

  // 自动注入版本号和事件ID
  const version = nextVersion(key);
  const event_id = generateEventId();
  recordEventId(key, event_id);

  const message = JSON.stringify({
    event,
    version,
    event_id,
    updateTime: new Date().toISOString(),
    data
  });

  let sent = false;
  for (const ws of conns) {
    if (ws.readyState === 1) {
      ws.send(message);
      sent = true;
    }
  }
  return sent;
}

/**
 * 获取用户当前最新版本号（用于重连后状态同步）
 */
function getUserVersion(userId) {
  return userVersionMap.get(String(userId)) || 0;
}

/**
 * 获取用户最近推送的事件ID列表（用于重连后去重）
 */
function getUserEventIds(userId) {
  return Array.from(userEventIdsMap.get(String(userId)) || []);
}

/**
 * 广播会员计数更新事件给所有管理端在线连接
 * 当待审核用户数、信息修改请求数、预建档会员数变化时调用
 *
 * @param {Object} counts - { pendingCount, infoChangeCount, pendingClaimCount }
 */
function broadcastMemberCountUpdate(counts = {}) {
  const message = JSON.stringify({
    event: 'member_count_update',
    updateTime: new Date().toISOString(),
    data: {
      pendingCount: counts.pendingCount ?? null,
      infoChangeCount: counts.infoChangeCount ?? null,
      pendingClaimCount: counts.pendingClaimCount ?? null
    }
  });

  let sentCount = 0;
  for (const conns of connectionPool.values()) {
    for (const ws of conns) {
      if ((ws._userType === 'admin' || ws._userType === 'staff') && ws.readyState === 1) {
        ws.send(message);
        sentCount++;
      }
    }
  }
  return sentCount;
}

module.exports = {
  initWebSocketServer,
  broadcastCourseUpdate,
  broadcastToAdmins,
  sendToUser,
  broadcastMemberCountUpdate,
  getOnlineCount,
  getUserVersion,
  getUserEventIds
};
