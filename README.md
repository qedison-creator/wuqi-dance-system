# 舞栖舞蹈社管理系统

## 项目简介

舞栖舞蹈社微信小程序管理系统，包含管理端、会员端和后端服务。

## 技术栈

- **管理端** (wuqi-admin): 微信小程序 (原生)
- **会员端** (wuqi-member): 微信小程序 (原生)
- **后端** (wuqi-backend): Node.js + Express + MongoDB

## 项目结构

```
├── wuqi-admin/          # 管理端小程序
├── wuqi-member/         # 会员端小程序
├── wuqi-backend/        # 后端服务
│   ├── src/             # 源代码
│   │   ├── models/      # 数据模型
│   │   ├── routes/      # 路由
│   │   ├── services/    # 业务逻辑
│   │   ├── middleware/   # 中间件
│   │   ├── utils/       # 工具
│   │   └── config/      # 配置
│   └── db-backup/       # 数据库备份
├── docs/                # 项目文档
├── ui/                  # UI设计稿
└── V1.0-release/        # V1.0版本发布包
```

## 快速开始

### 1. 安装依赖

```bash
cd wuqi-backend
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填写数据库连接等配置。

### 3. 导入数据库

```bash
cd wuqi-backend/db-backup
# 使用 mongoimport 导入各集合数据
```

### 4. 启动后端

```bash
cd wuqi-backend
npm start
```

### 5. 导入小程序

使用微信开发者工具分别导入 `wuqi-admin` 和 `wuqi-member` 目录。

## 数据库备份

数据库备份文件位于 `wuqi-backend/db-backup/` 目录，包含所有集合的 JSON 导出文件。
