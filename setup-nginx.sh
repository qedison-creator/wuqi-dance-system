#!/bin/bash

# ============================================
# Nginx 配置脚本 - 双域名反向代理
# api.yuekeme.cn       → 会员端API
# admin-api.yuekeme.cn → 管理端API
# ============================================

set -e

# ============================================
# ⚠️ 仅限【全新服务器首次部署】使用
#
# 本脚本写入的站点配置只覆盖 80 端口；现网服务器上的
# /etc/nginx/sites-enabled/api.yuekeme.cn 已在此基础上由 certbot
# 增加了 443/HTTPS 配置。在已部署环境运行本脚本会覆盖并破坏 HTTPS，
# 因此脚本内置现网检测：检测到已部署即中止。
# ============================================

PROJECT_DIR="/home/ubuntu/wuqi-dance-system"
BACKEND_DIR="$PROJECT_DIR/backend"
SITE_NAME="api.yuekeme.cn"
SITE_FILE="/etc/nginx/sites-available/$SITE_NAME"

echo "================================================"
echo "  配置 Nginx 反向代理"
echo "================================================"

# 现网保护：sites-enabled 下已存在非 default 的站点配置 → 环境已部署，直接中止
EXISTING_SITES=$(ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | grep -v '^default$' || true)
if [ -n "$EXISTING_SITES" ]; then
  echo ""
  echo "[中止] 检测到已启用的站点配置:"
  echo "$EXISTING_SITES" | sed 's/^/         /'
  echo ""
  echo "本脚本仅用于全新服务器首次部署，继续执行会覆盖现网 nginx 配置（含 443/HTTPS）。"
  echo "如需修改现网配置，请直接编辑 /etc/nginx/sites-enabled/ 下的文件。"
  exit 1
fi

# 现网保护：sites-available 下已存在同名站点文件 → 为已有配置，禁止覆盖
if [ -e "$SITE_FILE" ]; then
  echo ""
  echo "[中止] 已存在站点配置文件: $SITE_FILE"
  echo "为避免覆盖已有配置，本脚本不做覆盖。如需重新生成，请先手动备份并删除该文件。"
  exit 1
fi

# 安装后端依赖
echo ""
echo "[1/3] 安装后端依赖..."
cd "$BACKEND_DIR"
npm install --production

# 配置 Nginx
echo ""
echo "[2/3] 配置 Nginx..."

sudo tee "$SITE_FILE" > /dev/null << 'NGINX_CONF'
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
# 仅在站点配置文件存在时才创建软链：目标缺失时 ln -sf 会生成悬空软链，
# 导致 nginx 加载 sites-enabled/* 失败、无法 reload/重启（本段请勿逐行手动执行）
if [ ! -f "$SITE_FILE" ]; then
  echo "[中止] 未找到 $SITE_FILE，无法启用站点（不创建软链，避免产生悬空软链）" >&2
  exit 1
fi
sudo ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 重载 systemd 单元定义（nginx 包升级会替换 unit 文件，避免出现 "unit file changed on disk" 告警）
sudo systemctl daemon-reload

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