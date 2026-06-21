const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const preMemberService = require('../services/preMember.service');
const { success, paginate } = require('../utils/response');

// Excel 文件上传配置
const excelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '../../uploads/imports');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `premember-import-${Date.now()}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx / .xls 格式文件'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }  // 10MB
});

// ========== 预建档管理接口 ==========

// GET /api/v1/pre-members/stats - 预建档数量统计
router.get('/stats', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const storeId = req.query.store_id || (req.user.role !== 'super_admin' ? req.user.store_id : null);
    const result = await preMemberService.getPreMemberStats(storeId);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pre-members/template - 下载导入模板（必须在 /:id 之前定义）
router.get('/template', auth, checkPermission(['super_admin', 'store_manager', 'staff']), (req, res, next) => {
  try {
    const xlsx = require('xlsx');
    const templateData = [
      ['序号', '门店名称', '会员姓名', '预留手机号', '性别', '套餐类型', '有效期开始日期', '有效期结束日期', '次卡总次数', '时间卡周期限制方式', '时间卡限制次数', '备注'],
      [1, '舞栖舞蹈社（固戍店）', '张三', '13800138000', '女', '次卡', '2026-01-01', '2027-01-01', '41', '', '', '示例数据'],
      [2, '舞栖舞蹈社（福永店）', '李四', '13900139000', '男', '时间卡', '2026-01-01', '2027-01-01', '', '每周限制', '2', '示例数据'],
      [3, '舞栖舞蹈社（固戍店）', '王五', '13700137000', '女', '时间卡', '2026-01-01', '2027-01-01', '', '无限次', '', '时间卡不限示例'],
      [4, '舞栖舞蹈社（固戍店）', '赵六', '13600136000', '男', '', '', '', '', '', '', '未录套餐示例']
    ];

    const ws = xlsx.utils.aoa_to_sheet(templateData);
    // 设置列宽
    ws['!cols'] = [
      { wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 6 },
      { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 20 }
    ];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '预建档导入模板');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="premember-import-template.xlsx"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pre-members - 预建档列表
router.get('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const result = await preMemberService.getPreMemberList(req.query);
    const paginatedData = paginate(result.list, result.total, result.page, result.pageSize);
    res.json(success(paginatedData));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pre-members/:id - 预建档详情
router.get('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const User = require('../models/User');
    const UserPackage = require('../models/UserPackage');
    const user = await User.findById(req.params.id)
      .populate('store_id', 'name')
      .lean();
    if (!user) {
      return res.status(404).json({ code: 404, message: '预建档记录不存在' });
    }
    const packages = await UserPackage.find({ user_id: user._id }).lean();
    user.packages = packages;
    user.has_package = packages.length > 0;
    res.json(success(user));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/pre-members - 新建预建档
router.post('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const user = await preMemberService.createPreMember(req.body, req.user.id);
    res.json(success(user, '预建档创建成功'));
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

// PUT /api/v1/pre-members/:id - 编辑预建档
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const user = await preMemberService.updatePreMember(req.params.id, req.body, req.user.id);
    res.json(success(user, '预建档更新成功'));
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

// DELETE /api/v1/pre-members/:id - 删除预建档
router.delete('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    await preMemberService.deletePreMember(req.params.id);
    res.json(success(null, '预建档删除成功'));
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

// POST /api/v1/pre-members/import - 批量导入预建档
router.post('/import', auth, checkPermission(['super_admin', 'store_manager', 'staff']), excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请上传 Excel 文件' });
    }

    const xlsx = require('xlsx');
    const filePath = req.file.path;

    // 解析 Excel 文件
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // 删除临时文件
    try { fs.unlinkSync(filePath); } catch (e) {}

    if (rawRows.length < 2) {
      return res.status(400).json({ code: 400, message: '文件无有效数据（至少需要表头 + 1 行数据）' });
    }

    // 表头映射（按列顺序）- 新模板：删除套餐名称列，拆分周期限制为两列
    const headers = rawRows[0].map(h => String(h).trim());
    const rows = [];
    for (let i = 1; i < rawRows.length; i++) {
      const rawRow = rawRows[i];
      // 跳过空行
      if (rawRow.every(cell => cell === '' || cell === null || cell === undefined)) continue;

      rows.push({
        _rowNum: i + 1,
        store_name: String(rawRow[1] || '').trim(),
        real_name: String(rawRow[2] || '').trim(),
        reserve_phone: String(rawRow[3] || '').trim(),
        gender: String(rawRow[4] || '').trim(),
        package_type: String(rawRow[5] || '').trim(),
        start_date: String(rawRow[6] || '').trim(),
        end_date: String(rawRow[7] || '').trim(),
        total_credits: String(rawRow[8] || '').trim(),
        period_type: String(rawRow[9] || '').trim(),   // 时间卡周期限制方式：每日限制/每周限制/无限次
        period_count: String(rawRow[10] || '').trim(), // 时间卡限制次数
        remark: String(rawRow[11] || '').trim()
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ code: 400, message: '文件无有效数据行' });
    }

    // 调用 service 执行校验和导入
    const results = await preMemberService.importPreMembers(rows, req.user.id);
    res.json(success(results, results.failed === 0 ? '导入成功' : '存在校验失败的数据'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
