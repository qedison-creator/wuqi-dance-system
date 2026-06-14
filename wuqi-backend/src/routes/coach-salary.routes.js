const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const coachSalaryService = require('../services/coach-salary.service');
const { success, paginate } = require('../utils/response');

// 教练薪酬配置相关路由

// GET /api/v1/coach-salaries - 获取薪酬配置列表
router.get('/', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getCoachSalaryList(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/:id - 获取薪酬配置详情
router.get('/:id', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const salary = await coachSalaryService.getCoachSalaryById(req.params.id);
    res.json(success(salary));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/coach-salaries - 创建薪酬配置
router.post('/', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const salary = await coachSalaryService.createCoachSalary(req.body, req.user.id);
    res.json(success(salary, '创建薪酬配置成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/coach-salaries/:id - 更新薪酬配置
router.put('/:id', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const salary = await coachSalaryService.updateCoachSalary(req.params.id, req.body, req.user.id);
    res.json(success(salary, '更新薪酬配置成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/coach-salaries/:id - 删除薪酬配置
router.delete('/:id', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const result = await coachSalaryService.deleteCoachSalary(req.params.id, req.user.id);
    res.json(success(result, '删除薪酬配置成功'));
  } catch (err) {
    next(err);
  }
});

// 教练薪酬统计相关路由

// GET /api/v1/coach-salaries/stats/monthly - 获取薪酬按月聚合（旧，基于CoachSalaryStat）
router.get('/stats/monthly', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getSalaryMonthlyStats(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/bills - 获取账单列表
router.get('/stats/bills', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getBillList(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/bills/:id - 获取账单详情
router.get('/stats/bills/:id', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const bill = await coachSalaryService.getBillDetail(req.params.id);
    res.json(success(bill));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/coach-salaries/stats/bills/:id - 删除账单
router.delete('/stats/bills/:id', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    await coachSalaryService.deleteBill(req.params.id);
    res.json(success(null, '账单已删除'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/monthly-salary - 获取月度薪酬明细（基于实际上课数据 × 薪酬配置）
router.get('/stats/monthly-salary', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getMonthlySalaryBreakdown(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/class-hours - 获取课时统计（按月份分组）
router.get('/stats/class-hours', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getClassHoursStats(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/list - 获取薪酬统计列表
router.get('/stats/list', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const result = await coachSalaryService.getCoachSalaryStats(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coach-salaries/stats/summary - 获取薪酬汇总
router.get('/stats/summary', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const summary = await coachSalaryService.getSalarySummary(req.query);
    res.json(success(summary));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/coach-salaries/stats/generate - 生成薪酬统计（支持单个排课和批量生成账单）
router.post('/stats/generate', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const { schedule_id, start_date, end_date, preview } = req.body;
    
    if (start_date && end_date) {
      const coachIds = req.body.coach_ids || null;
      const result = await coachSalaryService.generateSalaryBill(start_date, end_date, preview || false, req.user.id, coachIds);
      res.json(success(result, preview ? '生成预览成功' : '生成账单成功'));
    } else if (schedule_id) {
      const stat = await coachSalaryService.createSalaryStat(schedule_id, req.user.id);
      res.json(success(stat, '生成薪酬统计成功'));
    } else {
      return res.status(400).json({ code: 400, message: '缺少必要参数', data: null });
    }
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/coach-salaries/stats/:id/settle - 结算薪酬
router.put('/stats/:id/settle', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const { remark } = req.body;
    const stat = await coachSalaryService.settleSalary(req.params.id, req.user.id, remark);
    res.json(success(stat, '结算薪酬成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/coach-salaries/stats/:id/cancel - 取消薪酬统计
router.put('/stats/:id/cancel', auth, checkModulePermission('salary'), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const stat = await coachSalaryService.cancelSalaryStat(req.params.id, req.user.id, reason);
    res.json(success(stat, '取消薪酬统计成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;