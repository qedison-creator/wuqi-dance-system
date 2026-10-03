#!/bin/bash
# ============================================================
# nginx 守护：防止 /etc/nginx/sites-enabled 下的坏配置让 nginx 起不来或抢占 443
#
# 【背景 1】2026-09-24 生产事故
# Debian/Ubuntu 的 nginx-common 包升级时会重新生成
#   /etc/nginx/sites-enabled/default
# 该文件内含：
#   listen 443 ssl default_server;   且证书为 yuekeme.cn（非 api.yuekeme.cn）
# 它以 default_server 抢占 0.0.0.0:443，与正式站点的
#   listen 443 ssl http2;
# 产生 "protocol options redefined for 0.0.0.0:443" 冲突，
# 导致 api.yuekeme.cn 间歇性 net::ERR_CONNECTION_RESET。
#
# 【背景 2】同日第二次故障
# 曾出现悬空软链 sites-enabled/wuqi-dance -> sites-available/wuqi-dance（目标不存在），
# 使 nginx 无法加载 sites-enabled/*，nginx -t 失败、服务起不来。
# 触发点正是 nginx 包升级时的 postinst 重启。
#
# 【本脚本】幂等、可重复执行，两类问题都处理：
#   A. 清理 sites-enabled 下所有断链软链（断链必然导致 nginx 启动失败）
#   B. 清理以 listen 443 ... default_server 抢占端口的 default 站点
# 任一改动后统一 nginx -t 校验：通过则 reload（失败则 start 兜底自愈），
# 不通过则回滚 B 的改动并记录，绝不把配置改坏。
# 所有动作写入 /var/log/nginx-guard.log
#
# 【自动调用】/etc/dpkg/dpkg.cfg.d/99-nginx-guard
#   post-invoke=if [ -x /usr/local/bin/nginx-guard-default-site.sh ]; then /usr/local/bin/nginx-guard-default-site.sh >/dev/null 2>&1; fi
# ============================================================

set -u

LOG=/var/log/nginx-guard.log
SITES_DIR=/etc/nginx/sites-enabled
LIVE_SITE="$SITES_DIR/api.yuekeme.cn"
DEFAULT_LINK="$SITES_DIR/default"

CHANGED=0
DEFAULT_BACKUP=""

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# ---------------- A. 清理断链软链 ----------------
# 断链软链让 nginx 连配置都加载不了，移除是纯修复（它本来就提供不了任何功能）
while IFS= read -r broken; do
  [ -n "$broken" ] || continue
  log "FIXED 移除断链软链 $broken -> $(readlink "$broken" 2>/dev/null)"
  rm -f "$broken"
  CHANGED=1
done < <(find "$SITES_DIR" -maxdepth 1 -xtype l 2>/dev/null)

# ---------------- B. 清理抢占 443 的 default 站点 ----------------
# 安全前提：正式站点必须存在，否则不动 default（避免把服务器变成没有任何站点）
if [ -e "$DEFAULT_LINK" ] && [ ! -e "$LIVE_SITE" ]; then
  log "WARN  检测到 $DEFAULT_LINK，但未发现正式站点 $LIVE_SITE，为保证安全不做处理"
elif [ -e "$DEFAULT_LINK" ] \
     && grep -Eq 'listen[[:space:]]+[^;]*443[^;]*default_server' "$DEFAULT_LINK" 2>/dev/null; then
  DEFAULT_BACKUP="/root/nginx-default-site.bak.$(date +%Y%m%d%H%M%S)"
  cp -aL "$DEFAULT_LINK" "$DEFAULT_BACKUP" 2>/dev/null || true
  # 只删软链/文件本身，/etc/nginx/sites-available/default 源文件保持不动
  rm -f "$DEFAULT_LINK"
  log "FIXED 移除 $DEFAULT_LINK（占用 443 default_server，内容备份: $DEFAULT_BACKUP）"
  CHANGED=1
fi

# ---------------- C. 有改动 → 统一校验 ----------------
[ "$CHANGED" = "1" ] || exit 0

if nginx -t >/dev/null 2>&1; then
  # reload 失败（nginx 未运行）时用 start 兜底，实现自愈
  systemctl reload nginx >/dev/null 2>&1 || systemctl start nginx >/dev/null 2>&1 || true
  log "OK    nginx -t 通过，已应用修复并 reload/start"
else
  if [ -n "$DEFAULT_BACKUP" ]; then
    # 回滚 B：恢复为普通文件（内容一致），保证配置可用
    rm -f "$DEFAULT_LINK"
    cp -a "$DEFAULT_BACKUP" "$DEFAULT_LINK" 2>/dev/null || true
    log "ERROR nginx -t 失败，已回滚 $DEFAULT_LINK，请人工检查（备份: $DEFAULT_BACKUP）"
  else
    log "ERROR nginx -t 失败（断链软链已清理但配置仍有问题），请人工检查"
  fi
fi