const express = require('express');
const router = express.Router();
const { success } = require('../utils/response');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const User = require('../models/User');

// 内存令牌存储：短token → { member_code, expires_at }
// 使用短token大幅减小二维码复杂度，真机扫码更可靠
const tokenStore = new Map();
const TOKEN_TTL = 70 * 1000; // 70秒（前端60秒刷新 + 10秒缓冲）
const TOKEN_LENGTH = 8;

// 每60秒清理过期token
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokenStore) {
    if (data.expiresAt < now) tokenStore.delete(token);
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
      createdAt: Date.now(),
      expiresAt: Date.now() + TOKEN_TTL,
    });

    res.json({ code: 200, data: { token: shortToken } });
  } catch (error) {
    console.error('QR code token generation error:', error);
    res.status(500).json({ code: 500, message: 'Failed to generate QR code token' });
  }
});

// POST /api/v1/qrcode/verify - 管理端扫码验证会员二维码token
router.post('/qrcode/verify', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res) => {
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
      tokenStore.delete(token);
      return res.status(400).json({ code: 400, message: '签到码已过期，请刷新后重试' });
    }

    // 验证成功后删除token（一次性使用）
    tokenStore.delete(token);

    res.json(success({
      member_code: stored.member_code,
      timestamp: stored.createdAt,
    }));
  } catch (error) {
    console.error('QR code verify error:', error);
    res.status(500).json({ code: 500, message: '验证失败' });
  }
});

module.exports = router;