# 舞栖DANCE 舞蹈社预约管理系统 - 完整开发文档

> **版本**: v1.1.0  
> **更新日期**: 2026年6月13日  
> **文档用途**: 供开发者从零开始复刻整个项目

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [后端服务 (wuqi-backend)](#3-后端服务-wuqi-backend)
4. [会员端小程序 (wuqi-member)](#4-会员端小程序-wuqi-member)
5. [管理端小程序 (wuqi-admin)](#5-管理端小程序-wuqi-admin)
6. [数据库模型](#6-数据库模型)
7. [API接口文档](#7-api接口文档)
8. [数据流与业务交互](#8-数据流与业务交互)
9. [核心业务流程](#9-核心业务流程)
10. [部署指南](#10-部署指南)

---

## 1. 项目概述

### 1.1 项目简介

**舞栖DANCE** 是一个舞蹈培训机构预约管理系统，由以下三个子项目组成：

| 项目 | 名称 | 技术栈 | AppID | API域名 |
|------|------|--------|-------|---------|
| **wuqi-member** | 舞栖DANCE | 微信小程序原生开发 | `wxeb3b664ce36208ba` | `https://api.yuekeme.cn` |
| **wuqi-admin** | 舞栖DANCE预约系统管理 | 微信小程序原生开发 | `wx3f52761ae85bd5e7` | `https://admin-api.yuekeme.cn` |
| **wuqi-backend** | 后端服务 | Node.js + Express + MongoDB | - | 同上（同时服务两个域名） |

### 1.2 服务器信息

| 项目 | 详情 |
|------|------|
| 云服务商 | 腾讯云轻量应用服务器 |
| 公网IP | `101.33.203.22` |
| 操作系统 | Ubuntu |
| 后端部署路径 | `/home/ubuntu/wuqi-dance-system/backend/` |
| 后端进程管理 | PM2 |
| Web服务器 | Nginx（反向代理） |
| 视频处理 | FFmpeg（上传视频自动压缩） |
| 图片处理 | sharp（上传图片自动压缩优化） |

### 1.3 经营主体信息

| 门店 | 运营主体 |
|------|----------|
| 舞栖舞蹈社（福永店） | 双瑗文化艺术（深圳）有限公司 |
| 舞栖舞蹈社（固戍店） | 深圳市双瑗文艺有限公司 |

商标权利持有人：深圳市双瑗文艺有限公司（已授权双瑗文化艺术使用）

### 1.4 核心功能

**会员端：**
- 课程浏览与预约
- 预约记录与上课记录查询
- 教练列表查看
- 教练作品视频浏览
- 套餐信息查询
- 个人中心管理
- 签到功能
- 订阅消息推送

**管理端：**
- 首页仪表盘
- 排课管理
- 会员管理
- 预约管理
- 签到管理
- 教练管理
- 薪酬管理
- 套餐管理
- 转课管理
- 等待列表管理
- 门店管理
- 轮播图管理
- 教练作品管理
- 公告管理
- 假期管理
- 系统设置
- 操作日志

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        微信小程序平台                            │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │     会员端 (Member)       │  │     管理端 (Admin)        │    │
│  │  wxeb3b664ce36208ba      │  │  wx3f52761ae85bd5e7      │    │
│  │  api.yuekeme.cn           │  │  admin-api.yuekeme.cn    │    │
│  └──────────┬───────────────┘  └──────────┬───────────────┘    │
└─────────────┼─────────────────────────────┼────────────────────┘
              │         HTTPS API           │
              │  Nginx 反向代理 → :3000     │
              ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              腾讯云轻量应用服务器 (101.33.203.22)                 │
│              Ubuntu  |  PM2 进程管理                             │
│                                                                 │
│  后端服务 /home/ubuntu/wuqi-dance-system/backend/               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ 路由层    │  │ 控制器层  │  │ 模型层    │  │ 中间件层  │       │
│  │ routes/  │→│controllers│→│ models/  │  │middleware│       │
│  └──────────┘  └──────────┘  └────┬─────┘  └──────────┘       │
│                                    │                            │
│  ┌─────────────────────────────────┼──────────────────────────┐ │
│  │ FFmpeg视频压缩│ 定时任务  │ 微信API │ sharp图片压缩│ morgan│ │
│  └─────────────────────────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MongoDB 数据库                             │
│  数据库名: wuqi_dance                                            │
│  集合: users, coaches, bookings, schedules, packages,           │
│        stores, videos, banners, holidays, danceStyles,          │
│        announcements, weekTemplates, configurations, logs...    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈详情

| 层级 | 技术 | 版本 |
|------|------|------|
| 后端框架 | Express | ^5.2.1 |
| 数据库 | MongoDB + Mongoose | ^9.6.1 |
| 认证 | JWT (jsonwebtoken) | ^9.0.3 |
| 密码加密 | bcryptjs | ^3.0.3 |
| 文件上传 | multer | ^2.1.1 |
| 图片压缩 | sharp | ^0.33.5 |
| 视频压缩 | FFmpeg | 系统级安装 |
| 进程管理 | PM2 | 最新版 |
| Web服务器 | Nginx | 最新版 |
| 定时任务 | node-cron | ^4.2.1 |
| 日期处理 | dayjs | ^1.11.20 |
| HTTP客户端 | axios | ^1.16.0 |
| 日志 | morgan | ^1.10.1 |
| 前端 | 微信小程序原生框架 | wechat lib 3.x |
| 设计系统 | 自研"素练流影"设计系统 | v1.0 |
| 服务器 | 腾讯云轻量应用服务器 | Ubuntu |
| 服务器IP | 101.33.203.22 | - |

### 2.3 项目目录结构

```
项目根目录/
├── wuqi-member/              # 会员端小程序
│   ├── app.js                # 小程序入口
│   ├── app.json              # 全局配置
│   ├── app.wxss              # 全局样式
│   ├── config/
│   │   └── index.js          # API配置（开发/生产环境）
│   ├── pages/
│   │   ├── index/            # 首页
│   │   ├── booking/          # 预约页
│   │   ├── course-detail/    # 课程详情
│   │   ├── profile/          # 个人中心
│   │   ├── records/          # 预约记录
│   │   ├── coach-detail/     # 教练详情
│   │   ├── coach-list/       # 教练列表
│   │   ├── video-player/     # 视频播放
│   │   ├── package-detail/   # 套餐详情
│   │   ├── member-info/      # 会员信息
│   │   ├── splash/           # 启动页
│   │   ├── privacy/          # 隐私政策
│   │   ├── agreement/        # 用户协议
│   │   ├── about/            # 关于我们
│   │   └── subscribe-settings/ # 订阅设置
│   ├── components/
│   │   ├── login-modal/      # 登录弹窗组件
│   │   ├── tab-bar/          # 自定义TabBar
│   │   ├── coach-card/       # 教练卡片
│   │   └── course-card/      # 课程卡片
│   ├── utils/
│   │   ├── api.js            # API接口封装
│   │   ├── request.js        # HTTP请求封装
│   │   └── subscribe-message.js # 订阅消息工具
│   └── images/               # 图片资源
│
├── wuqi-admin/               # 管理端小程序
│   ├── app.js                # 小程序入口
│   ├── app.json              # 全局配置
│   ├── app.wxss              # 全局样式
│   ├── config/
│   │   └── index.js          # API配置
│   ├── pages/
│   │   ├── dashboard/        # 首页仪表盘
│   │   ├── login/            # 登录页
│   │   ├── operations/       # 运营页
│   │   ├── schedule/         # 排课管理
│   │   ├── members/          # 会员管理
│   │   │   ├── member-detail/    # 会员详情
│   │   │   ├── booking-list/     # 会员预约列表
│   │   │   ├── member-review/    # 会员审核
│   │   │   ├── phone-review/     # 电话审核
│   │   │   └── info-review/      # 信息审核
│   │   ├── shop/             # 店务管理
│   │   │   └── store-maintenance/ # 门店维护
│   │   ├── bookings/         # 预约管理
│   │   ├── check-in/         # 签到管理
│   │   ├── salary/           # 薪资管理
│   │   ├── waitlist/         # 等待列表
│   │   ├── transfers/        # 转课管理
│   │   ├── package-logs/     # 套餐日志
│   │   ├── videos/           # 教练作品
│   │   ├── banner/           # 轮播图管理
│   │   ├── coaches/          # 教练管理
│   │   ├── holidays/         # 假期管理
│   │   ├── announcements/    # 公告管理
│   │   ├── course-records/   # 课程记录
│   │   ├── booking-summary/  # 预约汇总
│   │   ├── settings/         # 系统设置
│   │   │   ├── roles/        # 角色管理
│   │   │   ├── accounts/     # 账号管理
│   │   │   ├── config/       # 配置管理
│   │   │   ├── exemption/    # 豁免管理
│   │   │   └── template-edit/ # 模板编辑
│   │   ├── logs/             # 操作日志
│   │   ├── profile/          # 个人中心
│   │   │   └── account-security/ # 账户安全
│   │   ├── system-reset/     # 系统重置
│   │   ├── todo-list/        # 待办事项
│   │   ├── splash/           # 启动页
│   │   ├── privacy/          # 隐私政策
│   │   ├── agreement/        # 用户协议
│   │   └── about/            # 关于我们
│   ├── components/
│   │   ├── tab-bar/          # 自定义TabBar
│   │   └── empty-state/      # 空状态组件
│   ├── custom-tab-bar/       # 自定义TabBar实现
│   ├── utils/
│   │   ├── api.js            # API接口封装
│   │   ├── request.js        # HTTP请求封装
│   │   ├── auth.js           # 权限工具
│   │   ├── helpers.js        # 工具函数
│   │   ├── util.js           # 通用工具
│   │   └── config.js         # 配置工具
│   └── styles/
│       └── responsive.wxss   # 响应式样式
│
└── wuqi-backend/             # 后端服务
    ├── server.js             # 入口文件
    ├── package.json          # 依赖配置
    ├── .env                  # 环境变量
    ├── src/
    │   ├── app.js            # Express应用配置
    │   ├── config/
    │   │   ├── index.js      # 配置入口
    │   │   └── database.js   # 数据库连接
    │   ├── models/           # Mongoose模型
    │   │   ├── User.js       # 用户模型
    │   │   ├── Coach.js      # 教练模型
    │   │   ├── Booking.js    # 预约模型
    │   │   ├── Schedule.js   # 排课模型
    │   │   ├── Package.js    # 套餐模型
    │   │   ├── Store.js      # 门店模型
    │   │   ├── Video.js      # 视频模型
    │   │   ├── Banner.js     # 轮播图模型
    │   │   ├── Holiday.js    # 假期模型
    │   │   ├── DanceStyle.js # 舞种模型
    │   │   ├── Announcement.js # 公告模型
    │   │   ├── UserPackage.js # 用户套餐模型
    │   │   ├── WeekTemplate.js # 周模板模型
    │   │   ├── Configuration.js # 系统配置模型
    │   │   ├── Log.js        # 日志模型
    │   │   └── ...其他模型
    │   ├── controllers/      # 控制器
    │   │   ├── auth.controller.js
    │   │   ├── booking.controller.js
    │   │   ├── schedule.controller.js
    │   │   ├── member.controller.js
    │   │   ├── package.controller.js
    │   │   ├── coach.controller.js
    │   │   ├── store.controller.js
    │   │   ├── video.controller.js
    │   │   ├── banner.controller.js
    │   │   ├── holiday.controller.js
    │   │   ├── ...其他控制器
    │   ├── routes/           # 路由
    │   │   ├── index.js      # 路由入口
    │   │   ├── auth.routes.js
    │   │   ├── booking.routes.js
    │   │   ├── schedule.routes.js
    │   │   ├── member.routes.js
    │   │   ├── package.routes.js
    │   │   ├── ...其他路由
    │   ├── middleware/       # 中间件
    │   │   ├── auth.js       # JWT认证中间件
    │   │   ├── errorHandler.js # 错误处理
    │   │   └── logger.js     # 日志中间件
    │   ├── utils/            # 工具函数
    │   │   ├── response.js   # 统一响应格式
    │   │   ├── scheduler.js  # 定时任务
    │   │   ├── time.js       # 时间工具
    │   │   └── wx.js         # 微信API工具
    │   └── seed/             # 种子数据
    │       ├── init.seed.js
    │       ├── stores.seed.js
    │       ├── danceStyles.seed.js
    │       ├── packages.seed.js
    │       ├── coaches.seed.js
    │       └── banners.seed.js
    └── uploads/              # 上传文件目录
```

---

## 3. 后端服务 (wuqi-backend)

### 3.1 技术栈

| 依赖 | 版本 | 用途 |
|------|------|------|
| express | ^5.2.1 | Web框架 |
| mongoose | ^9.6.1 | MongoDB ODM |
| jsonwebtoken | ^9.0.3 | JWT认证 |
| bcryptjs | ^3.0.3 | 密码加密 |
| multer | ^2.1.1 | 文件上传 |
| sharp | ^0.33.5 | 图片处理 |
| node-cron | ^4.2.1 | 定时任务 |
| dayjs | ^1.11.20 | 日期处理 |
| cors | ^2.8.6 | 跨域支持 |
| morgan | ^1.10.1 | HTTP日志 |
| axios | ^1.16.0 | HTTP客户端 |
| dotenv | ^17.4.2 | 环境变量 |

### 3.2 入口文件 (server.js)

文件路径: `wuqi-backend/server.js`

启动流程：
1. 加载环境变量 (dotenv)
2. 创建Express应用实例
3. 连接MongoDB数据库
4. 启动定时任务调度器 (startScheduler)
5. 同步服务器时间 (syncServerTime)
6. 监听端口 (默认3000)

### 3.3 Express应用配置 (src/app.js)

中间件栈：
1. **CORS** - 跨域配置，生产环境限制origin为微信小程序域名
2. **JSON解析** - 限制10MB
3. **URL编码解析** - 限制10MB
4. **morgan日志** - 开发环境dev格式，生产环境combined格式
5. **自定义日志中间件** - 记录请求日志
6. **速率限制** - 生产环境200次/分钟，开发环境1000次/分钟
7. **静态文件服务** - `/uploads` 路径，带路径遍历防护和缓存头
8. **API路由** - `/api/v1` 前缀
9. **健康检查** - `/health` 端点
10. **错误处理中间件** - 全局错误捕获

### 3.4 配置 (src/config/index.js)

```javascript
{
  port: 3000,
  mongodbUri: 'mongodb://localhost:27017/wuqi_dance',
  jwtSecret: 'JWT密钥',
  jwtExpiresIn: '7d',
  wxMemberAppId: 'wxeb3b664ce36208ba',
  wxMemberSecret: '会员端小程序Secret',
  wxAdminAppId: 'wx3f52761ae85bd5e7',
  wxAdminSecret: '管理端小程序Secret',
  cosSecretId: '腾讯云COS密钥ID',
  cosSecretKey: '腾讯云COS密钥Key',
  cosBucket: 'COS存储桶',
  cosRegion: 'ap-guangzhou'
}
```

### 3.5 JWT认证中间件 (src/middleware/auth.js)

认证流程：
1. 从请求头获取 `Authorization: Bearer <token>`
2. 验证JWT token有效性
3. 查询数据库检查账号是否存在且未被禁用
4. 将解码后的用户信息挂载到 `req.user`

### 3.6 统一响应格式 (src/utils/response.js)

```javascript
// 成功响应
{ code: 200, message: 'success', data: {...} }

// 分页响应
{ code: 200, message: 'success', data: { list: [...], total: 100, page: 1, pageSize: 20 } }

// 错误响应
{ code: 400, message: '错误信息', data: null }
```

---

## 4. 会员端小程序 (wuqi-member)

### 4.1 全局配置 (app.json)

| 配置项 | 值 |
|--------|-----|
| 小程序名称 | 舞栖DANCE |
| 导航栏背景色 | #FBFAF8 |
| 导航栏文字色 | black |
| 页面背景色 | #FAF8F6 |
| TabBar | 自定义(custom: true) |
| TabBar项 | 首页、预约、我的 |
| 选中色 | #D4956B |
| 懒加载 | requiredComponents |

### 4.2 页面列表

| 路径 | 页面名称 | 功能描述 |
|------|----------|----------|
| pages/splash/splash | 启动页 | 应用启动画面，自动跳转 |
| pages/index/index | 首页 | 轮播图、今日课程、教练展示、视频推荐 |
| pages/booking/booking | 预约页 | 日历选日、课程列表、预约操作 |
| pages/course-detail/course-detail | 课程详情 | 课程信息、预约/取消、候补 |
| pages/profile/profile | 个人中心 | 用户信息、预约记录、套餐、设置 |
| pages/records/records | 预约记录 | 历史预约、上课记录 |
| pages/coach-detail/coach-detail | 教练详情 | 教练信息、课程、视频 |
| pages/coach-list/coach-list | 教练列表 | 全部教练 |
| pages/video-player/video-player | 视频播放 | 教练作品视频播放 |
| pages/package-detail/package-detail | 套餐详情 | 套餐信息、激活 |
| pages/member-info/member-info | 会员信息 | 会员资料查看 |
| pages/privacy/privacy | 隐私政策 | 隐私保护指引文本 |
| pages/agreement/agreement | 用户协议 | 用户服务协议文本 |
| pages/about/about | 关于我们 | 门店信息 |
| pages/subscribe-settings/subscribe-settings | 订阅设置 | 消息订阅管理 |

### 4.3 全局数据 (app.js globalData)

```javascript
{
  userInfo: null,          // 用户信息对象
  userInfoLastFetch: 0,    // 上次获取用户信息时间戳
  token: '',               // JWT认证令牌
  currentStore: null,      // 当前选中的门店
  storeList: [],           // 门店列表
  baseUrl: '',             // API基础URL
  defaultStoreSet: false,  // 是否已设置默认门店
  pendingLocationAuth: false, // 是否等待位置授权
  privacyResolve: null     // 隐私授权回调
}
```

### 4.4 核心启动流程

```
App.onLaunch()
  ├── silenceUnsupportedApi()    // 静默不支持的API
  ├── registerPrivacyHandler()   // 注册隐私协议处理
  ├── fetchTemplates()           // 获取订阅消息模板
  ├── 读取本地token
  │   ├── 有token → getUserInfo()
  │   └── 无token → 跳过
  └── getStoreList()             // 获取门店列表
      └── determineDefaultStore() // 决定默认门店
          ├── 有套餐 → 匹配套餐门店
          ├── 有授权 → 获取最近门店
          └── 无授权 → 使用第一个门店
```

### 4.5 页面详情

#### 4.5.1 首页 (pages/index/index)

**功能**: 展示轮播图、今日课程、推荐教练、热门视频

**数据字段**:
```javascript
{
  banners: [],           // 轮播图列表
  todaySchedules: [],    // 今日课程列表
  coaches: [],           // 推荐教练
  videos: [],            // 推荐视频
  currentStore: null,    // 当前门店
  loading: true,         // 加载状态
  userInfo: null         // 用户信息
}
```

**API调用**:
- `GET /home/banners` - 获取首页轮播图
- `GET /home/coaches` - 获取首页教练
- `GET /home/videos` - 获取首页视频
- `GET /schedules` - 获取今日课程

#### 4.5.2 预约页 (pages/booking/booking)

**功能**: 日历查看课程、预约/取消预约、候补操作

**数据字段**:
```javascript
{
  selectedDate: '',      // 选中日期
  schedules: [],         // 当日课程列表
  myPackages: [],        // 我的套餐
  myBookings: [],        // 我的预约
  loading: true,
  refreshing: false
}
```

**API调用**:
- `GET /schedules?date=xxx` - 获取指定日期课程
- `POST /bookings` - 创建预约
- `PUT /bookings/:id/cancel` - 取消预约
- `POST /bookings/waitlist` - 加入候补
- `GET /packages/my` - 获取我的套餐
- `GET /bookings/my` - 获取我的预约

**业务流程**:
1. 用户选择日期 → 加载当日课程列表
2. 点击课程 → 判断是否有可用套餐
3. 有套餐 → 判断课程是否满员
   - 未满 → 直接预约
   - 已满 → 提示是否加入候补
4. 无套餐 → 提示联系门店购买

#### 4.5.3 课程详情页 (pages/course-detail/course-detail)

**数据字段**:
```javascript
{
  schedule: {},          // 课程详情
  myBookings: [],        // 我的预约
  isBooked: false,       // 是否已预约
  canCancel: false,      // 是否可取消
  userPackages: [],      // 可用套餐
  waitlistCount: 0,      // 候补人数
  showWaitlist: false    // 是否显示候补
}
```

#### 4.5.4 个人中心 (pages/profile/profile)

**功能**: 用户信息展示、预约记录入口、套餐信息、门店切换、设置入口

**菜单项**:
- 我的预约 → pages/records/records
- 我的套餐 → pages/package-detail/package-detail
- 会员信息 → pages/member-info/member-info
- 订阅设置 → pages/subscribe-settings/subscribe-settings
- 关于我们 → pages/about/about
- 隐私政策 → pages/privacy/privacy
- 用户协议 → pages/agreement/agreement
- 退出登录

#### 4.5.5 会员信息页 (pages/member-info/member-info)

**功能**: 查看会员资料、修改手机号

**数据字段**:
```javascript
{
  userInfo: {},           // 用户信息
  memberCode: '',         // 会员编码
  storeName: '',          // 门店名称
  phoneAuditStatus: '',   // 手机审核状态
  newPhone: ''            // 新手机号
}
```

#### 4.5.6 订阅设置页 (pages/subscribe-settings/subscribe-settings)

**功能**: 管理订阅消息模板

**数据字段**:
```javascript
{
  templates: [],          // 可用模板列表
  subscribedTemplates: [], // 已订阅模板
  templateIds: []         // 模板ID列表
}
```

**API调用**:
- `GET /config/template-mappings` - 获取模板映射

### 4.6 组件

| 组件路径 | 名称 | 功能 |
|----------|------|------|
| components/login-modal/ | 登录弹窗 | 手机号授权登录，隐私政策勾选 |
| components/tab-bar/ | 自定义TabBar | 底部导航栏 |
| components/coach-card/ | 教练卡片 | 教练信息卡片展示 |
| components/course-card/ | 课程卡片 | 课程信息卡片展示 |

### 4.7 工具函数

#### utils/request.js
- 封装 `wx.request`
- 自动拼接 `baseUrl`
- 自动携带 `Authorization: Bearer <token>`
- 统一错误处理（401跳转登录）
- 超时设置

#### utils/api.js
- 按模块分组封装所有API调用
- 模块: auth, home, stores, members, packages, schedules, bookings, coaches, videos, danceStyles, attendance

#### utils/subscribe-message.js
- `fetchTemplates()` - 获取订阅消息模板
- `requestSubscribe()` - 请求订阅授权
- 模板ID配置管理

---

## 5. 管理端小程序 (wuqi-admin)

### 5.1 全局配置 (app.json)

| 配置项 | 值 |
|--------|-----|
| 小程序名称 | 舞栖预约管理系统 |
| 导航栏背景色 | #F6F3F0 |
| 导航栏文字色 | black |
| 页面背景色 | #FAF8F5 |
| TabBar | 自定义(custom: true) |
| TabBar项 | 首页、运营、会员、店务、我的 |

### 5.2 页面列表

| 路径 | 页面名称 | 功能描述 |
|------|----------|----------|
| pages/splash/splash | 启动页 | 自动跳转 |
| pages/login/login | 登录页 | 账号密码登录 |
| pages/dashboard/dashboard | 首页仪表盘 | 数据概览、快捷入口 |
| pages/operations/operations | 运营页 | 综合运营管理 |
| pages/schedule/schedule | 排课管理 | 创建/编辑/删除排课 |
| pages/members/members | 会员管理 | 会员列表、搜索、筛选 |
| pages/members/member-detail/ | 会员详情 | 会员完整信息、套餐管理 |
| pages/members/booking-list/ | 会员预约列表 | 某会员的预约记录 |
| pages/members/member-review/ | 会员审核 | 审核新注册会员 |
| pages/members/phone-review/ | 电话审核 | 审核手机号修改请求 |
| pages/members/info-review/ | 信息审核 | 审核信息修改请求 |
| pages/shop/shop | 店务管理 | 功能入口分组列表 |
| pages/shop/store-maintenance/ | 门店维护 | 新增/编辑门店 |
| pages/bookings/bookings | 预约管理 | 查看/管理所有预约 |
| pages/check-in/check-in | 签到管理 | 扫码签到、手动签到 |
| pages/salary/salary | 薪资管理 | 教练薪酬配置与统计 |
| pages/waitlist/waitlist | 等待列表 | 候补名单管理 |
| pages/transfers/transfers | 转课管理 | 会员转课操作 |
| pages/package-logs/package-logs | 套餐日志 | 套餐激活/使用记录 |
| pages/videos/videos | 教练作品 | 视频上传/管理 |
| pages/banner/banner | 轮播图管理 | 首页轮播图配置 |
| pages/coaches/coaches | 教练管理 | 教练CRUD |
| pages/holidays/holidays | 假期管理 | 放假日期设置 |
| pages/announcements/announcements | 公告管理 | 公告发布 |
| pages/course-records/course-records | 课程记录 | 上课记录查看 |
| pages/booking-summary/booking-summary | 预约汇总 | 预约数据统计 |
| pages/settings/settings | 系统设置 | 设置入口 |
| pages/settings/roles/ | 角色管理 | 角色权限配置 |
| pages/settings/accounts/ | 账号管理 | 管理账号CRUD |
| pages/settings/config/ | 配置管理 | 系统参数配置 |
| pages/settings/exemption/ | 豁免管理 | 豁免次数设置 |
| pages/settings/template-edit/ | 模板编辑 | 订阅消息模板编辑 |
| pages/logs/logs | 操作日志 | 系统操作日志 |
| pages/profile/profile | 个人中心 | 管理员信息、退出 |
| pages/profile/account-security/ | 账户安全 | 修改密码 |
| pages/system-reset/system-reset | 系统重置 | 数据重置 |
| pages/todo-list/todo-list | 待办事项 | 待处理任务 |
| pages/privacy/privacy | 隐私政策 | 隐私文本 |
| pages/agreement/agreement | 用户协议 | 协议文本 |
| pages/about/about | 关于我们 | 版本信息 |

### 5.3 全局数据 (app.js globalData)

```javascript
{
  userInfo: null,          // 管理员信息
  token: '',               // JWT令牌
  currentStore: null,      // 当前门店
  currentStoreId: '',      // 当前门店ID
  storeList: [],           // 门店列表
  baseUrl: '',             // API基础URL
  serverBase: '',          // 服务器基础URL
  privacyResolve: null,    // 隐私授权回调
  deviceFingerprint: ''    // 设备指纹
}
```

### 5.4 权限系统

角色定义：
- `super_admin` - 超级管理员（所有权限）
- `store_manager` - 门店管理员
- `staff` - 普通员工

权限控制：
```javascript
hasPermission(moduleId) {
  // super_admin 拥有所有权限
  // 通配符 '*' 拥有所有权限
  // 否则检查 permissions 数组
}
```

### 5.5 设计系统

全局样式变量（app.wxss）定义了"素练流影"设计系统：

| 类别 | 变量 | 值 |
|------|------|-----|
| 主色 | --color-primary | #C5744B |
| 主色hover | --color-primary-hover | #B0653E |
| 主色背景 | --color-primary-bg | #F5EBE3 |
| 成功色 | --color-success | #5B8C5A |
| 警告色 | --color-warning | #C4663E |
| 危险色 | --color-danger | #C44B4B |
| 文本主色 | --text-primary | #2C2416 |
| 文本次级 | --text-secondary | #8B7E6A |
| 文本三级 | --text-tertiary | #B8AF9E |
| 背景色 | --bg-root | #F6F3F0 |
| 卡片背景 | --bg-card | #FFFFFF |
| 边框色 | --border | #E8E2D8 |
| 小圆角 | --radius-sm | 8rpx |
| 中圆角 | --radius-md | 12rpx |
| 大圆角 | --radius-lg | 16rpx |
| 超大圆角 | --radius-xl | 24rpx |

---

## 6. 数据库模型

### 6.1 User (用户/管理员/会员)

集合名: `users`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| openid | String | 否 | - | 微信OpenID，唯一，稀疏索引 |
| unionid | String | 否 | - | 微信UnionID |
| nick_name | String | 否 | - | 微信昵称 |
| avatar_url | String | 否 | - | 头像URL |
| phone | String | 否 | - | 手机号 |
| wechat_phone | String | 否 | - | 微信绑定手机号 |
| reserve_phone | String | 否 | - | 备用手机号 |
| user_type | String | 是 | 'member' | 用户类型: member/admin/staff |
| member_status | String | 是 | 'registered' | 会员状态: guest/registered/official |
| gender | Number | 否 | 0 | 性别 |
| real_name | String | 否 | - | 真实姓名 |
| store_id | ObjectId | 否 | - | 所属门店 |
| store_ids | [ObjectId] | 否 | - | 管理多门店 |
| role | String | 否 | - | 管理角色: super_admin/store_manager/staff |
| permissions | [String] | 否 | [] | 权限列表 |
| username | String | 否 | - | 管理端用户名，唯一 |
| password | String | 否 | - | 管理端密码(bcrypt) |
| status | String | 是 | 'active' | 账号状态: active/disabled |
| exemption_count | Number | 否 | 3 | 豁免次数 |
| member_code | String | 否 | - | 会员编码，唯一 |
| info_completed | Boolean | 否 | false | 信息是否完整 |
| phone_audit_status | String | 否 | 'pending' | 手机审核状态 |
| phone_audit_pending | String | 否 | - | 待审核手机号 |
| phone_audit_requested_at | Date | 否 | - | 申请时间 |
| info_change_request | Object | 否 | - | 信息修改请求 |
| last_inactive_reminded_at | Date | 否 | - | 最后不活跃提醒时间 |

### 6.2 Coach (教练)

集合名: `coaches`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | String | 是 | - | 教练姓名 |
| avatar_url | String | 否 | - | 头像URL |
| gender | Number | 否 | 0 | 性别 |
| phone | String | 否 | - | 手机号 |
| introduction | String | 否 | - | 简介 |
| dance_styles | [ObjectId] | 否 | - | 擅长舞种，引用DanceStyle |
| gallery | [String] | 否 | - | 相册，最多9张 |
| status | String | 是 | 'active' | active/disabled |
| sort_order | Number | 否 | 0 | 排序 |
| show_on_home | Boolean | 否 | true | 是否在首页展示 |

### 6.3 Schedule (排课)

集合名: `schedules`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| coach_id | ObjectId | 是 | - | 教练 |
| dance_style_id | ObjectId | 是 | - | 舞种 |
| store_id | ObjectId | 是 | - | 门店 |
| date | String | 是 | - | 日期 YYYY-MM-DD |
| start_time | String | 是 | - | 开始时间 HH:mm |
| end_time | String | 是 | - | 结束时间 HH:mm |
| max_bookings | Number | 否 | 20 | 最大预约数 |
| min_bookings | Number | 否 | 5 | 最低开课人数 |
| current_bookings | Number | 否 | 0 | 当前预约数 |
| status | String | 是 | 'available' | available/full/cancelled/offline/not_open/completed |
| cancel_reason | String | 否 | - | 取消原因 |
| schedule_type | String | 否 | 'group' | group/private/trial |
| course_name | String | 否 | - | 课程名称 |
| classroom | String | 否 | - | 教室 |
| duration | Number | 否 | 75 | 时长(分钟) |
| booking_deadline | Number | 否 | 120 | 预约截止(分钟) |
| cancel_deadline | Number | 否 | 60 | 取消截止(分钟) |
| credits_cost | Number | 否 | 1 | 消耗课时 |
| from_template | Boolean | 否 | false | 是否来自模板 |
| cover | String | 否 | - | 封面图 |
| created_by | ObjectId | 否 | - | 创建人 |

### 6.4 Booking (预约)

集合名: `bookings`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| user_id | ObjectId | 是 | - | 会员 |
| schedule_id | ObjectId | 是 | - | 排课 |
| coach_id | ObjectId | 是 | - | 教练 |
| dance_style_id | ObjectId | 是 | - | 舞种 |
| store_id | ObjectId | 是 | - | 门店 |
| booking_date | String | 是 | - | 预约日期 |
| booking_time | String | 是 | - | 预约时间 |
| status | String | 是 | 'booked' | booked/cancelled/completed/absent |
| cancel_reason | String | 否 | - | 取消原因 |
| cancel_type | String | 否 | - | normal/timeout/exempt/admin_cancel/min_bookings_not_met/holiday |
| cancel_time | Date | 否 | - | 取消时间 |
| is_exempt | Boolean | 否 | false | 是否豁免 |
| credits_deducted | Number | 否 | 1 | 扣除课时 |
| credits_refunded | Number | 否 | 0 | 退还课时 |
| exemption_used | Boolean | 否 | false | 是否使用豁免 |
| checked_in | Boolean | 否 | false | 是否签到 |
| check_in_time | Date | 否 | - | 签到时间 |
| checked_in_by | ObjectId | 否 | - | 签到操作人 |
| user_package_id | ObjectId | 否 | - | 关联套餐 |
| source | String | 否 | 'member' | 来源: member/onsite/admin |
| reminder_1h_sent | Boolean | 否 | false | 1小时提醒已发送 |
| reminder_30m_sent | Boolean | 否 | false | 30分钟提醒已发送 |

### 6.5 Package (套餐)

集合名: `packages`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | String | 是 | - | 套餐名称 |
| description | String | 否 | - | 描述 |
| class_count | Number | 是 | - | 课时数 |
| price | Number | 是 | - | 价格 |
| original_price | Number | 否 | - | 原价 |
| duration_days | Number | 是 | - | 有效天数 |
| dance_styles | [ObjectId] | 否 | - | 适用舞种 |
| is_popular | Boolean | 否 | false | 是否热门 |
| sort_order | Number | 否 | 0 | 排序 |
| status | String | 是 | 'active' | active/disabled |

### 6.6 Store (门店)

集合名: `stores`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | String | 是 | - | 门店名称 |
| address | String | 否 | - | 地址 |
| phone | String | 否 | - | 电话 |
| description | String | 否 | - | 描述 |
| images | [String] | 否 | - | 门店图片 |
| nav_name | String | 否 | - | 导航名称 |
| location.latitude | Number | 否 | - | 纬度 |
| location.longitude | Number | 否 | - | 经度 |
| business_hours.start | String | 否 | '09:00' | 营业开始 |
| business_hours.end | String | 否 | '22:00' | 营业结束 |
| status | String | 是 | 'active' | active/disabled |

### 6.7 Video (视频/教练作品)

集合名: `videos`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| title | String | 是 | - | 标题 |
| description | String | 否 | - | 描述 |
| cover_url | String | 否 | - | 封面图 |
| video_url | String | 是 | - | 视频URL |
| duration | Number | 否 | - | 时长(秒) |
| dance_style_id | ObjectId | 否 | - | 舞种 |
| coach_id | ObjectId | 否 | - | 关联教练 |
| is_free | Boolean | 否 | true | 是否免费 |
| sort_order | Number | 否 | 0 | 排序 |
| view_count | Number | 否 | 0 | 播放量 |
| like_count | Number | 否 | 0 | 点赞数 |
| status | String | 是 | 'active' | active/disabled |

### 6.8 Banner (轮播图)

集合名: `banners`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| title | String | 是 | - | 标题 |
| image_url | String | 是 | - | 图片URL |
| link_type | String | 否 | 'none' | none/page/url/mini_program |
| link_value | String | 否 | - | 链接值 |
| sort_order | Number | 否 | 0 | 排序 |
| start_date | String | 否 | - | 开始日期 |
| end_date | String | 否 | - | 结束日期 |
| status | String | 是 | 'active' | active/disabled |

### 6.9 Holiday (假期)

集合名: `holidays`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | String | 是 | - | 名称 |
| date | String | 是 | - | 日期 |
| end_date | String | 否 | - | 结束日期 |
| is_recurring | Boolean | 否 | false | 是否每年重复 |
| type | String | 否 | 'holiday' | holiday/maintenance/custom |
| description | String | 否 | - | 描述 |
| status | String | 是 | 'active' | active/disabled/cancelled |
| store_scope | String | 否 | 'all' | all/single |
| store_id | ObjectId | 否 | - | 指定门店 |

### 6.10 DanceStyle (舞种)

集合名: `dancestyles`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | String | 是 | - | 舞种名称，唯一 |
| description | String | 否 | - | 描述 |
| icon_url | String | 否 | - | 图标URL |
| cover_url | String | 否 | - | 封面图 |
| sort_order | Number | 否 | 0 | 排序 |
| status | String | 是 | 'active' | active/disabled |

### 6.11 Announcement (公告)

集合名: `announcements`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| title | String | 是 | - | 标题 |
| content | String | 是 | - | 内容 |
| store_id | ObjectId | 否 | null | 指定门店 |
| status | String | 否 | 'active' | active/inactive |
| created_at | Date | 否 | 当前时间 | 创建时间 |
| updated_at | Date | 否 | 当前时间 | 更新时间 |

---

## 7. API接口文档

### 7.1 认证模块 (/api/v1/auth)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /auth/wx-login | 否 | 会员端微信登录 |
| POST | /auth/admin-login | 否 | 管理端账号密码登录 |
| GET | /auth/me | 是 | 获取当前用户信息 |
| PUT | /auth/me | 是 | 更新当前用户信息 |
| PUT | /auth/password | 是 | 修改密码 |

**会员端微信登录 (POST /auth/wx-login)**
```json
// 请求体
{ "code": "微信登录code" }
// 响应
{ "code": 200, "data": { "token": "jwt_token", "user": {...} } }
```

**管理端登录 (POST /auth/admin-login)**
```json
// 请求体
{ "username": "admin", "password": "password" }
// 响应
{ "code": 200, "data": { "token": "jwt_token", "user": {...} } }
```

### 7.2 排课模块 (/api/v1/schedules)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /schedules | 否 | 获取排课列表（支持date/coach_id/store_id/dance_style_id筛选） |
| GET | /schedules/:id | 否 | 排课详情 |
| POST | /schedules | 是 | 创建排课 |
| PUT | /schedules/:id | 是 | 编辑排课 |
| DELETE | /schedules/:id | 是 | 删除排课 |
| POST | /schedules/batch | 是 | 批量创建排课 |
| DELETE | /schedules/batch | 是 | 批量删除排课 |
| PUT | /schedules/:id/cancel | 是 | 取消排课 |
| GET | /schedules/:id/attendees | 是 | 获取预约名单 |
| PUT | /schedules/:id/mark-completed | 是 | 标记上课完成 |

### 7.3 预约模块 (/api/v1/bookings)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /bookings | 是 | 创建预约 |
| GET | /bookings | 是 | 获取预约列表 |
| GET | /bookings/:id | 是 | 预约详情 |
| GET | /bookings/my | 是 | 我的预约记录 |
| GET | /bookings/my-attendance | 是 | 我的出勤记录 |
| PUT | /bookings/:id/cancel | 是 | 取消预约 |
| PUT | /bookings/:id/admin-cancel | 是 | 管理员取消预约 |
| POST | /bookings/check-in | 是 | 扫码签到 |
| POST | /bookings/batch-check-in | 是 | 批量签到 |
| GET | /bookings/check-in-records/:id | 是 | 签到记录 |
| POST | /bookings/check-low-attendance | 是 | 检查低人数课程 |
| POST | /bookings/waitlist | 是 | 加入候补 |
| GET | /bookings/waitlist/my | 是 | 我的候补 |
| DELETE | /bookings/waitlist/:id | 是 | 取消候补 |
| PUT | /bookings/waitlist/confirm/:id | 是 | 候补确认预约 |

**创建预约 (POST /bookings)**
```json
// 请求体
{ "schedule_id": "排课ID", "user_package_id": "套餐ID(可选)" }
// 响应
{ "code": 200, "data": { "booking": {...} } }
```

### 7.4 会员模块 (/api/v1/members)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /members | 是 | 获取会员列表 |
| GET | /members/:id | 是 | 会员详情 |
| PUT | /members/:id | 是 | 更新会员信息 |
| PUT | /members/:id/review | 是 | 审核会员 |
| PUT | /members/:id/assign-code | 是 | 分配会员编码 |
| PUT | /members/:id/exemption | 是 | 设置豁免次数 |
| PUT | /members/:id/suspend | 是 | 停卡 |
| PUT | /members/:id/unsuspend | 是 | 复卡 |
| GET | /members/stats/overview | 是 | 会员统计 |
| GET | /members/phone-audit/list | 是 | 手机审核列表 |
| PUT | /members/:id/phone-audit | 是 | 审核手机号 |
| PUT | /members/:id/info-review | 是 | 审核信息修改 |

### 7.5 套餐模块 (/api/v1/packages)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /packages | 否 | 套餐列表 |
| GET | /packages/:id | 否 | 套餐详情 |
| POST | /packages | 是 | 创建套餐 |
| PUT | /packages/:id | 是 | 更新套餐 |
| DELETE | /packages/:id | 是 | 删除套餐 |
| GET | /packages/my | 是 | 我的套餐 |
| PUT | /packages/activate | 是 | 激活套餐 |
| DELETE | /packages/user/:id | 是 | 删除用户套餐 |
| GET | /packages/activation-records | 是 | 激活记录 |
| PUT | /packages/:id/extend | 是 | 套餐延长 |
| PUT | /packages/extension-records/:id/revoke | 是 | 撤销延长 |
| PUT | /packages/refresh-status | 是 | 刷新套餐状态 |

### 7.6 教练模块 (/api/v1/coaches)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /coaches | 否 | 教练列表 |
| GET | /coaches/:id | 否 | 教练详情 |
| POST | /coaches | 是 | 新增教练 |
| PUT | /coaches/:id | 是 | 编辑教练 |
| DELETE | /coaches/:id | 是 | 删除教练 |

### 7.7 门店模块 (/api/v1/stores)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /stores | 否 | 门店列表 |
| GET | /stores/:id | 否 | 门店详情 |
| GET | /stores/nearest | 否 | 最近门店 |
| POST | /stores | 是 | 新增门店 |
| PUT | /stores/:id | 是 | 编辑门店 |
| DELETE | /stores/:id | 是 | 删除门店 |

### 7.8 视频模块 (/api/v1/videos)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /videos | 否 | 视频列表 |
| GET | /videos/:id | 否 | 视频详情 |
| POST | /videos | 是 | 新增视频 |
| PUT | /videos/:id | 是 | 编辑视频 |
| DELETE | /videos/:id | 是 | 删除视频 |

### 7.9 轮播图模块 (/api/v1/banners)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /banners | 否 | 轮播图列表 |
| GET | /banners/:id | 否 | 轮播图详情 |
| POST | /banners | 是 | 新增轮播图 |
| PUT | /banners/:id | 是 | 编辑轮播图 |
| DELETE | /banners/:id | 是 | 删除轮播图 |

### 7.10 假期模块 (/api/v1/holidays)

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /holidays | 否 | 假期列表 |
| GET | /holidays/:id | 否 | 假期详情 |
| POST | /holidays | 是 | 新增假期 |
| PUT | /holidays/:id | 是 | 编辑假期 |
| DELETE | /holidays/:id | 是 | 删除假期 |
| PUT | /holidays/:id/cancel | 是 | 撤销假期 |

### 7.11 其他模块

| 模块 | 路径前缀 | 说明 |
|------|----------|------|
| 舞种 | /api/v1/dance-styles | 舞种CRUD |
| 公告 | /api/v1/announces | 公告CRUD |
| 配置 | /api/v1/config | 系统配置管理 |
| 账号 | /api/v1/accounts | 管理账号管理 |
| 日志 | /api/v1/logs | 操作日志查询 |
| 上传 | /api/v1/upload | 文件上传 |
| 统计 | /api/v1/stats | 数据统计 |
| 首页 | /api/v1/home | 首页聚合数据 |
| 周模板 | /api/v1/week-template | 周排课模板 |
| 二维码 | /api/v1/qrcode | 签到二维码 |
| 系统 | /api/v1/system | 系统重置 |
| 出勤 | /api/v1/attendance | 出勤记录 |
| 转课 | /api/v1/transfers | 转课管理 |
| 薪酬 | /api/v1/coach-salaries | 教练薪酬 |
| 模板映射 | /api/v1/template-mappings | 订阅消息模板 |

---

## 8. 数据流与业务交互

### 8.1 两个小程序的关系

```
┌──────────────────────────────────────────────────────────────┐
│                        管理端 (Admin)                         │
│                                                              │
│  1. 创建排课 → 写入 schedules 集合                            │
│  2. 管理会员 → 写入 users 集合                                │
│  3. 激活套餐 → 写入 userPackages 集合                         │
│  4. 签到管理 → 更新 bookings 集合                             │
│  5. 发布公告 → 写入 announcements 集合                        │
│  6. 上传视频 → 写入 videos 集合                               │
│  7. 配置轮播图 → 写入 banners 集合                            │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │  共享 MongoDB 数据库
                       │
┌──────────────────────┴───────────────────────────────────────┐
│                        会员端 (Member)                         │
│                                                              │
│  1. 浏览课程 → 读取 schedules 集合                            │
│  2. 预约课程 → 写入 bookings 集合                             │
│  3. 查看记录 → 读取 bookings 集合                             │
│  4. 查看套餐 → 读取 userPackages 集合                         │
│  5. 浏览视频 → 读取 videos 集合                               │
│  6. 查看公告 → 读取 announcements 集合                        │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 核心数据流

#### 预约流程数据流
```
会员端                        后端                        MongoDB
  │                            │                            │
  ├─ GET /schedules?date=xxx ──→├── Schedule.find() ──────→│
  │←── 课程列表 ───────────────┤←── 数据 ──────────────────┤
  │                            │                            │
  ├─ POST /bookings ──────────→│                            │
  │  {schedule_id, ...}        ├── 检查套餐是否有效 ────────→│
  │                            ├── 检查是否已预约 ──────────→│
  │                            ├── 检查课程是否满员 ────────→│
  │                            ├── Booking.create() ───────→│
  │                            ├── Schedule.updateOne() ───→│
  │                            │   { $inc: {current_bookings:1} }
  │←── 预约成功 ───────────────┤                            │
```

#### 签到流程数据流
```
管理端                        后端                        MongoDB
  │                            │                            │
  ├─ 扫描会员二维码             │                            │
  ├─ POST /bookings/check-in ─→│                            │
  │  {user_id, schedule_id}    ├── 查找预约记录 ───────────→│
  │                            ├── Booking.updateOne() ────→│
  │                            │   {checked_in: true,       │
  │                            │    check_in_time: now}     │
  │←── 签到成功 ───────────────┤                            │
```

### 8.3 定时任务

后端使用 node-cron 实现定时任务：

| 任务 | 说明 |
|------|------|
| 订阅消息推送 | 课程开始前1小时/30分钟发送提醒 |
| 排课状态更新 | 自动将过期课程标记为已完成 |
| 低人数检查 | 课程开始前检查是否达到最低开课人数 |
| 套餐状态刷新 | 定时刷新套餐有效期状态 |
| 不活跃提醒 | 提醒长期未上课的会员 |

---

## 9. 核心业务流程

### 9.1 会员端预约流程

```
1. 用户打开小程序 → 微信授权登录 → 获取token
2. 选择门店 → 首页展示Today课程
3. 点击"预约"Tab → 查看日历 → 选择日期
4. 看到课程列表 → 点击课程
5. 进入课程详情页
   ├── 未登录 → 弹出登录弹窗 → 手机号授权
   ├── 无套餐 → 提示联系门店
   ├── 已满员 → 提示加入候补
   └── 可预约 → 确认预约 → 预约成功
6. 收到订阅消息提醒 → 前往上课
7. 到店签到 → 完成课程
```

### 9.2 管理端运营流程

```
1. 管理员登录 → 进入首页仪表盘
2. 排课管理
   ├── 创建排课（选择教练、舞种、时间、门店）
   ├── 使用周模板批量创建
   └── 编辑/取消/删除排课
3. 会员管理
   ├── 查看会员列表
   ├── 审核新注册会员
   ├── 激活套餐
   ├── 审核手机号/信息修改
   └── 停卡/复卡
4. 签到管理
   ├── 扫码签到
   └── 批量签到
5. 教练管理
   ├── 新增/编辑教练
   └── 薪酬配置与统计
6. 内容管理
   ├── 轮播图管理
   ├── 教练作品上传
   └── 公告发布
```

### 9.3 套餐管理流程

```
1. 管理端创建套餐模板（名称、课时、价格、有效期）
2. 会员到店购买套餐 → 管理端激活套餐
3. 系统记录激活时间、到期时间
4. 会员预约消耗课时
5. 套餐到期后自动失效
6. 支持套餐延长、撤销延长
```

### 9.4 候补流程

```
1. 课程已满员 → 会员选择加入候补
2. 有人取消预约 → 系统按候补顺序通知
3. 候补会员确认预约 → 转正
4. 超时未确认 → 自动取消候补，通知下一人
```

---

## 10. 部署指南

### 10.1 服务器环境要求

| 项目 | 详情 |
|------|------|
| 云服务商 | 腾讯云轻量应用服务器 |
| 公网IP | `101.33.203.22` |
| 操作系统 | Ubuntu |
| Node.js | >= 18.x |
| MongoDB | >= 6.x |
| Nginx | 最新稳定版 |
| PM2 | 最新版 |
| FFmpeg | 系统级安装（用于视频压缩） |

### 10.2 服务器上部署后端

1. **进入项目目录**
```bash
cd /home/ubuntu/wuqi-dance-system/backend/
```

2. **安装依赖**
```bash
npm install
```

3. **安装系统依赖（Ubuntu）**
```bash
# FFmpeg（视频压缩）
sudo apt update
sudo apt install -y ffmpeg

# PM2（进程守护）
sudo npm install -g pm2
```

4. **配置环境变量 (.env)**
```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://localhost:27017/wuqi_dance
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d
WX_MEMBER_APPID=wxeb3b664ce36208ba
WX_MEMBER_SECRET=会员端小程序Secret
WX_ADMIN_APPID=wx3f52761ae85bd5e7
WX_ADMIN_SECRET=管理端小程序Secret
COS_SECRET_ID=腾讯云COS密钥ID
COS_SECRET_KEY=腾讯云COS密钥Key
COS_BUCKET=存储桶名称
COS_REGION=ap-guangzhou
```

5. **初始化种子数据**
```bash
npm run seed          # 初始化基础数据
npm run seed:stores   # 初始化门店
npm run seed:dance    # 初始化舞种
npm run seed:packages # 初始化套餐
npm run seed:coaches  # 初始化教练
npm run seed:banners  # 初始化轮播图
```

6. **启动服务（使用PM2）**
```bash
pm2 start server.js --name wuqi-backend
pm2 save
pm2 startup    # 设置开机自启
```

7. **配置Nginx反向代理（两个域名 → 同一个后端）**

Nginx 配置文件路径：`/etc/nginx/sites-available/wuqi-dance`

```nginx
# =====================================================
# 会员端 API 域名
# =====================================================
server {
    listen 443 ssl http2;
    server_name api.yuekeme.cn;

    ssl_certificate /etc/nginx/ssl/api.yuekeme.cn.pem;
    ssl_certificate_key /etc/nginx/ssl/api.yuekeme.cn.key;

    # 上传文件大小限制（视频文件较大）
    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
    }

    location /uploads/ {
        alias /home/ubuntu/wuqi-dance-system/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}

# =====================================================
# 管理端 API 域名
# =====================================================
server {
    listen 443 ssl http2;
    server_name admin-api.yuekeme.cn;

    ssl_certificate /etc/nginx/ssl/admin-api.yuekeme.cn.pem;
    ssl_certificate_key /etc/nginx/ssl/admin-api.yuekeme.cn.key;

    # 上传文件大小限制（视频文件较大）
    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
    }

    location /uploads/ {
        alias /home/ubuntu/wuqi-dance-system/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}

# HTTP 自动跳转 HTTPS
server {
    listen 80;
    server_name api.yuekeme.cn admin-api.yuekeme.cn;
    return 301 https://$host$request_uri;
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/wuqi-dance /etc/nginx/sites-enabled/
sudo nginx -t && sudo nginx -s reload
```

### 10.3 小程序部署步骤

1. **下载微信开发者工具**
   - 访问 https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

2. **导入项目**
   - 会员端：导入 `wuqi-member` 目录
   - 管理端：导入 `wuqi-admin` 目录

3. **配置API地址**
   - 修改 `config/index.js` 中的 `baseUrl` 为你的后端API地址

4. **配置合法域名（两个小程序分别配置）**

   登录 [微信公众平台](https://mp.weixin.qq.com) → 开发 → 开发设置 → 服务器域名

   **会员端 (wxeb3b664ce36208ba) 配置：**
   | 配置项 | 值 |
   |--------|-----|
   | request合法域名 | `https://api.yuekeme.cn` |
   | downloadFile合法域名 | `https://api.yuekeme.cn` |
   | uploadFile合法域名 | `https://api.yuekeme.cn` |

   **管理端 (wx3f52761ae85bd5e7) 配置：**
   | 配置项 | 值 |
   |--------|-----|
   | request合法域名 | `https://admin-api.yuekeme.cn` |
   | downloadFile合法域名 | `https://admin-api.yuekeme.cn` |
   | uploadFile合法域名 | `https://admin-api.yuekeme.cn` |

5. **配置订阅消息模板**
   - 登录微信公众平台 → 功能 → 订阅消息
   - 添加模板：课程预约成功提醒、取消预约通知、上课提醒等

6. **上传代码**
   - 微信开发者工具 → 上传 → 填写版本号 → 提交审核

### 10.4 数据库备份

```bash
# MongoDB 备份
mongodump --db wuqi_dance --out /backup/$(date +%Y%m%d)

# MongoDB 恢复
mongorestore --db wuqi_dance /backup/20260613/
```

---

## 附录

### A. 文件路径对照表

| 功能 | 会员端文件 | 管理端文件 | 后端文件 |
|------|-----------|-----------|---------|
| 首页 | pages/index/ | pages/dashboard/ | src/controllers/home.controller.js |
| 预约 | pages/booking/ | pages/bookings/ | src/controllers/booking.controller.js |
| 排课 | - | pages/schedule/ | src/controllers/schedule.controller.js |
| 会员 | pages/profile/ | pages/members/ | src/controllers/member.controller.js |
| 套餐 | pages/package-detail/ | - | src/controllers/package.controller.js |
| 教练 | pages/coach-list/ | pages/coaches/ | src/controllers/coach.controller.js |
| 视频 | pages/video-player/ | pages/videos/ | src/controllers/video.controller.js |
| 签到 | - | pages/check-in/ | src/controllers/booking.controller.js |
| 薪资 | - | pages/salary/ | src/controllers/coach-salary.controller.js |
| 门店 | - | pages/shop/ | src/controllers/store.controller.js |
| 轮播图 | - | pages/banner/ | src/controllers/banner.controller.js |
| 假期 | - | pages/holidays/ | src/controllers/holiday.controller.js |
| 公告 | - | pages/announcements/ | src/controllers/announcement.controller.js |
| 隐私政策 | pages/privacy/ | pages/privacy/ | - |
| 用户协议 | pages/agreement/ | pages/agreement/ | - |

### B. 环境变量完整列表

| 变量名 | 必填 | 说明 |
|--------|------|------|
| NODE_ENV | 否 | 环境: development/production |
| PORT | 否 | 服务端口，默认3000 |
| MONGODB_URI | 是 | MongoDB连接字符串 |
| JWT_SECRET | 是(生产) | JWT密钥 |
| JWT_EXPIRES_IN | 否 | JWT过期时间，默认7d |
| WX_MEMBER_APPID | 是 | 会员端小程序AppID: `wxeb3b664ce36208ba` |
| WX_MEMBER_SECRET | 是 | 会员端小程序Secret |
| WX_ADMIN_APPID | 是 | 管理端小程序AppID: `wx3f52761ae85bd5e7` |
| WX_ADMIN_SECRET | 是 | 管理端小程序Secret |
| COS_SECRET_ID | 否 | 腾讯云COS密钥ID |
| COS_SECRET_KEY | 否 | 腾讯云COS密钥Key |
| COS_BUCKET | 否 | COS存储桶 |
| COS_REGION | 否 | COS区域，默认ap-guangzhou |

---

> 文档版本: v1.1.0  
> 生成日期: 2026年6月13日  
> 项目: 舞栖DANCE 舞蹈社预约管理系统