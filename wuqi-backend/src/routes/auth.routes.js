const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const authService = require('../services/auth.service');
const User = require('../models/User');
const { success } = require('../utils/response');
const config = require('../config');

// POST /api/v1/auth/wx-login
router.post('/wx-login', async (req, res, next) => {
  try {
    const { code, store_id, client_type, avatar_url, nick_name, phone_code } = req.body;
    const result = await authService.wxLogin(code, store_id, client_type, { avatar_url, nick_name, phone_code });
    // nginx 反向代理后 req.protocol 可能为 http，优先使用真实协议头，生产环境兜底 https
    if (result.user && result.user.avatar_url && !result.user.avatar_url.startsWith('http')) {
      const protocol = req.headers['x-forwarded-proto'] || (config.isProd ? 'https' : req.protocol);
      const host = req.get('host');
      result.user.avatar_url = `${protocol}://${host}${result.user.avatar_url}`;
    }
    res.json(success(result, '微信登录成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/admin-login
router.post('/admin-login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const result = await authService.adminLogin(username, password);
    // 参照banner处理方式：拼接完整头像URL
    if (result.user && result.user.avatar_url && !result.user.avatar_url.startsWith('http')) {
      // nginx 反向代理后 req.protocol 可能为 http，优先使用真实协议头
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      result.user.avatar_url = `${protocol}://${host}${result.user.avatar_url}`;
    }
    res.json(success(result, '管理端登录成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id);
    const userObj = user.toObject ? user.toObject() : user;
    // 参照banner处理方式：拼接完整图片URL
    if (userObj.avatar_url && !userObj.avatar_url.startsWith('http')) {
      // nginx 反向代理后 req.protocol 可能为 http，优先使用真实协议头
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      userObj.avatar_url = `${protocol}://${host}${userObj.avatar_url}`;
    }
    // 别名：前端统一使用 avatar / nickname，兼容旧代码
    userObj.avatar = userObj.avatar_url;
    userObj.nickname = userObj.nick_name;
    res.json(success(userObj));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/auth/profile - 更新会员个人信息
router.put('/profile', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { real_name, phone, gender, store_id, nick_name, avatar_url } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在', data: null });

    if (real_name !== undefined) user.real_name = real_name;
    if (phone !== undefined) user.phone = phone;
    if (gender !== undefined) user.gender = gender;
    if (nick_name !== undefined) user.nick_name = nick_name;
    if (avatar_url !== undefined) user.avatar_url = avatar_url;

    // 门店修改限制：审核通过且有套餐后不能修改门店
    if (store_id !== undefined) {
      const UserPackage = require('../models/UserPackage');
      const hasPackage = await UserPackage.findOne({ user_id: user._id });
      if (hasPackage && user.member_status === 'official') {
        return res.status(403).json({ code: 403, message: '已录入套餐的会员不能修改门店，请联系管理员', data: null });
      }
      user.store_id = store_id;
    }

    await user.save();
    const populated = await User.findById(user._id)
      .select('-password -__v')
      .populate('store_id', 'name phone address');
    res.json(success(populated, '更新成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/avatar - 上传头像
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads/avatars'),
    filename: (req, file, cb) => {
      cb(null, `user_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

router.post('/avatar', auth, checkPermission(['member']), avatarUpload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ code: 400, message: '请上传头像文件', data: null });

    const originalPath = req.file.path;
    const originalFilename = req.file.filename;
    const parsed = path.parse(originalFilename);
    const webpFilename = parsed.name + '.webp';
    const webpPath = path.join(path.dirname(originalPath), webpFilename);

    // 使用 sharp 压缩：缩放至 200x200，webp 格式，质量 80%
    try {
      await sharp(originalPath)
        .resize(200, 200, { fit: 'cover', position: 'center' })
        .webp({ quality: 80 })
        .toFile(webpPath);

      // 删除原始文件，仅保留 webp 版本
      fs.unlinkSync(originalPath);
    } catch (sharpErr) {
      // sharp 压缩失败，降级使用原图
      console.error('[Avatar] sharp 压缩失败，使用原图:', sharpErr.message);
      if (fs.existsSync(webpPath)) {
        fs.unlinkSync(webpPath);
      }
    }

    const finalFilename = fs.existsSync(webpPath) ? webpFilename : originalFilename;
    const avatarUrl = `/uploads/avatars/${finalFilename}`;

    // 更新数据库
    await User.findByIdAndUpdate(req.user.id, { avatar_url: avatarUrl });

    res.json(success({ url: avatarUrl }, '头像上传成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/auth/admin-profile - 管理端更新个人信息
router.put('/admin-profile', auth, async (req, res, next) => {
  try {
    const { nick_name, avatar_url } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    if (user.user_type === 'member') {
      return res.status(403).json({ code: 403, message: '会员请使用会员接口', data: null });
    }

    if (nick_name !== undefined) user.nick_name = nick_name;
    if (avatar_url !== undefined) {
      // 只保存相对路径，去除服务器地址前缀
      let cleanUrl = avatar_url;
      const urlMatch = avatar_url && avatar_url.match(/^https?:\/\/[^/]+(\/.*)$/);
      if (urlMatch) cleanUrl = urlMatch[1];
      user.avatar_url = cleanUrl;
    }

    await user.save();
    const populated = await User.findById(user._id)
      .select('-password -__v')
      .populate('store_id', 'name phone address')
      .populate('store_ids', 'name');
    res.json(success(populated, '更新成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/auth/change-password
router.put('/change-password', auth, async (req, res, next) => {
  try {
    const { old_password, new_password } = req.body;
    const result = await authService.changePassword(req.user.id, old_password, new_password);
    res.json(success(result, '密码修改成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
