const router = require('express').Router();
const auth = require('../middleware/auth');
const { checkModulePermission } = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const coachSalaryService = require('../services/coach-salary.service');
const { success, paginate, error } = require('../utils/response');

// 教练薪酬配置相关路由

// 审核员全量禁止访问薪酬数据（商业秘密隔离）
// 注意：auth 在此先行执行（各路由内的 auth 重复校验无害），确保拦截时 req.user 已就绪
router.use(auth, (req, res, next) => {
  if (req.user && req.user.role === 'reviewer') {
    return res.status(403).json(error(403, '审核员无权访问薪酬数据'));
  }
  next();
});

// GET /api/v1/coach-salaries - 获取薪酬配置列表
router.get('/', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getCoachSalaryList(req.query, req.user);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/:id - 获取薪酬配置详情
router.get('/:id', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const salary = await coachSalaryService.getCoachSalaryById(req.params.id, req.user);
    res.json(success(salary));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/coach-salaries - 创建薪酬配置
router.post('/', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const salary = await coachSalaryService.createCoachSalary(req.body, req.user.id, req.user);
    res.json(success(salary, '创建薪酬配置成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/coach-salaries/:id - 修改某一期单价（原地生效，该期已入账薪酬与账单按新单价重算）
router.put('/:id', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const salary = await coachSalaryService.updateCoachSalary(req.params.id, req.body, req.user.id, req.user);
    res.json(success(salary, '更新薪酬配置成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/coach-salaries/:id - 删除某一期单价（该期无入账课程时允许，前一版自动衔接）
router.delete('/:id', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const result = await coachSalaryService.deleteCoachSalary(req.params.id, req.user.id, req.user);
    res.json(success(result, '删除薪酬配置成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/coach-salaries/batch-delete - 批量删除薪酬配置（删除整教练配置）
router.post('/batch-delete', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const result = await coachSalaryService.batchDeleteCoachSalary(ids, req.user.id, req.user);
    res.json(success(result, result.failedCount === 0 ? '删除成功' : `部分删除失败（${result.failedCount}条）`));
  } catch (err) {
    next(err);
  }
});

// 教练课时统计 / 薪酬统计相关路由

// GET /api/v1/coach-salaries/stats/class-hours - 课时统计（按年，按月/教练/门店分组）
router.get('/stats/class-hours', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getClassHoursStats(req.query, req.user);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/class-hours/detail - 课时统计逐课明细（展开教练卡片时懒加载）
router.get('/stats/class-hours/detail', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getClassHoursDetail(req.query, req.user);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/monthly-salary - 月度薪酬明细（上课事实 × 按上课日期解析的费率）
router.get('/stats/monthly-salary', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getMonthlySalaryBreakdown(req.query, req.user);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/rate-gaps - 课时单价空档检测（有课但该时期未配置单价）
router.get('/stats/rate-gaps', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getRateGaps(req.query, req.user);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/bills - 获取账单列表
router.get('/stats/bills', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getBillList(req.query, req.user);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/bills/:id - 获取账单详情
router.get('/stats/bills/:id', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const bill = await coachSalaryService.getBillDetail(req.params.id, req.user);
    res.json(success(bill));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/coach-salaries/stats/bills/:id - 删除账单（作废名下全部课薪台账）
router.delete('/stats/bills/:id', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    await coachSalaryService.deleteBill(req.params.id, req.user);
    res.json(success(null, '账单已删除，对应课时已恢复为未入账状态'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/coach-salaries/stats/generate - 生成薪酬账单（预览/正式，逐课写台账）
router.post('/stats/generate', auth, checkModulePermission('salary'), storeFilter(), async (req, res, next) => {
  try {
    const { start_date, end_date, preview } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({ code: 400, message: '缺少必要参数（start_date/end_date）', data: null });
    }
    if (start_date > end_date) {
      return res.status(400).json({ code: 400, message: '开始日期不能大于结束日期', data: null });
    }

    const coachIds = req.body.coach_ids || null;
    const storeId = req.body.store_id || null;
    const result = await coachSalaryService.generateSalaryBill(start_date, end_date, preview || false, req.user.id, coachIds, req.user, storeId);
    res.json(success(result, preview ? '生成预览成功' : '生成账单成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
