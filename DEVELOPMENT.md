# 舞栖DANCE 小程序开发说明文档

## 一、项目概述

「舞栖DANCE」是一个舞蹈工作室预约管理系统，包含三个模块：

| 模块 | 说明 | 技术栈 |
|------|------|--------|
| **wuqi-backend** | 后端 API 服务 | Node.js + Express + MongoDB |
| **wuqi-member** | 会员端小程序 | 微信原生小程序 |
| **wuqi-admin** | 管理端小程序 | 微信原生小程序 |

两个小程序共用一个后端和数据库，通过 `client_type` 参数区分端。

---

## 二、服务器信息

| 项目 | 信息 |
|------|------|
| 云服务器 | 腾讯云轻量应用服务器 |
| 公网 IP | 101.33.203.22 |
| 操作系统 | Ubuntu 24.04 LTS |
| 配置 | 4核CPU / 4GB内存 / 40GB SSD / 300GB流量 |
| 地域 | 广州 |
| 域名 | yuekeme.cn（备案中） |
| API 域名（会员端） | https://api.yuekeme.cn |
| API 域名（管理端） | https://admin-api.yuekeme.cn |
| 后端端口 | 3000（单一端口，Nginx 反向代理区分域名） |

---

## 三、微信小程序账号

| 端 | 名称 | AppID | 备案号 |
|----|------|-------|--------|
| 会员端 | 舞栖DANCE | wxeb3b664ce36208ba | 粤ICP备2026067180号-1X |
| 管理端 | 舞栖DANCE预约系统管理 | wx3f52761ae85bd5e7 | 粤ICP备2026067180号-2X |

---

## 四、项目目录结构

### 4.1 本地开发目录

```
项目根目录/
├── wuqi-backend/                # 后端服务
│   ├── server.js                # 入口文件
│   ├── package.json             # 依赖配置
│   ├── .env                     # 环境变量（不入Git，敏感信息）
│   ├── uploads/                 # 上传文件目录
│   ├── src/
│   │   ├── app.js               # Express 应用配置
│   │   ├── config/
│   │   │   ├── index.js         # 全局配置
│   │   │   └── database.js      # MongoDB 连接
│   │   ├── middleware/
│   │   │   ├── auth.js          # JWT 认证中间件
│   │   │   ├── permission.js    # 权限控制中间件
│   │   │   ├── errorHandler.js  # 全局错误处理
│   │   │   └── logger.js        # 请求日志
│   │   ├── models/              # 数据模型（Mongoose Schema）
│   │   ├── routes/              # API 路由
│   │   ├── services/            # 业务逻辑层
│   │   ├── utils/               # 工具函数
│   │   └── seed/                # 种子数据
│   └── logs/                    # 日志目录（不入Git）
│
├── wuqi-member/                 # 会员端小程序
│   ├── app.js                   # 小程序入口
│   ├── app.json                 # 小程序配置
│   ├── project.config.json     # 开发者工具配置
│   ├── config/
│   │   └── index.js            # API地址配置
│   ├── pages/                   # 页面目录
│   ├── components/              # 组件目录
│   └── utils/                   # 工具函数
│
├── wuqi-admin/                  # 管理端小程序
│   ├── app.js                   # 小程序入口
│   ├── app.json                 # 小程序配置
│   ├── project.config.json     # 开发者工具配置
│   ├── config/
│   │   └── index.js            # API地址配置
│   ├── pages/                   # 页面目录
│   ├── components/              # 组件目录
│   └── utils/                   # 工具函数
│
├── deploy.sh                    # 服务器环境部署脚本
├── setup-nginx.sh               # Nginx 双域名配置脚本
├── .env.example                 # 环境变量模板（可入Git，不含真实密钥）
└── .gitignore                   # Git忽略规则
```

### 4.2 服务器部署目录

```
/home/ubuntu/wuqi-dance-system/
├── backend/                     # ← 上传 wuqi-backend 代码
│   ├── server.js
│   ├── .env                     # 手动编辑，含真实密钥
│   ├── uploads/
│   └── src/
├── member/                      # ← 上传 wuqi-member 代码
└── admin/                       # ← 上传 wuqi-admin 代码
```

---

## 五、数据库设计

### 5.1 数据模型一览

| 模型 | 集合名 | 说明 |
|------|--------|------|
| User | users | 用户（会员/管理员/员工） |
| Store | stores | 门店 |
| Coach | coaches | 教练 |
| Schedule | schedules | 排课/课程 |
| Booking | bookings | 预约记录 |
| Waitlist | waitlists | 候补队列 |
| Package | packages | 套餐模板 |
| UserPackage | userpackages | 用户套餐记录 |
| DanceStyle | dancestyles | 舞种 |
| Video | videos | 教学视频 |
| Banner | banners | 首页轮播图 |
| Announcement | announcements | 公告 |
| Holiday | holidays | 放假/休息日 |
| Attendance | attendances | 签到记录 |
| Transfer | transfers | 转让记录 |
| Salary | salaries | 教练薪酬结算 |
| Config | configs | 系统配置 |
| Log | logs | 操作日志 |
| WeekTemplate | weektemplates | 周课表模板 |
| TemplateMapping | templatemappings | 模板映射 |

### 5.2 核心模型字段说明

#### User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| openid | String | 微信openid，唯一 |
| unionid | String | 微信unionid |
| nick_name | String | 昵称 |
| avatar_url | String | 头像URL |
| phone | String | 手机号 |
| wechat_phone | String | 微信绑定手机号 |
| reserve_phone | String | 备用手机号 |
| user_type | enum | member / admin / staff |
| member_status | enum | guest / registered / official |
| gender | Number | 0未知 1男 2女 |
| real_name | String | 真实姓名 |
| store_id | ObjectId | 所属门店 |
| role | enum | super_admin / store_manager / staff |
| permissions | [String] | 权限模块列表 |
| username | String | 管理员登录名 |
| password | String | bcrypt加密密码 |
| status | enum | active / disabled |
| exemption_count | Number | 豁免次数，默认3 |
| member_code | String | 会员编号 |
| phone_audit_status | enum | pending / approved / rejected |
| info_change_request | Object | 信息修改审核 |

#### Booking（预约）

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | ObjectId | 会员ID |
| schedule_id | ObjectId | 课程ID |
| coach_id | ObjectId | 教练ID |
| dance_style_id | ObjectId | 舞种ID |
| store_id | ObjectId | 门店ID |
| booking_date | String | 预约日期 |
| booking_time | String | 预约时间 |
| status | enum | booked / cancelled / completed / absent |
| cancel_reason | String | 取消原因 |
| cancel_type | enum | normal / timeout / exempt / admin_cancel / min_bookings_not_met / holiday |
| credits_deducted | Number | 扣减次数 |
| credits_refunded | Number | 退还次数 |
| exemption_used | Boolean | 是否使用豁免 |
| checked_in | Boolean | 是否已签到 |
| check_in_time | Date | 签到时间 |
| user_package_id | ObjectId | 关联套餐 |
| source | enum | member / onsite / admin |

#### Schedule（排课）

| 字段 | 类型 | 说明 |
|------|------|------|
| store_id | ObjectId | 门店ID |
| coach_id | ObjectId | 教练ID |
| dance_style_id | ObjectId | 舞种ID |
| course_date | String | 上课日期 |
| start_time | String | 开始时间 |
| end_time | String | 结束时间 |
| max_bookings | Number | 最大预约数 |
| status | enum | active / cancelled / completed / removed |
| is_replaced | Boolean | 是否被代课 |

#### Coach（教练）

| 字段 | 类型 | 说明 |
|------|------|------|
| name | String | 姓名 |
| avatar_url | String | 头像 |
| gender | Number | 性别 |
| phone | String | 手机号 |
| introduction | String | 简介 |
| dance_styles | [ObjectId] | 擅长舞种 |
| gallery | [String] | 相册（最多9张） |
| status | enum | active / disabled |

#### UserPackage（用户套餐）

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | ObjectId | 会员ID |
| store_id | ObjectId | 门店ID |
| package_id | ObjectId | 套餐模板ID |
| status | enum | pending / active / expired / cancelled |
| total_sessions | Number | 总次数 |
| used_sessions | Number | 已用次数 |
| remaining_sessions | Number | 剩余次数 |
| start_date | Date | 开始日期 |
| end_date | Date | 到期日期 |
| is_activated | Boolean | 是否已激活 |
| is_suspended | Boolean | 是否暂停 |
| exemption_count | Number | 豁免次数 |
| exemption_used | Number | 已用豁免 |
| auto_activate_at | Date | 自动激活时间 |

### 5.3 数据库索引

各模型均已建立关键查询索引：
- User: openid, user_type+member_status, phone, member_code, username
- Booking: user_id+booking_date, schedule_id, coach_id+booking_date, store_id+booking_date
- Schedule: store_id+course_date, coach_id+course_date, status
- Waitlist: user_id+schedule_id (唯一), schedule_id+status

---

## 六、API 接口

### 6.1 认证相关 (auth)

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | /api/v1/auth/wx-login | 微信登录 | 公开 |
| POST | /api/v1/auth/admin-login | 管理员登录 | 公开 |
| GET | /api/v1/auth/me | 获取当前用户信息 | 需登录 |
| PUT | /api/v1/auth/profile | 更新个人信息 | 需登录 |
| PUT | /api/v1/auth/change-password | 修改密码 | 需登录 |

### 6.2 核心业务接口（共26个路由模块）

| 路由前缀 | 说明 |
|----------|------|
| /schedules | 排课管理 |
| /bookings | 预约管理 |
| /members | 会员管理 |
| /packages | 套餐管理 |
| /coaches | 教练管理 |
| /coach-salaries | 教练薪酬 |
| /stores | 门店管理 |
| /videos | 视频管理 |
| /holidays | 放假管理 |
| /announces | 公告管理 |
| /dance-styles | 舞种管理 |
| /banners | 轮播图管理 |
| /config | 系统配置 |
| /accounts | 账号管理 |
| /logs | 操作日志 |
| /upload | 文件上传 |
| /stats | 数据统计 |
| /home | 首页数据 |
| /week-template | 周课表模板 |
| /qrcode | 二维码 |
| /system | 系统管理 |
| /attendance | 签到管理 |
| /transfers | 转让管理 |
| /template-mappings | 模板映射 |

---

## 七、业务流程

### 7.1 会员预约流程
```
会员登录 → 选择门店 → 浏览课程 → 预约课程 
→ 系统校验（是否放假/名额/套餐剩余次数） 
→ 预约成功 → 上课签到 → 扣减套餐次数
```

### 7.2 候补机制
```
课程满员 → 加入候补 → 有名额释放 → 通知候补会员 
→ 限时确认（15分钟） → 确认成功/超时失效
```

### 7.3 套餐激活
```
管理员录入套餐（pending） → 会员首次预约 → 自动激活 
→ 计算有效期 → 上课消耗次数 → 超2个月未预约 → 自动激活
```

### 7.4 取消预约扣减规则
- 开课前 ≥ 2小时取消：正常取消，退还次数
- 开课前 < 2小时取消：超时取消，不退还次数
- 使用豁免：使用豁免次数取消，不扣次数
- 管理员取消：不扣次数
- 人数不足取消：系统自动取消，退还次数

### 7.5 权限体系

| 角色 | 权限范围 |
|------|----------|
| super_admin | 全部权限（最高管理员） |
| store_manager | 门店管理权限，管理所属门店 |
| staff | 基础操作权限（排课、预约、签到、会员查看） |

**模块权限控制（permission.js MODULE_ROLE_MAP）：**
- schedule/booking/member/checkin/package/waitlist/dashboard: super_admin, store_manager, staff
- coach/video/salary/holiday/banner/account/config/log: super_admin, store_manager
- 还可通过 permissions 数组做细粒度模块权限控制

---

## 八、环境配置

### 8.1 后端 .env 文件

```env
PORT=3000
NODE_ENV=development          # 部署时改为 production
MONGODB_URI=mongodb://localhost:27017/wuqi_dance
JWT_SECRET=wuqi_dance_secret_key_2024  # 部署时务必更换
JWT_EXPIRES_IN=7d

# 微信小程序 - 会员端
WX_MEMBER_APPID=wxeb3b664ce36208ba
WX_MEMBER_SECRET=fe12caa08920291c3636d9b3a0167909

# 微信小程序 - 管理端
WX_ADMIN_APPID=wx3f52761ae85bd5e7
WX_ADMIN_SECRET=81cb6c9d96671eed87702908d03916c6

# 腾讯云COS（可选）
COS_SECRET_ID=your_secret_id
COS_SECRET_KEY=your_secret_key
COS_BUCKET=your_bucket
COS_REGION=ap-guangzhou
```

### 8.2 前端 API 地址配置

**会员端** [config/index.js](file:///c:/Users/86133/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/69fb8e4688f9068cbc5bb33b/wuqi-member/config/index.js)：
```js
const env = 'dev';  // 部署时改为 'prod'
// dev:  http://localhost:3000/api/v1
// prod: https://api.yuekeme.cn/api/v1
```

**管理端** [config/index.js](file:///c:/Users/86133/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/69fb8e4688f9068cbc5bb33b/wuqi-admin/config/index.js)：
```js
const env = 'dev';  // 部署时改为 'prod'
// dev:  http://localhost:3000/api/v1
// prod: https://api.yuekeme.cn/api/v1
```

---

## 九、定时任务

| 时间 | 任务 |
|------|------|
| 每天 02:00 | 检查自动激活 pending 套餐 |
| 每天 02:15 | 检查 ≥60天未预约的 pending 套餐自动激活 |
| 每天 02:30 | 检查套餐到期 → expired，自动取消当天课程预约 |
| 每天 03:00 | 刷新所有套餐状态、清理过期候补 |
| 每天 07:00 | 发送预约提醒（订阅消息） |
| 每30分钟 | 检查低预约数课程（小于最低开课人数） |

---

## 十、部署流程

### 10.1 上传文件到服务器

需要上传以下文件夹到服务器对应目录：

| 本地文件夹 | 服务器路径 | 说明 |
|-----------|-----------|------|
| `wuqi-backend/*` | `/home/ubuntu/wuqi-dance-system/backend/` | 后端代码 |
| `wuqi-member/*` | `/home/ubuntu/wuqi-dance-system/member/` | 会员端小程序 |
| `wuqi-admin/*` | `/home/ubuntu/wuqi-dance-system/admin/` | 管理端小程序 |
| `deploy.sh` | `/home/ubuntu/wuqi-dance-system/` | 部署脚本 |
| `setup-nginx.sh` | `/home/ubuntu/wuqi-dance-system/` | Nginx配置脚本 |
| `.env.example` | `/home/ubuntu/wuqi-dance-system/` | 环境变量模板 |

**排除项**: `node_modules/`、`uploads/`、`logs/`（这些不要上传）

### 10.2 服务器环境安装

```bash
# SSH 登录服务器
ssh ubuntu@101.33.203.22

# 运行基础环境部署
cd /home/ubuntu/wuqi-dance-system
bash deploy.sh
```

### 10.3 配置密钥

```bash
# 编辑 .env，填入真实密钥
nano /home/ubuntu/wuqi-dance-system/backend/.env
```

### 10.4 配置 Nginx 并启动

```bash
bash /home/ubuntu/wuqi-dance-system/setup-nginx.sh
```

### 10.5 初始化数据

```bash
cd /home/ubuntu/wuqi-dance-system/backend
npm run seed
```

### 10.6 启动服务

```bash
cd /home/ubuntu/wuqi-dance-system/backend
pm2 start server.js --name wuqi-backend
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

### 10.7 Nginx 双域名配置说明

两个域名共用同一个后端（端口 3000），Nginx 根据域名区分请求来源：

```nginx
# 会员端 API
server {
    listen 80;
    server_name api.yuekeme.cn;
    location /api/ { proxy_pass http://127.0.0.1:3000/api/; }
}

# 管理端 API
server {
    listen 80;
    server_name admin-api.yuekeme.cn;
    location /api/ { proxy_pass http://127.0.0.1:3000/api/; }
}
```

### 10.8 HTTPS 配置（备案完成后）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yuekeme.cn -d admin-api.yuekeme.cn
```

---

## 十一、前端环境切换

### 11.1 前端环境配置

两个小程序都支持三套环境切换：

| env 值 | 说明 | API地址 | urlCheck 设置 |
|--------|------|---------|--------------|
| `dev` | 本地开发 | http://localhost:3000 | false |
| `test` | IP测试（备案前） | http://101.33.203.22:3000 | false |
| `prod` | 正式上线 | https://api.yuekeme.cn (会员端) / https://admin-api.yuekeme.cn (管理端) | true |

**切换方法**: 修改 `config/index.js` 中的 `const env = 'dev'` 改为对应值

**域名备案测试建议**: 备案完成前，设置 `env = 'test'` 进行开发测试

### 11.2 微信开发者工具

1. 分别导入本地 `wuqi-member/` 和 `wuqi-admin/` 目录
2. 在**详情 → 本地设置**勾选「不校验合法域名、web-view、TLS版本」（仅 dev/test 模式）
3. 开发调试小程序，调用后端 API

### 11.3 生产环境域名白名单配置

备案完成后，在微信公众平台配置服务器域名白名单：

| 小程序 | request 合法域名 | uploadFile 合法域名 | downloadFile 合法域名 |
|--------|-----------------|--------------------|-----------------------|
| 会员端 | `https://api.yuekeme.cn` | `https://api.yuekeme.cn` | `https://api.yuekeme.cn` |
| 管理端 | `https://admin-api.yuekeme.cn` | `https://admin-api.yuekeme.cn` | `https://admin-api.yuekeme.cn` |

---

## 十二、依赖项

### 后端依赖 (package.json)

| 包名 | 版本 | 用途 |
|------|------|------|
| express | ^5.2.1 | Web框架 |
| mongoose | ^9.6.1 | MongoDB ODM |
| jsonwebtoken | ^9.0.3 | JWT认证 |
| bcryptjs | ^3.0.3 | 密码加密 |
| axios | ^1.16.0 | HTTP请求 |
| cors | ^2.8.6 | 跨域处理 |
| dotenv | ^17.4.2 | 环境变量 |
| dayjs | ^1.11.20 | 日期处理 |
| morgan | ^1.10.1 | HTTP日志 |
| multer | ^2.1.1 | 文件上传 |
| node-cron | ^4.2.1 | 定时任务 |
| nodemon | ^3.1.14 | 开发热重载 |

### 微信基础库版本

- 最低基础库: 3.15.2（project.config.json 中配置）
- 使用自定义 tabBar（`"custom": true`）