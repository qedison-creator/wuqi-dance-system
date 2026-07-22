const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const preMemberService = require('../services/preMember.service');
const Store = require('../models/Store');
const { success, paginate } = require('../utils/response');
const { broadcastMemberCountUpdate } = require('../services/websocket.service');

// ========== 批量导入数据清洗 ==========

/**
 * 全角字符转半角
 */
function toHalfWidth(str) {
  return str.replace(/[\uFF01-\uFF5E]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).replace(/\u3000/g, ' ');
}

/**
 * 空值标记归一化
 */
function normalizeEmpty(input) {
  const emptyMarkers = /^(无|没有|n\/a|na|none|null|\/|-+|\.{2,}|——)$/i;
  return emptyMarkers.test(input) ? '' : input;
}

/**
 * 门店名称模糊匹配
 * 支持：精确匹配 / 去括号短名匹配 / 括号关键词匹配 / 包含匹配
 * 容错：全角/半角括号等价；输入"固戍店"或"福永店"等关键词也能匹配
 */
function cleanStoreName(input, storeMap) {
  if (!input) return input;

  // 0. 规范化括号：把半角括号统一成全角括号
  const normalizedInput = String(input).replace(/\(/g, '（').replace(/\)/g, '）').trim();

  // 1. 精确匹配（最高优先级）
  if (storeMap[normalizedInput]) return normalizedInput;
  if (storeMap[input]) return input;

  const names = Object.keys(storeMap);
  if (names.length === 0) return input;

  const inputHasBracket = /[（(].+?[）)]/.test(normalizedInput);

  // 2. 括号内关键词匹配（如"固戍" / "固戍店" 匹配"舞栖舞蹈社（固戍店）"）
  if (!inputHasBracket) {
    for (const fullName of names) {
      const bracketMatch = fullName.match(/[（(](.+?)[）)]/);
      if (bracketMatch) {
        const keyword = bracketMatch[1];
        // 互相包含即可匹配："固戍店"含"固戍"，"固戍"也含在"固戍店"里
        if (keyword && (normalizedInput.includes(keyword) || keyword.includes(normalizedInput))) return fullName;
      }
    }
    // 3. 去括号短名匹配（如"舞栖"匹配"舞栖舞蹈社（固戍店）"）
    for (const fullName of names) {
      const shortName = fullName.replace(/[（(].*?[）)]/, '').trim();
      if (shortName && (normalizedInput === shortName || normalizedInput.includes(shortName) || shortName.includes(normalizedInput))) {
        return fullName;
      }
    }
  }

  // 4. 短名包含匹配（如"舞栖"匹配"舞栖舞蹈社（固戍店）"）
  if (!inputHasBracket) {
    for (const fullName of names) {
      if (fullName.includes(normalizedInput)) return fullName;
    }
  }

  return input;
}

/**
 * 手机号标准化
 */
function cleanPhone(input) {
  if (!input) return input;
  let cleaned = input.replace(/\D/g, '');
  if (cleaned.startsWith('86') && cleaned.length > 11) cleaned = cleaned.slice(2);
  if (/^1[3-9]\d{9}$/.test(cleaned)) return cleaned;
  return input;
}

/**
 * 性别智能映射
 */
function cleanGender(input) {
  if (!input) return input;
  const lower = input.toLowerCase();
  const map = {
    '男': ['男性', '先生', 'm', 'male', '1'],
    '女': ['女性', '女士', 'f', 'female', '2', '0'],
  };
  for (const [target, aliases] of Object.entries(map)) {
    if (aliases.includes(lower)) return target;
  }
  return input;
}

/**
 * 日期多格式解析 → YYYY-MM-DD
 */
function cleanDate(input) {
  if (!input) return input;
  const pad = (n) => String(Number(n)).padStart(2, '0');

  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  let m = input.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // YYYY年MM月DD日
  m = input.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // MM月DD日（补今年）
  m = input.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${pad(m[1])}-${pad(m[2])}`;
  }

  // MM-DD / MM/DD（补今年）
  m = input.match(/^(\d{1,2})[-\/.](\d{1,2})$/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${pad(m[1])}-${pad(m[2])}`;
  }

  // Excel 日期序列号（5位整数，范围约 30000-60000 对应 1982-2064）
  m = input.match(/^(\d{5})$/);
  if (m) {
    const serial = parseInt(m[1], 10);
    if (serial >= 30000 && serial <= 60000) {
      const date = new Date((serial - 25569) * 86400 * 1000);
      if (!isNaN(date.getTime())) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      }
    }
  }

  return input;
}

/**
 * 套餐类型智能映射
 */
function cleanPackageType(input) {
  if (!input) return input;
  const lower = input.toLowerCase();
  const map = {
    '次卡':   ['计次', 'count', 'count_card'],
    '时间卡': ['计时', 'time', 'time_card'],
  };
  for (const [target, aliases] of Object.entries(map)) {
    if (aliases.includes(lower)) return target;
  }
  return input;
}

/**
 * 周期限制方式智能映射
 */
function cleanPeriodType(input) {
  if (!input) return input;
  const lower = input.toLowerCase();
  const map = {
    '每日限制': ['每天', '每日', '日', 'daily', 'day'],
    '每周限制': ['每周', '周', 'weekly', 'week'],
    '无限次':   ['无限', '不限', '不限制', '无限制', 'unlimited', 'all'],
  };
  for (const [target, aliases] of Object.entries(map)) {
    if (aliases.includes(lower)) return target;
  }
  return input;
}

/**
 * 数字标准化（去除非数字字符）
 */
function cleanNumber(input) {
  if (!input) return '';
  const cleaned = String(input).replace(/[^\d.]/g, '');
  return cleaned === '.' ? '' : cleaned;
}

/**
 * 单行数据清洗（在 service 校验前调用）
 */
function cleanImportRow(row, storeMap) {
  // 通用预处理：全角转半角 → 空值归一化 → 去首尾空格
  const pre = (val) => {
    if (val === null || val === undefined) return '';
    return normalizeEmpty(toHalfWidth(String(val)).trim());
  };

  return {
    _rowNum: row._rowNum,
    store_name: cleanStoreName(pre(row.store_name), storeMap),
    real_name: pre(row.real_name),
    reserve_phone: cleanPhone(pre(row.reserve_phone)),
    gender: cleanGender(pre(row.gender)),
    package_type: cleanPackageType(pre(row.package_type)),
    start_date: cleanDate(pre(row.start_date)),
    end_date: cleanDate(pre(row.end_date)),
    total_credits: cleanNumber(pre(row.total_credits)),
    period_type: cleanPeriodType(pre(row.period_type)),
    period_count: cleanNumber(pre(row.period_count)),
    extra_store_names: pre(row.extra_store_names),
    remark: pre(row.remark)
  };
}

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
      ['序号', '门店名称', '会员姓名', '预留手机号', '性别', '套餐类型', '有效期开始日期', '有效期结束日期', '次卡总次数', '时间卡周期限制方式', '时间卡限制次数', '附加门店（用逗号分隔）', '备注'],
      [1, '舞栖舞蹈社（固戍店）', '张三', '13800138000', '女', '次卡', '2026-01-01', '2027-01-01', '41', '', '', '', '示例数据'],
      [2, '舞栖舞蹈社（福永店）', '李四', '13900139000', '男', '时间卡', '2026-01-01', '2027-01-01', '', '每周限制', '2', '舞栖舞蹈社（固戍店）', '跨店示例'],
      [3, '舞栖舞蹈社（固戍店）', '王五', '13700137000', '女', '时间卡', '2026-01-01', '2027-01-01', '', '无限次', '', '', '时间卡不限示例'],
      [4, '舞栖舞蹈社（固戍店）', '赵六', '13600136000', '男', '', '', '', '', '', '', '', '未录套餐示例']
    ];

    const ws = xlsx.utils.aoa_to_sheet(templateData);
    // 设置列宽
    ws['!cols'] = [
      { wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 6 },
      { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 28 }, { wch: 20 }
    ];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '预建档导入模板');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    // 文件名：舞栖Dance会员名单_YYYY-MM-DD_HHmmss.xlsx（含时间避免同日多次下载冲突）
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const fileName = `舞栖Dance会员名单_${dateStr}_${timeStr}.xlsx`;
    // 中文文件名用 RFC 5987 编码，避免乱码
    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
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
    broadcastMemberCountUpdate();
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
    broadcastMemberCountUpdate();
    res.json(success(null, '预建档删除成功'));
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

// POST /api/v1/pre-members/batch-delete - 批量删除预建档
router.post('/batch-delete', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    const result = await preMemberService.batchDeletePreMembers(ids);
    broadcastMemberCountUpdate();
    const msg = result.failed.length === 0
      ? `成功删除${result.deleted}条记录`
      : `成功删除${result.deleted}条，${result.failed.length}条不可删除`;
    res.json(success(result, msg));
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
    const expectedHeaders = ['序号', '门店名称', '会员姓名', '预留手机号', '性别', '套餐类型', '有效期开始日期', '有效期结束日期', '次卡总次数', '时间卡周期限制方式', '时间卡限制次数', '附加门店（用逗号分隔）', '备注'];
    const headers = rawRows[0].map(h => String(h).trim());

    // 表头校验：列数必须匹配，且每列表头名称必须一致
    if (headers.length !== expectedHeaders.length) {
      return res.status(400).json({
        code: 400,
        message: `表头列数不匹配：期望 ${expectedHeaders.length} 列，实际 ${headers.length} 列。请使用下载的标准模板填写数据。`
      });
    }
    for (let i = 0; i < expectedHeaders.length; i++) {
      if (headers[i] !== expectedHeaders[i]) {
        return res.status(400).json({
          code: 400,
          message: `表头第 ${i + 1} 列不匹配：期望「${expectedHeaders[i]}」，实际「${headers[i]}」。请使用下载的标准模板填写数据。`
        });
      }
    }

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
        extra_store_names: String(rawRow[11] || '').trim(), // 附加门店（用逗号分隔）
        remark: String(rawRow[12] || '').trim()
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ code: 400, message: '文件无有效数据行' });
    }

    // 加载门店列表用于数据清洗（门店名称模糊匹配）
    const stores = await Store.find({ status: 'active' }).select('_id name').lean();
    const storeMap = {};
    stores.forEach(s => { storeMap[s.name] = s._id; });

    // 数据清洗：自动纠正常见的格式偏差
    const cleanedRows = rows.map(row => cleanImportRow(row, storeMap));

    // 调用 service 执行校验和导入
    const results = await preMemberService.importPreMembers(cleanedRows, req.user.id);
    broadcastMemberCountUpdate();
    res.json(success(results, results.failed === 0 ? '导入成功' : '存在校验失败的数据'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
