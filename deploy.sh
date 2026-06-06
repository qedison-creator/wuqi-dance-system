#!/bin/bash

# ============================================
# 舞栖DANCE - 服务器部署脚本
# 服务器: 腾讯云轻量应用服务器
# IP: 101.33.203.22 | 系统: Ubuntu 24.04 LTS
# 域名: api.yuekeme.cn (会员端) / admin-api.yuekeme.cn (管理端)
# ============================================

set -e

echo "================================================"
echo "  舞栖DANCE - 服务器部署脚本"
echo "  服务器 IP: 101.33.203.22"
echo "================================================"

# 配置变量
PROJECT_DIR="/home/ubuntu/wuqi-dance-system"
BACKEND_DIR="$PROJECT_DIR/backend"
MEMBER_DIR="$PROJECT_DIR/member"
ADMIN_DIR="$PROJECT_DIR/admin"
BACKEND_PORT=3000
DOMAIN_MEMBER="api.yuekeme.cn"
DOMAIN_ADMIN="admin-api.yuekeme.cn"

# 1. 更新系统
echo ""
echo "[1/7] 更新系统..."
sudo apt update && sudo apt upgrade -y

# 2. 安装 Node.js 18.x
echo ""
echo "[2/7] 安装 Node.js 18.x..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "Node.js: $(node -v)"
echo "npm:    $(npm -v)"

# 3. 安装 MongoDB 7.0
echo ""
echo "[3/7] 安装 MongoDB 7.0..."
if ! command -v mongod &> /dev/null; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
  sudo apt update
  sudo apt install -y mongodb-org
  sudo systemctl start mongod
  sudo systemctl enable mongod
fi
echo "MongoDB: $(sudo systemctl is-active mongod)"

# 4. 安装 Nginx
echo ""
echo "[4/7] 安装 Nginx..."
sudo apt install -y nginx
sudo systemctl enable nginx

# 5. 安装 PM2
echo ""
echo "[5/7] 安装 PM2..."
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2
fi

# 6. 创建项目目录结构
echo ""
echo "[6/7] 创建项目目录结构..."
mkdir -p "$BACKEND_DIR"
mkdir -p "$BACKEND_DIR/uploads"
mkdir -p "$BACKEND_DIR/logs"
mkdir -p "$MEMBER_DIR"
mkdir -p "$ADMIN_DIR"

echo "项目目录已创建:"
echo "  $PROJECT_DIR/"
echo "  ├── backend/     ← 上传 wuqi-backend 代码到这里"
echo "  ├── member/      ← 上传 wuqi-member 代码到这里"
echo "  └── admin/       ← 上传 wuqi-admin 代码到这里"

# 7. 配置环境变量
echo ""
echo "[7/7] 配置环境变量..."
if [ ! -f "$BACKEND_DIR/.env" ]; then
  if [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$BACKEND_DIR/.env"
    echo "已从 .env.example 创建 .env 模板"
  else
    cat > "$BACKEND_DIR/.env" << 'EOF'
PORT=3000
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/wuqi_dance
JWT_SECRET=请在此填入随机生成的复杂密钥
JWT_EXPIRES_IN=7d

WX_MEMBER_APPID=wxeb3b664ce36208ba
WX_MEMBER_SECRET=请在此填入会员端AppSecret

WX_ADMIN_APPID=wx3f52761ae85bd5e7
WX_ADMIN_SECRET=请在此填入管理端AppSecret

COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=ap-guangzhou
EOF
    echo "已创建 .env 模板，请编辑填入真实密钥"
  fi
  echo ""
  echo "⚠️  重要: 请编辑 $BACKEND_DIR/.env 填入真实密钥后重新运行部署"
  echo "   nano $BACKEND_DIR/.env"
fi

echo ""
echo "================================================"
echo "  基础环境安装完成！"
echo "================================================"
echo ""
echo "接下来请手动执行以下步骤:"
echo ""
echo "1. 上传代码到服务器:"
echo "   scp -r wuqi-backend/* ubuntu@101.33.203.22:$BACKEND_DIR/"
echo "   scp -r wuqi-member/* ubuntu@101.33.203.22:$MEMBER_DIR/"
echo "   scp -r wuqi-admin/*  ubuntu@101.33.203.22:$ADMIN_DIR/"
echo ""
echo "2. 编辑 .env 填入真实密钥:"
echo "   nano $BACKEND_DIR/.env"
echo ""
echo "3. 运行安装脚本:"
echo "   bash $PROJECT_DIR/setup-nginx.sh"
echo ""
echo "4. 初始化数据库:"
echo "   cd $BACKEND_DIR && npm run seed"
echo ""
echo "5. 启动服务:"
echo "   cd $BACKEND_DIR && pm2 start server.js --name wuqi-backend"
echo "   pm2 save"
echo "   pm2 startup systemd -u ubuntu --hp /home/ubuntu"