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

// 全局连接池：userId -> Set<WebSocket>
const connectionPool = new Map();

// 心跳超时时间（毫秒）：超过此时间未收到心跳则判定连接断开
const HEARTBEAT_TIMEOUT = 60000;

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
      userId = decoded.id;
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
      // 仅推送给管理端连接（user_type 为 admin 或 super_admin/staff/store_manager 等角色）
      if (ws._userType === 'admin' && ws.readyState === 1) {
        ws.send(message);
        sentCount++;
      }
    }
  }
}

/**
 * 向指定用户推送消息
 * @param {string} userId - 用户ID
 * @param {string} event - 事件类型
 * @param {Object} data - 消息数据
 */
function sendToUser(userId, event, data = {}) {
  const conns = connectionPool.get(userId);
  if (!conns || conns.size === 0) return false;

  const message = JSON.stringify({
    event,
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

module.exports = {
  initWebSocketServer,
  broadcastCourseUpdate,
  broadcastToAdmins,
  sendToUser,
  getOnlineCount
};
