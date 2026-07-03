const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const User = require('../models/User');
const Config = require('../models/Config');
const { success, paginate } = require('../utils/response');

const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: {
    name: '超级管理员',
    desc: '拥有所有权限',
    permissions: ['*'],
  },
  store_manager: {
    name: '店长',
    desc: '门店全权管理',
    permissions: ['dashboard', 'schedule', 'booking', 'checkin', 'member', 'member_review', 'pre_member', 'coach', 'salary', 'package_log', 'waitlist', 'holiday', 'banner', 'image', 'announcement', 'store', 'exemption', 'account', 'config', 'log'],
  },
  staff: {
    name: '员工',
    desc: '日常运营',
    permissions: ['dashboard', 'schedule', 'booking', 'checkin', 'member', 'member_review', 'pre_member', 'waitlist'],
  },
  reviewer: {
    name: '审核员',
    desc: '微信审核专用只读账号，可查看所有页面，数据已脱敏',
    permissions: ['*'],
  },
};

// GET /api/v1/accounts - 获取子账号列表
router.get('/', auth, checkModulePermission('account'), async (req, res, next) => {
  try {
    const { status, keyword, page = 1, pageSize = 20 } = req.query;
    const filter = {
      user_type: { $in: ['admin', 'staff'] },
    };

    if (status) filter.status = status;
    if (keyword) {
      filter.$or = [
        { username: { $regex: keyword, $options: 'i' } },
        { nick_name: { $regex: keyword, $options: 'i' } },
      ];
    }

    const list = await User.find(filter)
      .select('-password -openid -unionid -__v')
      .populate('store_id', 'name')
      .populate('store_ids', 'name')
      .sort({ created_at: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));

    const total = await User.countDocuments(filter);
    res.json(success(paginate(list, total, page, pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/accounts/roles - 获取角色权限配置
router.get('/roles', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    let config = await Config.findOne({ key: 'role_permissions' });
    let rolePermissions = config ? config.value : DEFAULT_ROLE_PERMISSIONS;

    const roles = Object.keys(rolePermissions).map(key => ({
      id: key,
      name: rolePermissions[key].name,
      desc: rolePermissions[key].desc,
      permissions: rolePermissions[key].permissions,
    }));

    res.json(success(roles));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/accounts/permission-modules - 获取权限模块列表
router.get('/permission-modules', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const modules = [
      { id: 'dashboard', name: '工作台', desc: '首页数据概览、待办事项' },
      { id: 'schedule', name: '排课管理', desc: '排课设置、模板管理、课程浏览' },
      { id: 'booking', name: '预约管理', desc: '预约汇总、预约名单、取消预约' },
      { id: 'checkin', name: '签到管理', desc: '会员签到、扫码签到、临时签到' },
      { id: 'member', name: '会员管理', desc: '会员信息、套餐管理、会员详情' },
      { id: 'member_review', name: '会员审核', desc: '待审核、手机号审核、信息修改审核' },
      { id: 'pre_member', name: '预建档管理', desc: '预建档列表、批量导入' },
      { id: 'coach', name: '教练管理', desc: '教练信息、舞种管理' },
      { id: 'salary', name: '薪酬管理', desc: '课时统计、薪酬配置、薪酬统计' },
      { id: 'package_log', name: '套餐记录', desc: '套餐激活/延长/录入记录查看' },
      { id: 'waitlist', name: '候补管理', desc: '候补排队、转正、移除' },
      { id: 'holiday', name: '放假管理', desc: '门店放假安排' },
      { id: 'banner', name: '轮播图管理', desc: '首页轮播图配置' },
      { id: 'image', name: '画面管理', desc: '此间画面图片作品管理' },
      { id: 'announcement', name: '公告管理', desc: '门店公告配置' },
      { id: 'store', name: '门店管理', desc: '门店维护、预约开放设置' },
      { id: 'exemption', name: '豁免设置', desc: '豁免次数配置' },
      { id: 'account', name: '账号管理', desc: '子账号、角色权限配置' },
      { id: 'config', name: '系统配置', desc: '系统参数、消息推送、首页背景' },
      { id: 'log', name: '操作日志', desc: '操作日志查看' },
    ];
    res.json(success(modules));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/accounts/roles/:roleId - 更新角色权限
router.put('/roles/:roleId', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const { roleId } = req.params;
    const { name, desc, permissions } = req.body;

    if (!['super_admin', 'store_manager', 'staff', 'reviewer'].includes(roleId)) {
      throw new Error('无效的角色ID');
    }

    let config = await Config.findOne({ key: 'role_permissions' });
    let rolePermissions = config ? config.value : { ...DEFAULT_ROLE_PERMISSIONS };

    if (!rolePermissions[roleId]) {
      rolePermissions[roleId] = { name, desc, permissions };
    } else {
      if (name) rolePermissions[roleId].name = name;
      if (desc !== undefined) rolePermissions[roleId].desc = desc;
      if (permissions) rolePermissions[roleId].permissions = permissions;
    }

    if (config) {
      config.value = rolePermissions;
      await config.save();
    } else {
      await Config.create({ key: 'role_permissions', value: rolePermissions, category: 'permission' });
    }

    if (permissions && roleId !== 'super_admin') {
      await User.updateMany(
        { role: roleId, user_type: { $in: ['admin', 'staff'] } },
        { $set: { permissions } }
      );
    }

    res.json(success({
      id: roleId,
      ...rolePermissions[roleId],
    }, '角色权限更新成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounts - 新增子账号
router.post('/', auth, checkModulePermission('account'), async (req, res, next) => {
  try {
    const { username, password, nick_name, role, store_ids } = req.body;

    if (!username) throw new Error('账号名不能为空');
    if (!password) throw new Error('密码不能为空');
    if (password.length < 6) throw new Error('密码长度不能少于6位');

    const currentRole = req.user.role;
    if (currentRole === 'store_manager' && role !== 'staff') {
      throw new Error('店长只能创建员工账号');
    }
    if (!role || !['store_manager', 'staff', 'reviewer'].includes(role)) {
      throw new Error('角色必须为manager、staff或reviewer');
    }
    if (role === 'reviewer' && currentRole !== 'super_admin') {
      throw new Error('只有超级管理员可以创建审核账号');
    }

    const existing = await User.findOne({ username });
    if (existing) throw new Error('账号名已存在');

    let permissions = [];
    if (role !== 'super_admin') {
      let config = await Config.findOne({ key: 'role_permissions' });
      let rolePermissions = config ? config.value : DEFAULT_ROLE_PERMISSIONS;
      if (rolePermissions[role]) {
        permissions = rolePermissions[role].permissions;
      } else if (DEFAULT_ROLE_PERMISSIONS[role]) {
        permissions = DEFAULT_ROLE_PERMISSIONS[role].permissions;
      }
    }

    const account = await User.create({
      username,
      password,
      nick_name: nick_name || username,
      user_type: role === 'store_manager' ? 'admin' : 'staff',
      role,
      store_ids: role === 'reviewer' ? [] : (store_ids || []),
      permissions,
      status: 'active',
    });

    const accountData = account.toObject();
    delete accountData.password;

    res.json(success(accountData, '创建账号成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/accounts/:id - 编辑子账号
router.put('/:id', auth, checkModulePermission('account'), async (req, res, next) => {
  try {
    const account = await User.findById(req.params.id);
    if (!account) throw new Error('账号不存在');
    if (account.user_type === 'member') throw new Error('不能编辑会员账号');

    const currentRole = req.user.role;
    if (currentRole === 'store_manager') {
      if (account.role !== 'staff') {
        throw new Error('店长只能编辑员工账号');
      }
      if (req.user.id === req.params.id) {
        throw new Error('不能编辑自己的账号');
      }
    }

    const { nick_name, role, store_ids } = req.body;
    if (nick_name) account.nick_name = nick_name;
    if (store_ids !== undefined) account.store_ids = store_ids;
    if (currentRole === 'super_admin' && role) {
      account.role = role;
      account.user_type = role === 'store_manager' ? 'admin' : 'staff';
      if (role === 'reviewer') {
        account.store_ids = [];
      }

      if (role !== 'super_admin') {
        let config = await Config.findOne({ key: 'role_permissions' });
        let rolePermissions = config ? config.value : DEFAULT_ROLE_PERMISSIONS;
        if (rolePermissions[role]) {
          account.permissions = rolePermissions[role].permissions;
        } else if (DEFAULT_ROLE_PERMISSIONS[role]) {
          account.permissions = DEFAULT_ROLE_PERMISSIONS[role].permissions;
        }
      }
    }

    await account.save();
    const accountData = account.toObject();
    delete accountData.password;

    res.json(success(accountData, '编辑账号成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/accounts/:id/status - 启用/禁用账号
router.put('/:id/status', auth, checkModulePermission('account'), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status || !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ code: 400, message: 'status必须为active或disabled', data: null });
    }

    const account = await User.findById(req.params.id);
    if (!account) throw new Error('账号不存在');
    if (account.user_type === 'member') throw new Error('不能操作会员账号');

    if (req.user.id === req.params.id) {
      throw new Error('不能禁用自己的账号');
    }

    const currentRole = req.user.role;
    if (currentRole === 'store_manager' && account.role !== 'staff') {
      throw new Error('店长只能操作员工账号');
    }

    account.status = status;
    await account.save();

    const accountData = account.toObject();
    delete accountData.password;

    res.json(success(accountData, status === 'active' ? '启用账号成功' : '禁用账号成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/accounts/:id/reset-password - 重置密码
router.put('/:id/reset-password', auth, checkModulePermission('account'), async (req, res, next) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ code: 400, message: '新密码长度不能少于6位', data: null });
    }

    const account = await User.findById(req.params.id);
    if (!account) throw new Error('账号不存在');
    if (account.user_type === 'member') throw new Error('不能操作会员账号');

    const currentRole = req.user.role;
    if (currentRole === 'store_manager') {
      if (account.role !== 'staff') {
        throw new Error('店长只能重置员工密码');
      }
      if (req.user.id === req.params.id) {
        throw new Error('不能重置自己的密码，请使用修改密码功能');
      }
    }

    account.password = new_password;
    await account.save();

    res.json(success(null, '密码重置成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/accounts/:id - 删除账号
router.delete('/:id', auth, checkModulePermission('account'), async (req, res, next) => {
  try {
    const account = await User.findById(req.params.id);
    if (!account) throw new Error('账号不存在');
    if (account.user_type === 'member') throw new Error('不能删除会员账号');

    if (req.user.id === req.params.id) {
      throw new Error('不能删除自己的账号');
    }

    const currentRole = req.user.role;
    if (currentRole === 'store_manager' && account.role !== 'staff') {
      throw new Error('店长只能删除员工账号');
    }

    await User.findByIdAndDelete(req.params.id);
    res.json(success(null, '删除账号成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
