# 舞栖DANCE 舞蹈社预约管理系统 — Code Wiki

> **版本**: v1.1.0.6  
> **文档生成日期**: 2026-07-11  
> **仓库地址**: [github.com/qedison-creator/wuqi-dance-system](https://github.com/qedison-creator/wuqi-dance-system)

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [后端服务 (wuqi-backend)](#3-后端服务-wuqi-backend)
   - [3.1 目录结构](#31-目录结构)
   - [3.2 入口与启动流程](#32-入口与启动流程)
   - [3.3 中间件层](#33-中间件层)
   - [3.4 路由层](#34-路由层)
   - [3.5 业务逻辑层 (Services)](#35-业务逻辑层-services)
   - [3.6 数据模型层 (Models)](#36-数据模型层-models)
   - [3.7 工具函数 (Utils)](#37-工具函数-utils)
   - [3.8 种子数据 (Seed)](#38-种子数据-seed)
   - [3.9 定时任务 (Scheduler)](#39-定时任务-scheduler)
4. [会员端小程序 (wuqi-member)](#4-会员端小程序-wuqi-member)
   - [4.1 目录结构](#41-目录结构)
   - [4.2 全局应用入口](#42-全局应用入口)
   - [4.3 页面结构](#43-页面结构)
   - [4.4 组件](#44-组件)
   - [4.5 工具函数](#45-工具函数)
5. [管理端小程序 (wuqi-admin)](#5-管理端小程序-wuqi-admin)
   - [5.1 目录结构](#51-目录结构)
   - [5.2 全局应用入口](#52-全局应用入口)
   - [5.3 页面与分包结构](#53-页面与分包结构)
   - [5.4 组件](#54-组件)
   - [5.5 工具函数](#55-工具函数)
6. [数据库模型](#6-数据库模型)
7. [API 接口索引](#7-api-接口索引)
8. [核心业务流程](#8-核心业务流程)
9. [依赖关系](#9-依赖关系)
10. [项目运行方式](#10-项目运行方式)

---

## 1. 项目概述

**舞栖DANCE** 是一个舞蹈培训机构预约管理系统，由三个子项目组成：

| 项目 | 目录名 | 技术栈 | 微信 AppID | 说明 |
|------|--------|--------|------------|------|
| 后端服务 | `wuqi-backend/` | Node.js + Express 5 + MongoDB (Mongoose 9) | - | REST API 服务，端口 3000 |
| 会员端小程序 | `wuqi-member/` | 微信原生小程序 | `wxeb3b664ce36208ba` | 会员浏览课程、预约、签到 |
| 管理端小程序 | `wuqi-admin/` | 微信原生小程序 | `wx3f52761ae85bd5e7` | 后台管理（排课、会员、教练、薪酬等） |

**服务器信息**:
- 腾讯云轻量应用服务器 (Ubuntu 24.04)
- 公网 IP: `101.33.203.22`
- 两个 API 域名通过 Nginx 反向代理到同一个后端端口 3000:
  - 会员端: `https://api.yuekeme.cn`
  - 管理端: `https://admin-api.yuekeme.cn`

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       微信小程序平台                              │
│  ┌──────────────────────────┐  ┌──────────────────────────┐     │
│  │     会员端 (Member)       │  │     管理端 (Admin)        │     │
│  │  api.yuekeme.cn           │  │  admin-api.yuekeme.cn    │     │
│  └──────────┬───────────────┘  └──────────┬───────────────┘     │
└─────────────┼─────────────────────────────┼────────────────────┘
              │         HTTPS API            │
              │   Nginx 反向代理 → :3000      │
              ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   腾讯云轻量应用服务器 (Ubuntu)                     │
│                   后端进程: PM2 (wuqi)                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Express 5 应用 (src/app.js)                              │   │
│  │  ├─ CORS / JSON / morgan / 日志 / 速率限制                │   │
│  │  ├─ /uploads/ 静态文件 + 路径遍历防护 + 缓存              │   │
│  │  ├─ /api/v1 路由聚合                                     │   │
│  │  └─ /health 健康检查                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│     ┌──────────────────────┼──────────────────────┐             │
│     ▼                      ▼                      ▼             │
│  ┌──────────┐       ┌──────────┐          ┌──────────┐         │
│  │ 路由层    │  →   │ 业务逻辑层 │    →    │ 数据模型层 │         │
│  │ routes/  │       │ services/ │          │ models/  │         │
│  │ (26个)   │       │ (20个)    │          │ (24个)   │         │
│  └──────────┘       └──────────┘          └────┬─────┘         │
│                                                │                │
│  ┌──────────────────────────────────────────────┼──────────┐    │
│  │ 定时任务(node-cron) │ 微信API │ WebSocket │ 文件上传    │    │
│  │ 图片压缩(sharp)     │ 视频压缩(FFmpeg) │ 种子数据  │    │
│  └──────────────────────────────────────────────┴──────────┘    │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MongoDB 数据库 (wuqi_dance)                   │
│  集合: users, coaches, bookings, schedules, packages,            │
│        stores, videos, banners, holidays, danceStyles,           │
│        announcements, waitlists, attendances, weekTemplates...   │
└─────────────────────────────────────────────────────────────────┘
```

### 架构分层说明

| 层 | 目录 | 职责 |
|----|------|------|
| 入口层 | `server.js` | 环境变量加载、DB连接、定时任务启动、HTTP服务监听 |
| 应用配置层 | `src/app.js` | Express 中间件装配、静态文件、路由挂载 |
| 中间件层 | `src/middleware/` | 认证、鉴权、日志、错误处理、数据脱敏、门店隔离、参数校验 |
| 路由层 | `src/routes/` | HTTP 请求路由分发，参数提取，调用 Service |
| 业务逻辑层 | `src/services/` | 核心业务逻辑，跨模型操作，事务处理 |
| 数据模型层 | `src/models/` | Mongoose Schema 定义，索引，钩子 |
| 工具层 | `src/utils/` | 加密、响应格式化、定时任务调度、时间处理、微信API |
| 种子数据层 | `src/seed/` | 数据库初始化数据 |

---

## 3. 后端服务 (wuqi-backend)

### 3.1 目录结构

```
wuqi-backend/
├── server.js                     # 入口文件
├── package.json                  # 依赖与脚本
├── ecosystem.config.js           # PM2 配置
├── .env / .env.example           # 环境变量
├── src/
│   ├── app.js                    # Express 应用配置
│   ├── config/
│   │   ├── index.js              # 全局配置（环境变量读取）
│   │   ├── database.js           # MongoDB 连接 + 权限迁移
│   │   └── messageConfig.js      # 消息模板配置
│   ├── constants/
│   │   └── scheduleStatus.constants.js  # 排课状态常量
│   ├── middleware/
│   │   ├── auth.js               # JWT 认证（auth / optionalAuth）
│   │   ├── permission.js         # 角色权限 + 模块权限控制
│   │   ├── storeFilter.js        # 门店数据隔离
│   │   ├── dataMasking.js        # 审核员数据脱敏
│   │   ├── errorHandler.js       # 全局错误处理 + BusinessError
│   │   ├── logger.js             # 请求响应日志
│   │   └── validate.js           # 参数校验（objectId / required）
│   ├── models/                   # 24个 Mongoose 模型
│   ├── routes/                   # 26个路由模块
│   ├── services/                 # 20个业务逻辑模块
│   ├── utils/                    # 工具函数
│   ├── seed/                     # 种子数据脚本
│   └── scripts/                  # 数据库迁移脚本
├── db-backup/                    # 数据库备份文件
├── scripts/                      # 运维脚本（迁移、修复、清理）
└── uploads/                      # 上传文件存储目录
```

### 3.2 入口与启动流程

**`server.js`** — 启动顺序：

```
1. dotenv 加载 .env 环境变量
2. 生产环境安全校验（JWT_SECRET、WX_APPID 必填）
3. connectDB() → MongoDB 连接 + 权限配置迁移
4. ensureTemplateMappings() → 初始化订阅消息模板映射
5. startScheduler() → 启动所有定时任务
6. syncServerTime() → 同步服务器时间
7. app.listen(3000) → 启动 HTTP 服务
8. initWebSocketServer(server) → 复用 HTTP 端口初始化 WebSocket
```

**`src/app.js`** — Express 中间件栈（按顺序）：

| 序号 | 中间件 | 说明 |
|------|--------|------|
| 1 | CORS | 生产环境限制 origin 为微信小程序域名 |
| 2 | express.json | 请求体解析，限制 10MB |
| 3 | express.urlencoded | URL 编码解析，限制 10MB |
| 4 | morgan | HTTP 日志（dev/combined） |
| 5 | logger | 自定义请求响应日志 |
| 6 | 速率限制 | 生产 500次/分钟，开发 1000次/分钟 |
| 7 | /uploads 静态文件 | 路径遍历防护，图片缓存 7 天，回退占位图 |
| 8 | /api/v1 路由 | 路由聚合入口 |
| 9 | /health | 健康检查端点 |
| 10 | errorHandler | 全局错误捕获 |

### 3.3 中间件层

#### auth.js — JWT 认证中间件

导出两个中间件：

| 函数 | 用途 |
|------|------|
| `auth` | 强制认证：从 `Authorization: Bearer <token>` 中解析 JWT，验证账号存在且未被禁用，将 `req.user` 挂载解码后的用户信息。审核员(reviewer)角色拦截所有非 GET 请求 |
| `optionalAuth` | 可选认证：有 token 则解析，无 token 也放行，用于游客可浏览的公开接口 |

**认证失败处理**：TokenExpiredError → "令牌已过期"、JsonWebTokenError → "无效的令牌"、账号禁用 → "账号已被禁用"

#### permission.js — 权限控制中间件

| 函数 | 用途 |
|------|------|
| `checkPermission(allowedRoles)` | 角色权限：`super_admin` / `reviewer` / `*` 通配符直接放行，其他按角色/用户类型匹配 |
| `checkModulePermission(moduleId)` | 模块权限：`super_admin` / `reviewer` / `*` 通配符直接放行，其他检查 `permissions` 数组 |

#### storeFilter.js — 门店数据隔离

| 角色 | 行为 |
|------|------|
| `super_admin` / `store_manager` | 无限制 |
| `staff` | GET 请求自动注入 `store_id` 过滤；POST/PUT 校验 `store_id` 一致性 |

#### dataMasking.js — 审核员数据脱敏

对 `reviewer` 角色自动脱敏以下字段：
- `real_name` / `nick_name`: 保留首字，其余用 `*` 替换
- `phone` / `reserve_phone` / `wechat_phone`: 前3位 + `****` + 后4位
- `username`: 保留前2位，其余用 `*` 替换

通过拦截 `res.json` 实现，递归遍历响应体，对 Mongoose Document 自动转普通对象。

#### errorHandler.js — 全局错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| `ValidationError` (Mongoose) | 400 + 验证失败消息列表 |
| `CastError` (Mongoose) | 400 + 参数格式错误 |
| `11000` (重复键) | 400 + 字段已存在 |
| `UnauthorizedError` (JWT) | 401 + 认证失败 |
| `MulterError` | 413/400 + 文件上传错误 |
| `BusinessError` | 对应 statusCode + 业务消息 |
| 普通 `Error` | 400 + 业务错误消息 |
| 默认 | 500 + 服务器内部错误 |

#### validate.js — 参数校验

- `objectId(paramName)`: 校验 MongoDB ObjectId 格式（24位十六进制）
- `required(fields)`: 校验必填字段

#### logger.js — 请求日志

记录每个请求的方法、路径、状态码、耗时，按状态码级别输出（500→error, 400→warn, 其他→log）。

### 3.4 路由层

**`src/routes/index.js`** — 路由聚合入口，挂载 26 个路由模块到 `/api/v1` 前缀下：

| 路由前缀 | 模块文件 | 说明 |
|----------|----------|------|
| `/auth` | `auth.routes.js` | 微信登录、管理员登录、个人信息、修改密码 |
| `/schedules` | `schedule.routes.js` | 排课管理（CRUD、批量、取消、标记完成、预约名单） |
| `/bookings` | `booking.routes.js` | 预约管理（创建、取消、签到、候补、低人数检查） |
| `/members` | `member.routes.js` | 会员管理（列表、详情、审核、豁免、停卡/复卡、手机审核） |
| `/packages` | `package.routes.js` | 套餐管理（CRUD、激活、延长、状态刷新） |
| `/package-activations` | `package.routes.js` | 套餐激活记录 |
| `/package-extensions` | `package.routes.js` | 套餐延长记录 |
| `/coaches` | `coach.routes.js` | 教练管理（CRUD） |
| `/coach-salaries` | `coach-salary.routes.js` | 教练薪酬（配置、统计、结算） |
| `/stores` | `store.routes.js` | 门店管理（CRUD、最近门店） |
| `/holidays` | `holiday.routes.js` | 假期管理（CRUD、取消假期） |
| `/images` | `image.routes.js` | 图片管理 |
| `/announces` | `announcement.routes.js` | 公告管理（CRUD） |
| `/dance-styles` | `danceStyle.routes.js` | 舞种管理（CRUD） |
| `/banners` | `banner.routes.js` | 轮播图管理（CRUD） |
| `/config` | `config.routes.js` | 系统配置管理 |
| `/accounts` | `account.routes.js` | 管理员账号管理 |
| `/logs` | `log.routes.js` | 操作日志查询 |
| `/upload` | `upload.routes.js` | 文件上传（图片/视频） |
| `/stats` | `stats.routes.js` | 数据统计 |
| `/home` | `home.routes.js` | 首页聚合数据（轮播图、教练、视频） |
| `/week-template` | `week-template.routes.js` | 周课表模板 |
| `/qrcode` | `qrcode.routes.js` | 签到二维码 |
| `/system` | `system.routes.js` | 系统重置 |
| `/attendance` | `attendance.routes.js` | 出勤记录 |
| `/pre-members` | `preMember.routes.js` | 预建档会员 |
| `/template-mappings` | `template-mapping.routes.js` | 订阅消息模板映射 |

### 3.5 业务逻辑层 (Services)

| 文件 | 核心职责 |
|------|----------|
| `booking.service.js` | 预约创建/取消、签到校验、候补通知、WebSocket 推送、课程快照写入 |
| `schedule.service.js` | 排课创建/冲突检测、批量生成、取消/下架、人数不足自动取消、自动签到、课程完成 |
| `member.service.js` | 会员审核、编码分配、豁免管理、停卡/复卡、手机审核、信息修改审核 |
| `package.service.js` | 套餐激活/延长、到期检查、状态刷新、自动激活逻辑 |
| `coach.service.js` | 教练 CRUD、首页展示筛选 |
| `coach-salary.service.js` | 教练薪酬计算、课时统计、结算单生成 |
| `coachAttendance.service.js` | 教练出勤记录 |
| `attendance.service.js` | 会员出勤记录、签到统计 |
| `auth.service.js` | 微信 code2session、管理员登录验证、JWT 签发 |
| `store.service.js` | 门店 CRUD、最近门店计算 |
| `holiday.service.js` | 假期管理、排课封禁/解封 |
| `announcement.service.js` | 公告 CRUD |
| `image.service.js` | 图片上传、压缩（sharp） |
| `reminder.service.js` | 套餐到期提醒、低次数提醒、不活跃提醒 |
| `wechat-message.service.js` | 微信订阅消息发送（上课提醒、预约成功、取消通知） |
| `websocket.service.js` | WebSocket 服务初始化、广播给管理员、单用户推送 |
| `log.service.js` | 操作日志记录 |
| `stats.service.js` | 仪表盘统计数据 |
| `preMember.service.js` | 预建档会员导入与管理 |
| `week-template.service.js` | 周课表模板管理 |

### 3.6 数据模型层 (Models)

共 24 个 Mongoose 模型，文件位于 `src/models/`：

| 模型 | 集合名 | 核心字段 |
|------|--------|----------|
| `User` | `users` | openid, phone, user_type, member_status, role, permissions, store_id, exemption_count, member_code |
| `Coach` | `coaches` | name, avatar_url, phone, introduction, dance_styles, gallery, status |
| `Schedule` | `schedules` | coach_id, dance_style_id, store_id, date, start_time, end_time, max_bookings, min_bookings, status |
| `Booking` | `bookings` | user_id, schedule_id, coach_id, booking_date, status, checked_in, cancel_type, exemption_used, 课程快照字段 |
| `Waitlist` | `waitlists` | user_id, schedule_id, status(waiting/notified/confirmed/expired), expire_at |
| `Package` | `packages` | name, class_count, price, duration_days, dance_styles, status |
| `UserPackage` | `userpackages` | user_id, package_id, status, total_sessions, used_sessions, remaining_sessions, start_date, end_date, is_suspended |
| `Store` | `stores` | name, address, phone, location, business_hours, status |
| `DanceStyle` | `dancestyles` | name, description, icon_url, sort_order, status |
| `Banner` | `banners` | title, image_url, link_type, link_value, sort_order, status |
| `Announcement` | `announcements` | title, content, store_id, status |
| `Holiday` | `holidays` | name, date, end_date, is_recurring, type, store_scope, status |
| `Attendance` | `attendances` | booking_id, user_id, schedule_id, check_in_time, status |
| `CoachAttendance` | `coachattendances` | coach_id, schedule_id, check_in_time |
| `CoachSalary` | `coachsalaries` | coach_id, period, total_classes, total_amount, status |
| `CoachSalaryStat` | `coachsalarystats` | coach_id, month, class_count, total_amount |
| `SalaryBill` | `salarybills` | coach_id, period, items, total_amount |
| `Config` | `configs` | key, value |
| `SystemConfig` | `systemconfigs` | key, value |
| `OperationLog` | `operationlogs` | operator_id, action, module, target_id, detail |
| `PackageActivation` | `packageactivations` | user_package_id, activated_by, activated_at |
| `PackageExtension` | `packageextensions` | user_package_id, extend_days, reason, operated_by |
| `PendingTask` | `pendingtasks` | schedule_id, user_id, trigger_at, type, processed |
| `WeekTemplate` | `weektemplates` | store_id, day_of_week, coach_id, dance_style_id, start_time, end_time |
| `TemplateFieldMapping` | `templatefieldmappings` | template_id, field_mappings |

**关键索引示例**：
- `User`: `{openid: 1}` (unique sparse), `{user_type: 1, member_status: 1}`, `{phone: 1}`
- `Booking`: `{user_id: 1, booking_date: 1}`, `{schedule_id: 1, status: 1}`, `{coach_id: 1, booking_date: 1}`
- `Schedule`: `{store_id: 1, date: 1}`, `{coach_id: 1, date: 1}`, `{status: 1}`

### 3.7 工具函数 (Utils)

| 文件 | 核心功能 |
|------|----------|
| `response.js` | 统一响应格式：`success(data, message)` → `{code:200, message, data}`；`error(code, message)` → `{code, message, data:null}`；`paginate(list, total, page, pageSize)` → 分页对象 |
| `scheduler.js` | 基于 `node-cron` 的定时任务调度器，注册 10+ 个定时任务，使用 `PendingTask` 实现精确到分钟的事件触发 |
| `crypto.js` | 加密/解密工具 |
| `date.js` | 日期格式化与计算 |
| `time.js` | 服务器时间同步 |
| `validator.js` | 数据校验 |
| `wechat.js` | 微信 API 调用封装（code2session、订阅消息发送） |

### 3.8 种子数据 (Seed)

| 文件 | 说明 | npm script |
|------|------|------------|
| `init.seed.js` | 初始化基础数据（超级管理员账号） | `npm run seed` |
| `stores.seed.js` | 初始化门店数据 | `npm run seed:stores` |
| `danceStyles.seed.js` | 初始化舞种数据 | `npm run seed:dance` |
| `packages.seed.js` | 初始化套餐模板 | `npm run seed:packages` |
| `coaches.seed.js` | 初始化教练数据 | `npm run seed:coaches` |
| `banners.seed.js` | 初始化轮播图 | `npm run seed:banners` |
| `reset-admin.seed.js` | 重置管理员密码 | `npm run reset-admin` |

### 3.9 定时任务 (Scheduler)

通过 `node-cron` + `PendingTask` 模型实现，位于 `src/utils/scheduler.js`：

| 时间 | 任务 | 说明 |
|------|------|------|
| 每天 02:00 | 检查自动激活 pending 套餐 | 到期自动激活 |
| 每天 02:15 | 检查 ≥60天未预约的 pending 套餐 | 设置自动激活时间 |
| 每天 02:40 | 检查到期停卡自动复卡 | 到期自动恢复 |
| 每天 03:00 | 检查过期套餐 | 标记为 expired |
| 每天 04:00 | 清理过期候补 | 标记已过期课程候补 |
| 每天 04:30 | 处理过期放假 | 自动解封排课，重建 PendingTask |
| 每天 04:30 | 清理已处理 PendingTask | 删除 7 天前的已完成任务 |
| 每天 05:00 | 清理孤立上传文件 | 删除未被引用的文件 |
| 每分钟 | 处理 PendingTask | 上课提醒、人数不足取消、自动签到、课程完成 |
| 每 5 分钟 | PendingTask 兜底恢复 | 恢复卡在 sending 状态的任务 |
| 每 10 分钟 | 候补过期检查 | 释放名额给下一位候补用户 |
| 每分钟 | 套餐提醒推送 | 根据配置时间推送到期/低次数/不活跃提醒 |

**PendingTask 机制**：排课创建时自动生成对应 PendingTask 记录，精确到分钟的 `trigger_at` 时间，由每分钟 cron 任务原子认领并处理，支持多实例并发安全。

---

## 4. 会员端小程序 (wuqi-member)

### 4.1 目录结构

```
wuqi-member/
├── app.js                        # 小程序入口
├── app.json                      # 全局配置（窗口、tabBar、分包）
├── app.wxss                      # 全局样式变量
├── project.config.json           # 开发者工具配置
├── config/
│   └── index.js                  # API 地址配置（dev/test/prod 三套环境）
├── pages/                        # 主包页面
│   ├── index/                    # 首页（轮播图、今日课程、教练、视频）
│   ├── booking/                  # 预约页（日历选日、课程列表、预约操作）
│   ├── profile/                  # 个人中心
│   └── splash/                   # 启动页
├── package-sub/                  # 分包页面
│   └── pages/
│       ├── about/                # 关于我们
│       ├── agreement/            # 用户协议
│       ├── coach-detail/         # 教练详情
│       ├── coach-list/           # 教练列表
│       ├── course-detail/        # 课程详情
│       ├── member-info/          # 会员信息
│       ├── package-detail/       # 套餐详情
│       ├── privacy/              # 隐私政策
│       ├── records/              # 预约记录
│       └── subscribe-settings/   # 订阅设置
├── components/                   # 公共组件
│   ├── coach-card/               # 教练卡片
│   ├── course-card/              # 课程卡片
│   ├── empty-state/              # 空状态
│   ├── login-modal/              # 登录弹窗
│   ├── store-picker/             # 门店选择器
│   └── tab-bar/                  # 自定义 TabBar
├── custom-tab-bar/               # 自定义 TabBar 实现
├── utils/                        # 工具函数
│   ├── api.js                    # 按模块分组的 API 封装
│   ├── request.js                # HTTP 请求封装（自动重试、网络检测）
│   ├── auth.js                   # 权限工具
│   ├── helpers.js                # 辅助函数
│   ├── qrcode.js                 # 二维码生成
│   ├── subscribe-message.js      # 订阅消息
│   ├── weapp.qrcode.js           # 二维码库
│   ├── websocket-client.js       # WebSocket 客户端
│   └── *.wxs                     # WXS 脚本（compare、dance-colors、date-format、distance）
└── styles/                       # 全局样式
    ├── global.wxss
    └── responsive.wxss
```

### 4.2 全局应用入口

**`app.js`** — 核心全局数据：

```javascript
globalData: {
  userInfo,          // 用户信息（5分钟缓存）
  token,             // JWT 令牌
  currentStore,      // 当前选中的门店
  storeList,         // 门店列表
  baseUrl,           // API 基础 URL
  defaultStoreSet,   // 是否已设置默认门店
  isOnline,          // 网络状态
  privacyResolve     // 隐私授权回调
}
```

**启动流程 (onLaunch)**：
1. `silenceUnsupportedApi()` — 静默不支持的 API（reportRealtimeAction 等）
2. `registerPrivacyHandler()` — 注册隐私协议处理
3. `registerNetworkListener()` — 网络状态监听
4. 读取本地 token → 有 token 则延迟 500ms 后调用 `getUserInfo()` + `getStoreList()`
5. `fetchTemplates()` — 延迟获取订阅消息模板

**门店匹配逻辑 (determineDefaultStore)**：
1. 用户所属门店 `userInfo.store_id`（预建档/审核通过时写入）
2. 套餐所属门店 → 多门店按位置匹配最近
3. 无套餐用户/游客 → 按位置匹配最近门店（Haversine 公式计算距离）

**核心方法**：
- `getUserInfo(forceRefresh, coldStartRetry)` — 5分钟缓存，冷启动自愈重试（最多3次）
- `getStoreList(retryCount)` — 自愈重试（最多3次）
- `determineDefaultStore(force)` — 统一门店匹配
- `forceLogoutAndRedirect(message)` — 认证失效强制登出

### 4.3 页面结构

| 页面 | 路径 | 功能 | 关键数据 |
|------|------|------|----------|
| 启动页 | `pages/splash/` | 启动画面，自动跳转 | - |
| 首页 | `pages/index/` | 轮播图、今日课程、推荐教练、热门视频 | banners, todaySchedules, coaches, videos |
| 预约页 | `pages/booking/` | 日历选日、课程列表、预约/取消/候补 | schedules, myPackages, myBookings |
| 课程详情 | `package-sub/pages/course-detail/` | 课程信息、预约/取消、候补操作 | schedule, isBooked, canCancel, waitlistCount |
| 个人中心 | `pages/profile/` | 用户信息、功能入口列表 | userInfo, currentStore |
| 预约记录 | `package-sub/pages/records/` | 历史预约、上课记录 | bookings |
| 教练列表 | `package-sub/pages/coach-list/` | 全部教练 | coaches |
| 教练详情 | `package-sub/pages/coach-detail/` | 教练信息、课程、视频 | coach, schedules, videos |
| 套餐详情 | `package-sub/pages/package-detail/` | 套餐信息 | packages |
| 会员信息 | `package-sub/pages/member-info/` | 会员资料、手机号修改 | userInfo, memberCode |
| 订阅设置 | `package-sub/pages/subscribe-settings/` | 消息订阅管理 | templates, subscribedTemplates |
| 关于/协议/隐私 | `package-sub/pages/about/` 等 | 静态信息页面 | - |

### 4.4 组件

| 组件 | 路径 | 功能 |
|------|------|------|
| login-modal | `components/login-modal/` | 手机号授权登录弹窗，隐私政策勾选 |
| tab-bar | `components/tab-bar/` + `custom-tab-bar/` | 自定义底部导航栏（首页、预约、我的） |
| coach-card | `components/coach-card/` | 教练信息卡片 |
| course-card | `components/course-card/` | 课程信息卡片 |
| empty-state | `components/empty-state/` | 空状态占位组件 |
| store-picker | `components/store-picker/` | 门店选择器 |

### 4.5 工具函数

#### request.js

封装 `wx.request`，核心特性：
- 自动拼接 `baseUrl`，自动携带 `Authorization: Bearer <token>`
- GET 请求默认重试 2 次（网络错误），写操作不重试
- 全局网络状态检查：断网时直接跳过请求
- 401/403 自动强制登出，401 静默提示
- 超时 15 秒

#### api.js

按模块分组的 API 调用封装：
- `auth`: wxLogin, getMe, updateProfile, changePassword
- `home`: getBanners, getCoaches, getVideos
- `stores`: getList, getNearest
- `schedules`: getList, getDetail
- `bookings`: create, cancel, getMy, getMyAttendance, checkIn, waitlist 等
- `packages`: getMy, getDetail
- `coaches`: getList, getDetail
- `danceStyles`: getList
- `attendance`: getRecords

#### subscribe-message.js

- `fetchTemplates()` — 获取订阅消息模板 ID
- `requestSubscribe(templateIds)` — 请求用户订阅授权

---

## 5. 管理端小程序 (wuqi-admin)

### 5.1 目录结构

```
wuqi-admin/
├── app.js                        # 小程序入口
├── app.json                      # 全局配置（窗口、tabBar、分包）
├── app.wxss                      # 全局样式变量（"素练流影"设计系统）
├── project.config.json           # 开发者工具配置
├── config/
│   └── index.js                  # API 地址配置（dev/test/prod）
├── pages/                        # 主包页面
│   ├── dashboard/                # 首页仪表盘
│   ├── login/                    # 登录页
│   ├── members/                  # 会员管理
│   ├── operations/               # 运营页
│   ├── profile/                  # 个人中心
│   ├── shop/                     # 店务管理
│   └── splash/                   # 启动页
├── package-common/               # 通用分包
│   └── pages/
│       ├── about/                # 关于我们
│       ├── agreement/            # 用户协议
│       ├── logs/                 # 操作日志
│       ├── privacy/              # 隐私政策
│       ├── profile/account-security/  # 账户安全
│       └── todo-list/            # 待办事项
├── package-member/               # 会员分包
│   └── pages/members/
│       ├── booking-list/         # 会员预约列表
│       ├── info-review/          # 信息审核
│       ├── member-detail/        # 会员详情
│       ├── member-review/        # 会员审核
│       ├── phone-review/         # 电话审核
│       └── pre-member/           # 预建档会员
├── package-schedule/             # 排课分包
│   └── pages/
│       ├── booking-summary/      # 预约汇总
│       ├── bookings/             # 预约管理
│       ├── check-in/             # 签到管理
│       ├── course-records/       # 课程记录
│       ├── schedule/             # 排课管理
│       └── waitlist/             # 等待列表
├── package-settings/             # 设置分包
│   └── pages/settings/
│       ├── accounts/             # 账号管理
│       ├── config/               # 配置管理
│       ├── exemption/            # 豁免管理
│       ├── roles/                # 角色管理
│       ├── template-edit/        # 模板编辑
│       └── system-reset/         # 系统重置
├── package-shop/                 # 店务分包
│   └── pages/
│       ├── announcements/        # 公告管理
│       ├── banner/               # 轮播图管理
│       ├── coaches/              # 教练管理
│       ├── holidays/             # 假期管理
│       ├── images/               # 图片管理
│       ├── package-logs/         # 套餐日志
│       ├── salary/               # 薪资管理
│       └── shop/                 # 门店维护
├── components/                   # 公共组件
│   ├── date-picker/              # 日期选择器
│   ├── empty-state/              # 空状态
│   ├── tab-bar/                  # 自定义 TabBar
│   └── time-picker/              # 时间选择器
├── custom-tab-bar/               # 自定义 TabBar 实现
├── utils/                        # 工具函数
│   ├── api.js                    # 按模块分组的 API 封装
│   ├── request.js                # HTTP 请求封装
│   ├── auth.js                   # 权限工具
│   ├── config.js                 # 配置工具
│   ├── helpers.js                # 辅助函数
│   ├── util.js                   # 通用工具
│   └── websocket-client.js       # WebSocket 客户端
└── styles/
    ├── global.wxss
    └── responsive.wxss
```

### 5.2 全局应用入口

**`app.js`** — 核心全局数据：

```javascript
globalData: {
  userInfo,          // 管理员信息
  token,             // JWT 令牌（存储键: admin_token）
  currentStore,      // 当前门店
  currentStoreId,    // 当前门店 ID
  storeList,         // 门店列表
  baseUrl,           // API 基础 URL
  serverBase,        // 服务器基础 URL
  deviceFingerprint, // 设备指纹（UUID）
  isOnline           // 网络状态
}
```

**启动流程 (onLaunch)**：
1. `silenceUnsupportedApi()` — 静默不支持的 API
2. `registerPrivacyHandler()` — 隐私协议处理
3. `registerNetworkListener()` — 网络状态监听
4. `initDeviceFingerprint()` — 初始化设备指纹
5. 有 token 时延迟 500ms 调用 `getUserInfo()` + `getStoreList()`

**核心方法**：
- `getUserInfo(retryCount)` — 自愈重试（最多3次）
- `getStoreList(retryCount)` — 自愈重试（最多3次）
- `checkAuth()` — 检查登录状态，未登录跳转登录页
- `hasPermission(moduleId)` — 检查模块权限（super_admin 和 `*` 通配符直接放行）

### 5.3 页面与分包结构

**TabBar（5个标签）**：首页、运营、会员、店务、我的

**分包页面**：

| 分包 | 页面 | 功能 |
|------|------|------|
| package-common | about, agreement, privacy, logs, account-security, todo-list | 通用页面 |
| package-member | member-detail, booking-list, member-review, phone-review, info-review, pre-member | 会员管理 |
| package-schedule | schedule, bookings, check-in, course-records, booking-summary, waitlist | 排课与预约 |
| package-shop | coaches, salary, holidays, announcements, banner, images, package-logs, store-maintenance, booking-window | 店务管理 |
| package-settings | accounts, roles, config, exemption, template-edit, system-reset | 系统设置 |

### 5.4 组件

| 组件 | 路径 | 功能 |
|------|------|------|
| tab-bar | `components/tab-bar/` + `custom-tab-bar/` | 自定义底部导航栏（5个标签） |
| empty-state | `components/empty-state/` | 空状态占位组件 |
| date-picker | `components/date-picker/` | 日期选择器组件 |
| time-picker | `components/time-picker/` | 时间选择器组件 |

### 5.5 工具函数

#### request.js

与会员端类似，但有以下差异：
- Token 存储键为 `admin_token`
- 401 时自动 `reLaunch` 到登录页
- GET 请求默认重试 1 次
- 审核员 403 特殊提示："当前为审核账号，仅可查看"

#### api.js

按模块分组的 API 调用封装，涵盖管理端所有功能模块（auth, members, schedules, bookings, coaches, packages, stores, banners, holidays, announcements, danceStyles, videos, attendance, upload, stats, config, accounts, logs, system, salary, weekTemplate, qrcode, preMembers 等）。

#### auth.js

权限判断工具函数，检查用户角色和模块权限。

#### websocket-client.js

WebSocket 客户端，用于接收实时推送（签到通知、预约变更等）。

---

## 6. 数据库模型

### 6.1 核心模型关系图

```
User ────┐
         ├──→ Booking ────→ Schedule ────→ Coach
         │       │              │              │
         │       │              │              ├──→ DanceStyle
         │       │              │              │
         │       └──→ UserPackage ──→ Package  │
         │                                      │
         └──→ Store ────────────────────────────┘

Waitlist ──→ Schedule ──→ User

Holiday ──→ Store (可选)

Banner / Announcement ──→ Store (可选)

Attendance ──→ Booking ──→ User / Schedule

CoachAttendance ──→ Schedule ──→ Coach

CoachSalary / CoachSalaryStat ──→ Coach

PendingTask ──→ Schedule ──→ User (可选)

WeekTemplate ──→ Store / Coach / DanceStyle
```

### 6.2 关键模型字段详解

#### User（用户/会员/管理员）

- **用户类型** (`user_type`): `member` | `admin` | `staff`
- **会员状态** (`member_status`): `guest` | `registered` | `official` | `pending_claim`
- **管理角色** (`role`): `super_admin` | `store_manager` | `staff` | `reviewer`
- **权限** (`permissions`): 模块权限列表，`*` 表示全部权限
- **密码加密**: bcryptjs，`pre('save')` 钩子自动加密
- **密码比较**: `user.comparePassword(password)` 实例方法

#### Booking（预约）

- **状态** (`status`): `booked` | `cancelled` | `completed`
- **取消类型** (`cancel_type`): `normal` | `exempt` | `quick` | `admin_cancel` | `min_bookings_not_met` | `holiday` | `after_checkin_cancel`
- **课程快照字段**: `course_name`, `schedule_date`, `coach_name`, `store_name`, `dance_style_name` 等（课程删除后仍可溯源）
- **上课提醒标记**: `reminder_1h_sent`, `reminder_30m_sent`

#### Schedule（排课）

- **状态** (`status`): `available` | `full` | `cancelled` | `offline` | `not_open` | `completed`
- **预约截止** (`booking_deadline`): 默认 120 分钟
- **取消截止** (`cancel_deadline`): 默认 60 分钟
- **最低开课人数** (`min_bookings`): 默认 5 人

#### UserPackage（用户套餐）

- **状态** (`status`): `pending` | `active` | `expired` | `cancelled`
- **停卡** (`is_suspended`): 停卡时冻结 `frozen_remaining_credits` 和 `frozen_end_date`
- **自动激活** (`auto_activate_at`): 首次预约时激活，或 60 天未预约自动激活

---

## 7. API 接口索引

### 7.1 认证模块 `/api/v1/auth`

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/auth/wx-login` | 否 | 会员端微信登录（code → JWT） |
| POST | `/auth/admin-login` | 否 | 管理端账号密码登录 |
| GET | `/auth/me` | 是 | 获取当前用户信息 |
| PUT | `/auth/me` | 是 | 更新个人信息 |
| PUT | `/auth/password` | 是 | 修改密码 |

### 7.2 排课模块 `/api/v1/schedules`

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/schedules` | 否 | 排课列表（支持 date/coach_id/store_id/dance_style_id 筛选） |
| POST | `/schedules` | 是 | 创建排课 |
| PUT | `/schedules/:id` | 是 | 编辑排课 |
| DELETE | `/schedules/:id` | 是 | 删除排课 |
| POST | `/schedules/batch` | 是 | 批量创建排课 |
| DELETE | `/schedules/batch` | 是 | 批量删除排课 |
| PUT | `/schedules/:id/cancel` | 是 | 取消排课 |
| PUT | `/schedules/:id/mark-completed` | 是 | 标记上课完成 |

### 7.3 预约模块 `/api/v1/bookings`

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/bookings` | 是 | 创建预约 |
| GET | `/bookings` | 是 | 获取预约列表 |
| GET | `/bookings/my` | 是 | 我的预约记录 |
| GET | `/bookings/my-attendance` | 是 | 我的出勤记录 |
| PUT | `/bookings/:id/cancel` | 是 | 取消预约 |
| PUT | `/bookings/:id/admin-cancel` | 是 | 管理员取消预约 |
| POST | `/bookings/check-in` | 是 | 扫码签到 |
| POST | `/bookings/batch-check-in` | 是 | 批量签到 |
| POST | `/bookings/waitlist` | 是 | 加入候补 |
| GET | `/bookings/waitlist/my` | 是 | 我的候补 |
| DELETE | `/bookings/waitlist/:id` | 是 | 取消候补 |
| PUT | `/bookings/waitlist/confirm/:id` | 是 | 候补确认预约 |

### 7.4 其他模块速查

| 路由前缀 | 说明 |
|----------|------|
| `/members` | 会员管理（列表、详情、审核、豁免、停卡/复卡、手机审核、信息审核） |
| `/packages` | 套餐管理（CRUD、激活、延长、状态刷新） |
| `/coaches` | 教练管理（CRUD） |
| `/coach-salaries` | 教练薪酬（配置、统计、结算） |
| `/stores` | 门店管理（CRUD、最近门店） |
| `/holidays` | 假期管理（CRUD、取消） |
| `/announces` | 公告管理（CRUD） |
| `/dance-styles` | 舞种管理（CRUD） |
| `/banners` | 轮播图管理（CRUD） |
| `/config` | 系统配置管理 |
| `/accounts` | 管理员账号管理 |
| `/logs` | 操作日志查询 |
| `/upload` | 文件上传（图片/视频） |
| `/stats` | 数据统计 |
| `/home` | 首页聚合数据 |
| `/week-template` | 周课表模板 |
| `/qrcode` | 签到二维码 |
| `/system` | 系统重置 |
| `/attendance` | 出勤记录 |
| `/pre-members` | 预建档会员 |
| `/template-mappings` | 订阅消息模板映射 |

---

## 8. 核心业务流程

### 8.1 会员预约流程

```
会员登录 → 选择门店 → 浏览课程 → 选择课程 → 预约课程
→ 系统校验（是否放假 / 名额是否充足 / 套餐剩余次数 / 是否已预约）
→ 课程满员 → 加入候补 → 有名额释放 → 通知候补会员 → 限时确认(15分钟)
→ 预约成功 → 创建 Booking + 更新 Schedule.current_bookings
→ 上课签到 → 扣减套餐次数 → 课程完成
```

### 8.2 取消预约扣减规则

| 取消类型 | 场景 | 退还次数 |
|----------|------|----------|
| `normal` | 开课前 ≥2小时取消 | 是 |
| `timeout` | 开课前 <2小时取消 | 否 |
| `exempt` | 使用豁免次数取消 | 否（使用豁免） |
| `admin_cancel` | 管理员取消 | 是 |
| `min_bookings_not_met` | 人数不足系统取消 | 是 |
| `holiday` | 放假取消 | 是 |
| `quick` | 补约后5分钟内取消 | 是 |

### 8.3 套餐激活流程

```
管理员录入套餐（pending） → 会员首次预约 → 自动激活 → 计算有效期
→ 上课消耗次数 → 套餐到期 → expired
→ 超60天未预约 → 系统自动激活
```

### 8.4 候补流程

```
课程满员 → 会员加入候补（waiting） → 有人取消 → 系统通知候补首位用户（notified）
→ 15分钟内确认 → 转为正式预约（confirmed）
→ 超时未确认 → expired → 通知下一位
```

### 8.5 权限体系

| 角色 | 权限范围 |
|------|----------|
| `super_admin` | 全部权限（最高管理员） |
| `store_manager` | 门店管理权限，管理所属门店 |
| `staff` | 基础操作权限，仅限所属门店 |
| `reviewer` | 只读审核账号，数据脱敏，不可写操作 |

**模块权限控制**：通过 `permissions` 数组做细粒度模块权限控制，`*` 通配符表示全部权限。

---

## 9. 依赖关系

### 9.1 后端依赖 (wuqi-backend/package.json)

| 包名 | 版本 | 用途 |
|------|------|------|
| `express` | ^5.2.1 | Web 框架 |
| `mongoose` | ^9.6.1 | MongoDB ODM |
| `jsonwebtoken` | ^9.0.3 | JWT 认证 |
| `bcryptjs` | ^3.0.3 | 密码加密 |
| `axios` | ^1.16.0 | HTTP 请求（微信 API 调用） |
| `cors` | ^2.8.6 | 跨域处理 |
| `dotenv` | ^17.4.2 | 环境变量加载 |
| `dayjs` | ^1.11.20 | 日期处理（含时区插件） |
| `morgan` | ^1.10.1 | HTTP 请求日志 |
| `multer` | ^2.1.1 | 文件上传 |
| `node-cron` | ^4.2.1 | 定时任务调度 |
| `sharp` | ^0.33.5 | 图片压缩处理 |
| `xlsx` | ^0.18.5 | Excel 文件读写（预建档导入） |
| `nodemon` | ^3.1.14 | 开发热重载 (devDependencies) |

### 9.2 前端依赖

前端为微信原生小程序开发，无 npm 依赖（除 `miniprogram-automator` 用于自动化测试）。

### 9.3 系统依赖

| 组件 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 18.x | 后端运行时 |
| MongoDB | >= 6.x | 数据库 |
| Nginx | 最新稳定版 | 反向代理 |
| PM2 | 最新版 | 进程守护 |
| FFmpeg | 系统级安装 | 视频压缩 |
| 微信基础库 | >= 3.15.2 | 小程序运行环境 |

### 9.4 项目间依赖关系

```
wuqi-member (会员端) ──HTTP API──→ wuqi-backend (后端) ──→ MongoDB
wuqi-admin (管理端)  ──HTTP API──→ wuqi-backend (后端) ──→ MongoDB
                                        │
                                   WebSocket ←→ 双向实时通信
```

两个小程序共用一个后端服务和数据库，通过 `client_type` 参数区分端，通过 Nginx 双域名配置区分 API 请求来源。

---

## 10. 项目运行方式

### 10.1 本地开发环境

#### 后端

```bash
# 1. 进入后端目录
cd wuqi-backend

# 2. 安装依赖
npm install

# 3. 配置环境变量（复制 .env.example 为 .env）
cp .env.example .env
# 编辑 .env 填入 MongoDB 连接字符串和微信小程序密钥

# 4. 初始化种子数据
npm run seed          # 初始化超级管理员
npm run seed:stores   # 初始化门店
npm run seed:dance    # 初始化舞种
npm run seed:packages # 初始化套餐
npm run seed:coaches  # 初始化教练
npm run seed:banners  # 初始化轮播图

# 5. 启动开发服务器（热重载）
npm run dev

# 或启动生产模式
npm start
```

#### 小程序前端

```bash
# 1. 使用微信开发者工具分别导入
#    - wuqi-member/ 目录（会员端）
#    - wuqi-admin/ 目录（管理端）

# 2. 修改 config/index.js 中的环境配置
#    env = 'dev'  → 连接 localhost:3000
#    env = 'test' → 连接测试服务器
#    env = 'prod' → 连接正式域名

# 3. 在开发者工具中勾选「不校验合法域名」
```

### 10.2 生产环境部署

```bash
# 1. 上传代码到服务器
scp -r wuqi-backend ubuntu@101.33.203.22:/home/ubuntu/wuqi-dance-system/backend/

# 2. SSH 登录服务器
ssh ubuntu@101.33.203.22

# 3. 安装依赖
cd /home/ubuntu/wuqi-dance-system/backend
npm install

# 4. 安装系统依赖
sudo apt install -y ffmpeg
sudo npm install -g pm2

# 5. 配置环境变量
nano .env   # 填入真实密钥

# 6. 初始化种子数据
npm run seed

# 7. 启动 PM2 进程
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 8. 配置 Nginx 反向代理
sudo bash /home/ubuntu/wuqi-dance-system/setup-nginx.sh
```

### 10.3 常用运维命令

```bash
# PM2 管理
pm2 list              # 查看进程状态
pm2 logs wuqi         # 查看日志
pm2 restart wuqi      # 重启服务
pm2 stop wuqi         # 停止服务

# MongoDB 备份
mongodump --db wuqi_dance --out /backup/$(date +%Y%m%d)

# MongoDB 恢复
mongorestore --db wuqi_dance /backup/20260711/

# 重新初始化管理员密码
npm run reset-admin
```

### 10.4 环境变量说明

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `NODE_ENV` | 否 | `development` / `production` |
| `PORT` | 否 | 服务端口，默认 3000 |
| `MONGODB_URI` | 是 | MongoDB 连接字符串 |
| `JWT_SECRET` | 是(生产) | JWT 签名密钥 |
| `JWT_EXPIRES_IN` | 否 | JWT 过期时间，默认 7d |
| `WX_MEMBER_APPID` | 是 | 会员端小程序 AppID |
| `WX_MEMBER_SECRET` | 是 | 会员端小程序 Secret |
| `WX_ADMIN_APPID` | 是 | 管理端小程序 AppID |
| `WX_ADMIN_SECRET` | 是 | 管理端小程序 Secret |
| `COS_SECRET_ID` | 否 | 腾讯云 COS 密钥 ID |
| `COS_SECRET_KEY` | 否 | 腾讯云 COS 密钥 Key |
| `COS_BUCKET` | 否 | COS 存储桶名称 |
| `COS_REGION` | 否 | COS 区域，默认 ap-guangzhou |

---

> **文档版本**: v1.0  
> **生成日期**: 2026-07-11  
> **项目**: 舞栖DANCE 舞蹈社预约管理系统