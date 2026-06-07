const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const authService = require('../services/auth.service');
const User = require('../models/User');
const { success } = require('../utils/response');

// POST /api/v1/auth/wx-login
router.post('/wx-login', async (req, res, next) => {
  try {
    const { code, store_id, client_type } = req.body;
    const result = await authService.wxLogin(code, store_id, client_type);
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
    res.json(success(result, '管理端登录成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id);
    res.json(success(user));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/auth/profile - 更新会员个人信息
router.put('/profile', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { real_name, phone, gender, store_id } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在', data: null });

    if (real_name !== undefined) user.real_name = real_name;
    if (phone !== undefined) user.phone = phone;
    if (gender !== undefined) user.gender = gender;

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
      .populate('store_id', 'name phone address');
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
