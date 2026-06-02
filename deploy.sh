#!/bin/bash

# ============================================
# 舞栖舞蹈社小程序 - 一键部署脚本
# Version: V1.1.0
# ============================================

echo "================================================"
echo "  舞栖舞蹈社小程序 - 一键部署脚本"
echo "================================================"

# 1. 更新系统和安装依赖
echo ""
echo "[1/6] 更新系统并安装依赖..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git curl wget

# 2. 安装 Node.js 18.x
echo ""
echo "[2/6] 安装 Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
echo "Node.js 版本: $(node -v)"
echo "npm 版本: $(npm -v)"

# 3. 安装 MongoDB 6.0
echo ""
echo "[3/6] 安装 MongoDB 6.0..."
curl -fsSL https://www.mongodb.org/static/pgp/server-6.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-6.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl start mongod
sudo systemctl enable mongod
echo "MongoDB 状态: $(sudo systemctl is-active mongod)"

# 4. 克隆项目代码
echo ""
echo "[4/6] 克隆项目代码..."
mkdir -p /var/www
cd /var/www
git clone https://github.com/qedison-creator/wuqi-dance-system.git
cd wuqi-dance-system

# 5. 安装项目依赖并配置
echo ""
echo "[5/6] 安装项目依赖..."
cd wuqi-backend
npm install --production

# 创建环境配置文件
cat > .env << EOF
PORT=3000
NODE_ENV=production
JWT_SECRET=your_jwt_secret_key_here_please_change_it
MONGODB_URI=mongodb://localhost:27017/wuqi_dance
SERVER_BASE=http://localhost:3000
EOF

# 6. 配置 Nginx 反向代理
echo ""
echo "[6/6] 配置 Nginx 反向代理..."

# 备份原有配置
sudo mv /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak

# 创建新配置
cat > /etc/nginx/sites-available/wuqi-dance << EOF
server {
    listen 80;
    server_name localhost;

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    # 静态文件
    location /uploads/ {
        alias /var/www/wuqi-dance-system/wuqi-backend/uploads/;
    }

    # 默认返回
    location / {
        return 200 '舞栖舞蹈社服务已启动';
    }
}
EOF

# 启用配置
sudo ln -sf /etc/nginx/sites-available/wuqi-dance /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 安装 PM2 进程管理
echo ""
echo "安装 PM2 进程管理..."
sudo npm install -g pm2

# 启动服务
echo ""
echo "启动后端服务..."
pm2 start server.js --name wuqi-backend
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo ""
echo "================================================"
echo "  部署完成！"
echo "================================================"
echo ""
echo "服务信息:"
echo "- 后端服务: http://你的服务器IP:3000"
echo "- Nginx反向代理: http://你的服务器IP/api/"
echo "- PM2管理: pm2 list"
echo ""
echo "接下来需要:"
echo "1. 修改 .env 中的 JWT_SECRET 为安全的密钥"
echo "2. 配置域名和 HTTPS (推荐使用 Let's Encrypt)"
echo "3. 设置小程序服务器域名白名单"
echo "4. 初始化数据库数据"
echo ""
echo "初始化数据库命令:"
echo "cd /var/www/wuqi-dance-system/wuqi-backend"
echo "npm run seed"