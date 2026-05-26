# 舞栖舞蹈社 - 后端服务

## 📋 项目简介

舞栖舞蹈社管理系统后端服务，基于 Node.js + Express + MongoDB 构建。

## 🚀 快速开始

### 1. 环境准备

确保已安装：
- Node.js (v14+)
- MongoDB (v4.4+)

### 2. 安装依赖

```bash
cd wuqi-backend
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

主要配置项：
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/wuqi_dance
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
```

### 4. 初始化数据库

```bash
# 完整初始化（推荐）
npm run seed

# 或单独初始化各个模块
npm run seed:stores      # 初始化门店
npm run seed:dance       # 初始化舞种
npm run seed:packages    # 初始化套餐
npm run seed:coaches     # 初始化教练
npm run seed:banners     # 初始化Banner
```

### 5. 启动服务

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务将在 `http://localhost:3000` 启动。

## 🔑 默认账号

初始化后可使用以下账号登录：

| 角色 | 账号 | 密码 | 说明 |
|------|------|------|------|
| 超级管理员 | admin | admin123 | 系统最高权限 |
| 福永店店长 | FY_manager | 123456 | 福永店管理权限 |
| 福永店店员 | FY_staff | 123456 | 福永店操作权限 |
| 固戍店店长 | GS_manager | 123456 | 固戍店管理权限 |
| 固戍店店员 | GS_staff | 123456 | 固戍店操作权限 |

⚠️ **重要**: 登录后请立即修改默认密码！

## 📚 API文档

详细API文档请查看：[API文档](../docs/API文档.md)

### 主要接口模块

- `/api/v1/auth` - 认证相关
- `/api/v1/members` - 会员管理
- `/api/v1/packages` - 套餐管理
- `/api/v1/bookings` - 预约管理
- `/api/v1/schedules` - 排课管理
- `/api/v1/coaches` - 教练管理
- `/api/v1/coach-salaries` - 教练薪酬
- `/api/v1/stores` - 门店管理
- `/api/v1/holidays` - 放假管理
- `/api/v1/banners` - Banner管理
- `/api/v1/videos` - 视频管理
- `/api/v1/logs` - 操作日志
- `/api/v1/stats` - 数据统计
- `/api/v1/upload` - 文件上传

### 健康检查

```bash
curl http://localhost:3000/health
```

## 🛠 开发命令

```bash
# 开发模式启动
npm run dev

# 生产模式启动
npm start

# 数据库初始化
npm run seed

# 语法检查
npm run lint

# 运行测试
npm test
```

## 📁 项目结构

```
wuqi-backend/
├── src/
│   ├── config/          # 配置文件
│   ├── middleware/      # 中间件
│   ├── models/          # 数据模型
│   ├── routes/          # 路由定义
│   ├── seed/            # 种子数据
│   ├── services/        # 业务逻辑
│   ├── utils/           # 工具函数
│   └── app.js           # 应用入口
├── uploads/             # 上传文件目录
├── .env                 # 环境变量
├── package.json
└── server.js            # 启动文件
```

## 🗄 数据模型

### 新增模型
- `User` - 用户（扩展了双手机号、会员编码等字段）
- `PackageActivation` - 套餐激活记录
- `PackageExtension` - 套餐有效期延长记录
- `CoachSalary` - 教练薪酬配置
- `CoachSalaryStat` - 教练薪酬统计

### 现有模型
- `Package` - 套餐模板
- `UserPackage` - 用户套餐
- `Schedule` - 排课
- `Booking` - 预约
- `Waitlist` - 候补
- `Holiday` - 放假
- `Store` - 门店
- `Coach` - 教练
- `DanceStyle` - 舞种
- `Banner` - Banner
- `Video` - 视频
- `OperationLog` - 操作日志
- `ExemptionLog` - 豁免记录
- `Config` - 配置
- `SystemConfig` - 系统配置

## 📊 核心功能

### 会员管理
- ✅ 双手机号管理（微信手机号+预留手机号）
- ✅ 会员编码自动生成（FY20260513001格式）
- ✅ 预留手机号审核流程
- ✅ 会员信息完整性校验
- ✅ 会员状态管理

### 套餐管理
- ✅ 套餐激活记录
- ✅ 套餐有效期延长/撤销
- ✅ 5种会员套餐状态管理
- ✅ 套餐强制激活定时任务

### 预约管理
- ✅ 预约前套餐状态检查
- ✅ 候补排队机制
- ✅ 签到功能（单会员/批量）
- ✅ 低人数自动取消

### 教练薪酬
- ✅ 按教练+时长配置薪酬
- ✅ 课程薪酬自动统计
- ✅ 薪酬结算/取消

### 放假管理
- ✅ 放假期间课程自动取消
- ✅ 套餐有效期自动延长
- ✅ 放假状态流转控制

### 消息推送
- ✅ 课程取消通知
- ✅ 候补成功通知
- ✅ 放假通知

## 🔐 权限控制

| 角色 | 权限 |
|------|------|
| super_admin | 系统所有权限 |
| store_manager | 门店管理、套餐配置、薪酬结算等 |
| staff | 会员审核、预约、签到等日常操作 |

## 📝 定时任务

系统包含以下定时任务（需确保服务正常运行）：
- 套餐强制激活检查（2个月未激活自动激活）
- 低人数课程自动取消
- 过期套餐状态更新

## 🧪 测试指南

### 1. 启动服务
```bash
npm run dev
```

### 2. 测试接口

使用 Postman 或其他工具测试：

#### 登录获取Token
```
POST /api/v1/auth/admin-login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

#### 会员相关测试
```
GET    /api/v1/members
POST   /api/v1/members
PUT    /api/v1/members/:id
PUT    /api/v1/members/:id/review
PUT    /api/v1/members/:id/assign-code
GET    /api/v1/members/phone-audit/list
PUT    /api/v1/members/:id/phone-audit
```

#### 套餐相关测试
```
GET    /api/v1/packages
POST   /api/v1/packages
GET    /api/v1/packages/activation-records
GET    /api/v1/packages/extension-records
PUT    /api/v1/packages/:id/extend
PUT    /api/v1/packages/extension-records/:id/revoke
```

#### 预约相关测试
```
GET    /api/v1/bookings
POST   /api/v1/bookings/check-in
POST   /api/v1/bookings/batch-check-in
GET    /api/v1/bookings/check-in-records/:schedule_id
```

#### 教练薪酬相关测试
```
GET    /api/v1/coach-salaries
POST   /api/v1/coach-salaries
GET    /api/v1/coach-salaries/stats/list
GET    /api/v1/coach-salaries/stats/summary
PUT    /api/v1/coach-salaries/stats/:id/settle
```

## 🔧 常见问题

### MongoDB连接失败
1. 确认 MongoDB 服务已启动
2. 检查 `.env` 中的 `MONGODB_URI` 配置
3. 确认数据库名称正确

### 端口被占用
修改 `.env` 中的 `PORT` 配置，或关闭占用3000端口的程序。

### 初始化数据失败
1. 确认已连接数据库
2. 检查集合是否已存在（脚本会跳过已有数据）
3. 清空数据库后重新运行初始化

## 📞 技术支持

如有问题，请查看：
- [API文档](../docs/API文档.md)
- [全面审查报告](../docs/舞栖舞蹈社系统全面审查报告.md)
- [执行清单](../ui/舞栖舞蹈社系统修改执行清单.md)

## 📄 许可证

ISC
