const express = require('express');
const router = express.Router();
const weekTemplateService = require('../services/week-template.service');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');

router.get('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res) => {
  try {
    const { store_id } = req.query;
    if (!store_id) {
      return res.status(400).json({ code: 400, message: '缺少门店ID' });
    }

    const template = await weekTemplateService.getWeekTemplate(store_id);
    res.json({ code: 200, data: template });
  } catch (err) {
    console.error('获取星期模板失败:', err);
    res.status(500).json({ code: 500, message: '获取星期模板失败', error: err.message });
  }
});

router.post('/', auth, checkPermission(['super_admin', 'store_manager']), async (req, res) => {
  try {
    const { store_id, template } = req.body;
    if (!store_id || !template) {
      return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }

    const savedTemplate = await weekTemplateService.saveWeekTemplate(store_id, template, req.user.id);
    res.json({ code: 200, data: savedTemplate });
  } catch (err) {
    console.error('保存星期模板失败:', err);
    res.status(500).json({ code: 500, message: '保存星期模板失败', error: err.message });
  }
});

router.put('/weekday', auth, checkPermission(['super_admin', 'store_manager']), async (req, res) => {
  try {
    const { store_id, weekday, schedules } = req.body;
    if (!store_id || weekday === undefined || schedules === undefined) {
      return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }

    const template = await weekTemplateService.updateWeekdayTemplate(store_id, weekday, schedules, req.user.id);
    res.json({ code: 200, data: template });
  } catch (err) {
    console.error('更新星期模板失败:', err);
    res.status(500).json({ code: 500, message: '更新星期模板失败', error: err.message });
  }
});

router.delete('/weekday', auth, checkPermission(['super_admin', 'store_manager']), async (req, res) => {
  try {
    const { store_id, weekday, index } = req.query;
    if (!store_id || weekday === undefined || index === undefined) {
      return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }

    const template = await weekTemplateService.deleteWeekdaySchedule(store_id, parseInt(weekday), parseInt(index), req.user.id);
    res.json({ code: 200, data: template });
  } catch (err) {
    console.error('删除模板排课失败:', err);
    res.status(500).json({ code: 500, message: '删除模板排课失败', error: err.message });
  }
});

module.exports = router;
