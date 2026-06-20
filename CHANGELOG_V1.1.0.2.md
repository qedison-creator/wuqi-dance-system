# V1.1.0.2 版本修改记录

发布日期：2026-06-21

## 一、后端服务（wuqi-backend）

### 1. WebSocket 实时推送服务（新增）
- **新增文件**：`src/services/websocket.service.js`
  - 基于 ws 库实现，挂载到 HTTP Server 的 `/ws` 路径
  - 全局连接池 `Map<userId, Set<WebSocket>>`，支持同账号多端在线
  - JWT token 校验（URL query 传递），无效身份拒绝连接
  - 心跳保活机制：客户端 ping / 服务端 pong，60 秒超时自动断开
  - 僵尸连接定期清理（30 秒扫描一次）
  - 提供三个广播方法：
    - `broadcastCourseUpdate(payload)` - 广播课程更新给所有连接
    - `broadcastToAdmins(event, data)` - 仅广播给管理端连接
    - `sendToUser(userId, event, data)` - 向指定用户推送

### 2. 排课路由（schedule.routes.js）
- 三个创建排课接口（单次创建、批量创建、复制创建）写入 MongoDB 成功后调用 `broadcastCourseUpdate`，触发会员端课程列表自动刷新

### 3. 预约服务（booking.service.js）
- `createBooking` 末尾调用 `broadcastToAdmins('booking_create', ...)`，通知管理端有新预约
- `cancelBooking` 末尾调用 `broadcastToAdmins('booking_cancel', ...)`，通知管理端有会员取消
- `adminCancelBooking` 末尾调用 `broadcastToAdmins('booking_cancel', ...)`，通知其他管理端连接刷新
- 修复 `getMyBookings` 的 `type=all` 查询：从 `['booked', 'cancelled']` 改为 `['booked', 'completed', 'cancelled']`，使会员端能看到已完成的预约记录

### 4. 排课服务（schedule.service.js）
- 修复 `getScheduleList` 兜底补偿逻辑：`checkAndCancelIfInsufficient` 触发条件增加 `currentBookings > 0` 判断，避免新建的空课程被误取消

### 5. 考勤服务（attendance.service.js）
- 修复第 230 行 `const sch` 重复声明导致的 SyntaxError（502 根因）

### 6. 服务器启动（server.js）
- 捕获 `app.listen` 返回的 server 实例，调用 `initWebSocketServer(server)` 启动 WebSocket 服务

## 二、会员端（wuqi-member）

### 1. WebSocket 客户端工具类（新增）
- **新增文件**：`utils/websocket-client.js`
  - 封装 `wx.connectSocket`，管理连接生命周期
  - 心跳保活：30 秒发送间隔，5 秒超时判定断开
  - 自动重连：2s/5s/10s 递增延迟，最多 5 次
  - 降级兜底：连续重连失败后降级为 60 秒低频轮询
  - 消息按 event 事件类型分发
  - WebSocket 地址推导：`https://api.yuekeme.cn/api/v1` → `wss://api.yuekeme.cn/ws`

### 2. 课程预约页面（pages/booking/booking.js）
- onShow 中调用 `_connectWebSocket()` 建立 WebSocket 连接
- onHide/onUnload 中调用 `wsClient.disconnect()` 断开连接
- 监听 `course_update` 事件，收到后自动刷新课程列表
- 修复未登录用户（游客）不启动自动轮询的问题：所有用户都启动 30 秒自动轮询

### 3. 我的记录页面（package-sub/pages/records/records.js）
- 修复分页 bug：`hasMore` 判断从 `>= 50` 改为 `>= 10`（与 pageSize 一致）
- 添加下拉刷新功能

### 4. 课程详情页（package-sub/utils/api.js）
- 修复 `require('../../../utils/request')` 路径错误，改为 `require('../../utils/request')`

### 5. 订阅设置页面（package-sub/pages/subscribe-settings/subscribe-settings.js）
- 修复订阅状态回退问题：`isSubscribed = wxStatus === 'accept' || (!!localAccepted[item.id] && wxStatus !== 'reject' && wxStatus !== 'ban')`

### 6. 下拉刷新统一
- 会员端 8 个页面统一使用原生下拉刷新 + `backgroundTextStyle: "dark"` + `.finally()` 回收
- 个人中心页面从 scroll-view 自定义刷新改为原生下拉刷新
- 去除会员端首页下拉刷新功能

### 7. 关于系统页面（package-sub/pages/about/about.js）
- 版本号更新为 `V1.1.0.2`

## 三、管理端（wuqi-admin）

### 1. WebSocket 客户端工具类（新增）
- **新增文件**：`utils/websocket-client.js`
  - 与会员端工具类结构一致，差异：
    - token 取自 `wx.getStorageSync('admin_token')`
    - WebSocket 地址推导：`https://admin-api.yuekeme.cn/api/v1` → `wss://admin-api.yuekeme.cn/ws`

### 2. 首页（pages/dashboard/dashboard.js）
- onShow 中调用 `_connectWebSocket()` 建立 WebSocket 连接
- onHide/onUnload 中调用 `_disconnectWebSocket()` 断开连接
- 监听 `booking_create`、`booking_cancel`、`course_update` 事件，自动刷新首页统计/待办

### 3. 预约名单页面（package-schedule/pages/bookings/bookings.js）
- 监听 `booking_create`、`booking_cancel` 事件，按 `schedule_id` 过滤，仅刷新当前课程的预约名单

### 4. 会员详情页（package-member/pages/members/member-detail）
- 添加下拉刷新功能

### 5. 下拉刷新统一
- 管理端 6 个页面统一使用原生下拉刷新

### 6. 关于系统页面（package-common/pages/about/about.js）
- 版本号更新为 `V1.1.0.2`

## 四、部署配置

### Nginx WebSocket 代理
- 会员端和管理端的 Nginx 配置文件均添加 WebSocket 代理配置：
  - `proxy_http_version 1.1`
  - `proxy_set_header Upgrade $http_upgrade`
  - `proxy_set_header Connection "upgrade"`
  - `proxy_read_timeout 86400`

### 微信小程序 socket 合法域名
- 会员端：`wss://api.yuekeme.cn`
- 管理端：`wss://admin-api.yuekeme.cn`

### PM2 进程管理
- 后端改为 fork 模式启动：`pm2 start server.js --name wuqi -x --max-memory-restart 1G`

## 五、本次修复的主要问题

| 问题 | 根因 | 修复方案 |
|---|---|---|
| 管理端/会员端全部 502 | `attendance.service.js` 第 230 行 `const sch` 重复声明导致 SyntaxError | 删除重复声明 |
| 会员端预约记录只有取消没有已完成 | 后端 `type=all` 只查 `['booked', 'cancelled']` | 改为 `['booked', 'completed', 'cancelled']` |
| 课程详情页报错 can not find module | `api.js` 的 require 路径多了一层 | 修正为 `../../utils/request` |
| 分页 bug | `hasMore` 判断用 `>= 50` 但 pageSize 是 10 | 改为 `>= 10` |
| 订阅状态回退 | 微信一次性订阅未勾"总是保持"时 `getSetting` 不记录 'accept' | 本地记录曾授权过的模板视为已订阅 |
| 新建空课程被误取消 | 兜底补偿逻辑对空课程也触发 `checkAndCancelIfInsufficient` | 增加 `currentBookings > 0` 判断 |
| 下拉刷新回弹慢 | 未统一配置 | 统一使用原生下拉刷新 + `.finally()` |

## 六、新增功能

### WebSocket 实时推送
- 管理端新增排课 → 会员端课程列表自动刷新
- 会员预约课程 → 管理端首页统计/待办自动刷新
- 会员/管理员取消预约 → 管理端首页和预约名单自动刷新
- 连接断开时自动重连，重连失败降级为 60 秒轮询
