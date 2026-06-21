const express = require('express');
const router = express.Router();
const { success } = require('../utils/response');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const User = require('../models/User');
const { sendToUser } = require('../services/websocket.service');

// 内存令牌存储：短token → { member_code, expires_at, member_id, scanned, scan_timeout_timer }
// 使用短token大幅减小二维码复杂度，真机扫码更可靠
const tokenStore = new Map();
const TOKEN_TTL = 70 * 1000; // 70秒（前端60秒刷新 + 10秒缓冲）
const TOKEN_LENGTH = 8;

// 扫码后管理员操作超时时间（30秒无操作自动重置会员端状态）
const SCAN_ACTION_TIMEOUT = 30 * 1000;

// 每60秒清理过期token
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokenStore) {
    if (data.expiresAt < now) {
      // 清理超时定时器
      if (data.scanTimeoutTimer) {
        clearTimeout(data.scanTimeoutTimer);
      }
      tokenStore.delete(token);
    }
  }
}, 60000);

function generateShortToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

/**
 * 清理扫码超时定时器
 */
function clearScanTimeout(token) {
  const stored = tokenStore.get(token);
  if (stored && stored.scanTimeoutTimer) {
    clearTimeout(stored.scanTimeoutTimer);
    stored.scanTimeoutTimer = null;
  }
}

// GET /api/v1/qrcode/qrcode-token - 会员端获取动态二维码token
router.get('/qrcode-token', auth, checkPermission(['member', 'super_admin', 'store_manager', 'staff']), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('member_code');
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    if (!user.member_code) {
      return res.status(400).json({ code: 400, message: '请先绑定会员编码' });
    }

    const shortToken = generateShortToken();
    tokenStore.set(shortToken, {
      member_code: user.member_code,
      member_id: user._id.toString(),
      createdAt: Date.now(),
      expiresAt: Date.now() + TOKEN_TTL,
      scanned: false,
      scanTimeoutTimer: null,
    });

    res.json({ code: 200, data: { token: shortToken } });
  } catch (error) {
    console.error('QR code token generation error:', error);
    res.status(500).json({ code: 500, message: 'Failed to generate QR code token' });
  }
});

// POST /api/v1/qrcode/verify - 管理端扫码验证会员二维码token
router.post('/verify', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ code: 400, message: '缺少token参数' });
    }

    const stored = tokenStore.get(token);
    if (!stored) {
      return res.status(400).json({ code: 400, message: '无效的签到码或已过期，请刷新后重试' });
    }

    if (Date.now() > stored.expiresAt) {
      clearScanTimeout(token);
      tokenStore.delete(token);
      return res.status(400).json({ code: 400, message: '签到码已过期，请刷新后重试' });
    }

    // 防重复扫码：同一token只能被扫码一次
    if (stored.scanned) {
      return res.status(400).json({ code: 400, message: '该二维码已被扫码，请会员刷新后重试' });
    }
    stored.scanned = true;

    // 验证成功后删除token（一次性使用）
    // 注意：不立即删除，保留 scanTimeoutTimer 追踪，超时后再清理
    // tokenStore.delete(token);

    // 实时推送：通知会员端"已被扫码，管理员正在为您签到"
    try {
      const memberId = stored.member_id;
      if (memberId) {
        sendToUser(memberId, 'scanned', {
          member_code: stored.member_code,
          scanned_at: Date.now(),
          message: '管理员已扫码'
        });

        // 启动30秒操作超时定时器：管理员扫码后无操作则自动重置会员端
        stored.scanTimeoutTimer = setTimeout(() => {
          try {
            sendToUser(memberId, 'check_in_timeout', {
              timeout_at: Date.now(),
              reason: 'admin_no_action',
              message: '签到超时，请重新出示二维码'
            });
          } catch (e) {}
          // 超时后清理token
          const stillStored = tokenStore.get(token);
          if (stillStored && stillStored.scanTimeoutTimer) {
            clearTimeout(stillStored.scanTimeoutTimer);
          }
          tokenStore.delete(token);
        }, SCAN_ACTION_TIMEOUT);
      }
    } catch (e) {}

    res.json(success({
      member_code: stored.member_code,
      timestamp: stored.createdAt,
    }));
  } catch (error) {
    console.error('QR code verify error:', error);
    res.status(500).json({ code: 500, message: '验证失败' });
  }
});

// POST /api/v1/qrcode/view-only - 管理端仅查看会员信息（不签到）
router.post('/view-only', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ code: 400, message: '缺少token参数' });
    }

    const stored = tokenStore.get(token);
    if (!stored) {
      return res.status(400).json({ code: 400, message: '二维码已失效' });
    }

    // 清理扫码超时定时器（管理员已主动操作，不再触发超时）
    clearScanTimeout(token);

    // 推送 view_only 事件给会员端
    try {
      const memberId = stored.member_id;
      if (memberId) {
        sendToUser(memberId, 'view_only', {
          viewed_at: Date.now(),
          message: '管理员查看了你的信息'
        });
      }
    } catch (e) {}

    // 查看后删除token
    tokenStore.delete(token);

    res.json(success({ viewed: true }));
  } catch (error) {
    console.error('QR code view-only error:', error);
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

// POST /api/v1/qrcode/clear-scan - 管理端关闭扫码弹窗时清理扫码状态
router.post('/clear-scan', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res) => {
  try {
    const { token } = req.body;
    if (token) {
      const stored = tokenStore.get(token);
      if (stored) {
        // 清理超时定时器
        clearScanTimeout(token);
        // 推送 view_only 事件（管理员关闭弹窗视为查看信息）
        try {
          if (stored.member_id) {
            sendToUser(stored.member_id, 'view_only', {
              viewed_at: Date.now(),
              message: '管理员查看了你的信息'
            });
          }
        } catch (e) {}
        // 删除token
        tokenStore.delete(token);
      }
    }
    res.json(success({ cleared: true }));
  } catch (error) {
    console.error('QR code clear-scan error:', error);
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

module.exports = router;
