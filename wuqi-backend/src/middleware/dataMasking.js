// 审核员数据脱敏中间件
// 对 reviewer 角色的响应数据进行敏感字段脱敏

function maskName(name) {
  if (!name || typeof name !== 'string' || name.length === 0) return name;
  if (name.length === 1) return name;
  return name[0] + '*'.repeat(name.length - 1);
}

function maskPhone(phone) {
  if (!phone || typeof phone !== 'string' || phone.length < 7) return phone;
  return phone.substring(0, 3) + '****' + phone.substring(phone.length - 4);
}

function maskUsername(username) {
  if (!username || typeof username !== 'string' || username.length <= 2) return username;
  return username.substring(0, 2) + '*'.repeat(username.length - 2);
}

const MASKERS = {
  real_name: maskName,
  nick_name: maskName,
  phone: maskPhone,
  reserve_phone: maskPhone,
  wechat_phone: maskPhone,
  username: maskUsername,
};

function toStringId(id) {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (typeof id.toString === 'function') return id.toString();
  return String(id);
}

// 递归遍历数据，对敏感字段进行脱敏
// 注意：业务代码可能将 Mongoose Document 直接塞进响应（含 $__、_doc 循环引用），
// 需先转普通对象再递归，否则会栈溢出
function maskData(data, currentUserId) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map(item => maskData(item, currentUserId));
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    // Mongoose Document：先转普通对象
    if (typeof data.toObject === 'function' && data.$__) {
      data = data.toObject({ getters: false, virtuals: false });
    }
    // 只处理普通对象，跳过其他类实例（避免循环引用）
    const proto = Object.getPrototypeOf(data);
    if (proto !== null && proto !== Object.prototype) {
      return data;
    }
    // 当前登录用户自身的账号信息不脱敏
    const itemId = toStringId(data._id || data.id);
    const isSelf = currentUserId && itemId === currentUserId;
    const result = {};
    for (const key of Object.keys(data)) {
      if (!isSelf && MASKERS[key] && typeof data[key] === 'string') {
        result[key] = MASKERS[key](data[key]);
      } else {
        result[key] = maskData(data[key], currentUserId);
      }
    }
    return result;
  }
  // Date / ObjectId / 基础类型：原样返回
  return data;
}

const dataMasking = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    // 仅对 reviewer 角色脱敏，排除 /auth/ 路由（登录、个人信息不应脱敏）
    const isAuthRoute = req.path.startsWith('/auth/');
    if (req.user && req.user.role === 'reviewer' && !isAuthRoute && body && typeof body === 'object') {
      const currentUserId = toStringId(req.user._id || req.user.id);
      body = maskData(body, currentUserId);
    }
    return originalJson(body);
  };
  next();
};

module.exports = dataMasking;
