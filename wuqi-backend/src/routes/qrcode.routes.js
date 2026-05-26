const express = require('express');
const router = express.Router();
const { generateToken } = require('../utils/crypto');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const User = require('../models/User');

router.get('/qrcode-token', auth, checkPermission(['member', 'super_admin', 'store_manager', 'staff']), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('member_code');
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    if (!user.member_code) {
      return res.status(400).json({ code: 400, message: '请先绑定会员编码' });
    }

    const encryptedToken = generateToken(user.member_code);
    const qrcodeData = encodeURIComponent(JSON.stringify({ t: encryptedToken }));
    const qrcodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrcodeData}`;

    res.json({ code: 200, data: { token: encryptedToken, qrcode_url: qrcodeUrl } });
  } catch (error) {
    console.error('QR code token generation error:', error);
    res.status(500).json({ code: 500, message: 'Failed to generate QR code token' });
  }
});

router.post('/qrcode', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ code: 400, message: 'token is required' });
    }

    const encryptedToken = generateToken(token);
    const qrcodeData = encodeURIComponent(JSON.stringify({ t: encryptedToken }));
    const qrcodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrcodeData}`;

    res.json({ code: 200, data: { qrcode_url: qrcodeUrl } });
  } catch (error) {
    console.error('QR code generation error:', error);
    res.status(500).json({ code: 500, message: 'Failed to generate QR code' });
  }
});

module.exports = router;
