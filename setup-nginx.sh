#!/bin/bash

# ============================================
# Nginx 配置脚本 - 双域名反向代理
# api.yuekeme.cn       → 会员端API
# admin-api.yuekeme.cn → 管理端API
# ============================================

set -e

PROJECT_DIR="/home/ubuntu/wuqi-dance-system"
BACKEND_DIR="$PROJECT_DIR/backend"

echo "================================================"
echo "  配置 Nginx 反向代理"
echo "================================================"

# 安装后端依赖
echo ""
echo "[1/3] 安装后端依赖..."
cd "$BACKEND_DIR"
npm install --production

# 配置 Nginx
echo ""
echo "[2/3] 配置 Nginx..."

sudo tee /etc/nginx/sites-available/wuqi-dance > /dev/null << 'NGINX_CONF'
# 会员端 API
server {
    listen 80;
    server_name api.yuekeme.cn;

    access_log /var/log/nginx/api-access.log;
    error_log  /var/log/nginx/api-error.log;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 静态文件（图片/视频）
    location /uploads/ {
        alias /home/ubuntu/wuqi-dance-system/backend/uploads/;
        # 视频流支持
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=86400";
        # 允许跨域
        add_header Access-Control-Allow-Origin *;
        # 确保正确的 MIME 类型
        types {
            video/mp4 mp4;
            video/webm webm;
            video/ogg ogv;
            image/jpeg jpg jpeg;
            image/png png;
            image/gif gif;
            image/webp webp;
            image/svg+xml svg;
        }
        # 禁止目录列表
        autoindex off;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_set_header Host $host;
    }

    location / {
        return 200 '{"status":"ok","service":"wuqi-dance-member-api"}';
    }
}

# 管理端 API
server {
    listen 80;
    server_name admin-api.yuekeme.cn;

    access_log /var/log/nginx/admin-api-access.log;
    error_log  /var/log/nginx/admin-api-error.log;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 静态文件（图片/视频）
    location /uploads/ {
        alias /home/ubuntu/wuqi-dance-system/backend/uploads/;
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=86400";
        add_header Access-Control-Allow-Origin *;
        types {
            video/mp4 mp4;
            video/webm webm;
            video/ogg ogv;
            image/jpeg jpg jpeg;
            image/png png;
            image/gif gif;
            image/webp webp;
            image/svg+xml svg;
        }
        autoindex off;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_set_header Host $host;
    }

    location / {
        return 200 '{"status":"ok","service":"wuqi-dance-admin-api"}';
    }
}
NGINX_CONF

# 启用站点
sudo ln -sf /etc/nginx/sites-available/wuqi-dance /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 测试配置
sudo nginx -t && sudo systemctl reload nginx

echo "Nginx 配置完成"
echo "  会员端 API: http://api.yuekeme.cn"
echo "  管理端 API: http://admin-api.yuekeme.cn"

# 配置防火墙
echo ""
echo "[3/3] 配置防火墙..."
if command -v ufw &> /dev/null; then
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 22/tcp
  sudo ufw allow 3000/tcp
  echo "防火墙规则已更新"
fi

echo ""
echo "================================================"
echo "  Nginx 配置完成！"
echo "================================================"
echo ""
echo "域名备案完成后，配置 HTTPS:"
echo "  sudo apt install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d api.yuekeme.cn -d admin-api.yuekeme.cn"