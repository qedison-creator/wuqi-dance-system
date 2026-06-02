const User = require('../models/User');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { code2Session } = require('../utils/wechat');

// 生成JWT token
const generateToken = (user) => {
  const payload = {
    id: user._id,
    openid: user.openid,
    user_type: user.user_type,
    member_status: user.member_status,
    role: user.role,
    nick_name: user.nick_name,
    permissions: user.permissions || [],
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
};

// 微信登录 - 用code换openid，自动注册，返回JWT
exports.wxLogin = async (code, storeId, clientType = 'member') => {
  if (!code) {
    throw new Error('缺少微信登录code');
  }

  // 1. 调用微信API用code换openid
  let wxData;
  let isDevMode = false;
  try {
    wxData = await code2Session(code, clientType);
  } catch (err) {
    // 开发环境模拟（微信开发者工具的code无法调用真实API）
    console.log('[开发模式] 微信code2Session失败，使用模拟数据:', err.message);
    isDevMode = true;
    const crypto = require('crypto');
    const stableId = crypto.createHash('md5').update(code.substring(0, 8)).digest('hex').substring(0, 16);
    wxData = {
      openid: `dev_openid_${stableId}`,
      session_key: 'dev_session_key',
      unionid: null,
    };
  }

  const { openid, unionid } = wxData;

  // 2. 查找或创建用户
  let user = await User.findOne({ openid });
  if (!user) {
    const userData = {
      openid,
      unionid,
      user_type: 'member',
      member_status: 'registered',
      nick_name: '微信用户',
      exemption_count: 3,
    };
    if (storeId) userData.store_id = storeId;
    user = await User.create(userData);
  } else {
    // 已有用户：如果传了 store_id 且用户当前没有绑定门店，则更新
    if (storeId && !user.store_id) {
      user.store_id = storeId;
    }
    // 游客重新登录时，将状态恢复为 registered（待审核）
    if (user.member_status === 'guest') {
      user.member_status = 'registered';
    }
    await user.save();
  }

  // 3. 生成JWT token
  const token = generateToken(user);

  // 4. 返回token和用户信息
  return {
    token,
    user: {
      id: user._id,
      openid: user.openid,
      nick_name: user.nick_name,
      avatar_url: user.avatar_url,
      phone: user.phone,
      user_type: user.user_type,
      member_status: user.member_status,
      gender: user.gender,
      store_id: user.store_id,
    },
  };
};

// 管理端登录 - 账号密码验证
exports.adminLogin = async (username, password) => {
  if (!username || !password) {
    throw new Error('请输入账号和密码');
  }

  // 1. 查找用户
  const user = await User.findOne({ username });
  if (!user) {
    throw new Error('账号不存在');
  }

  // 2. 验证密码
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new Error('密码错误');
  }

  // 3. 检查用户类型和状态
  if (user.user_type === 'member') {
    throw new Error('该账号非管理端账号');
  }
  if (user.status === 'disabled') {
    throw new Error('账号已被禁用，请联系管理员');
  }

  // 4. 生成JWT token
  const token = generateToken(user);

  // 5. 返回token和用户信息
  return {
    token,
    user: {
      id: user._id,
      username: user.username,
      nick_name: user.nick_name,
      avatar_url: user.avatar_url,
      user_type: user.user_type,
      role: user.role,
      store_id: user.store_id,
      permissions: user.permissions || [],
    },
  };
};

// 获取当前用户信息
exports.getMe = async (userId) => {
  const user = await User.findById(userId)
    .select('-password -__v')
    .populate('store_id', 'name phone address');

  if (!user) {
    throw new Error('用户不存在');
  }
  return user;
};

// 修改密码
exports.changePassword = async (userId, oldPassword, newPassword) => {
  if (!oldPassword || !newPassword) {
    throw new Error('请输入旧密码和新密码');
  }
  if (newPassword.length < 6) {
    throw new Error('新密码长度不能少于6位');
  }

  // 1. 查找用户
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('用户不存在');
  }

  // 2. 验证旧密码
  const isMatch = await user.comparePassword(oldPassword);
  if (!isMatch) {
    throw new Error('旧密码错误');
  }

  // 3. 更新新密码
  user.password = newPassword;
  await user.save();

  return { message: '密码修改成功' };
};
