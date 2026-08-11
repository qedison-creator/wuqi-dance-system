const express = require('express');
const router = express.Router();
const weekTemplateService = require('../services/week-template.service');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const contentSecurityService = require('../services/content-security.service');

// 从模板对象中提取所有 course_name 并拼接（用于内容安全批量检测）
function extractCourseNamesFromTemplate(template) {
  if (!template || typeof template !== 'object') return '';
  const names = [];
  // 模板结构：{ weekdays: [{ schedules: [{ course_name }] }] } 或类似结构
  const weekdays = template.weekdays || template.weekday_schedules || [];
  if (Array.isArray(weekdays)) {
    weekdays.forEach(day => {
      const schedules = day.schedules || day.items || [];
      if (Array.isArray(schedules)) {
        schedules.forEach(s => {
          if (s.course_name) names.push(String(s.course_name));
        });
      }
    });
  }
  return names.join(' ');
}

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

    // 文本内容安全检测：检查模板中所有课程名称
    const allNames = extractCourseNamesFromTemplate(template);
    if (allNames) {
      const textResult = await contentSecurityService.checkText(allNames, 'member');
      if (!textResult.safe) {
        return res.status(200).json({
          code: 'CONTENT_UNSAFE',
          message: '课程信息含违规内容，请修改后重新提交',
          data: null
        });
      }
    }

    const savedTemplate = await weekTemplateService.saveWeekTemplate(store_id, template, req.user.id);
    res.json({ code: 200, data: savedTemplate });
  } catch (err) {
    console.error('保存星期模板失败:', err);
    res.status(500).json({ code: 500, message: '保存星期模板失败', error: err.message });
  }
});

router.put('/weekday', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), async (req, res) => {
  try {
    const { store_id, weekday, schedules } = req.body;
    if (!store_id || weekday === undefined || schedules === undefined) {
      return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }

    // 文本内容安全检测：检查 schedules 中所有课程名称
    const allNames = Array.isArray(schedules)
      ? schedules.map(s => s.course_name).filter(n => n && String(n).trim()).join(' ')
      : '';
    if (allNames) {
      const textResult = await contentSecurityService.checkText(allNames, 'member');
      if (!textResult.safe) {
        return res.status(200).json({
          code: 'CONTENT_UNSAFE',
          message: '课程信息含违规内容，请修改后重新提交',
          data: null
        });
      }
    }

    const template = await weekTemplateService.updateWeekdayTemplate(store_id, weekday, schedules, req.user.id);
    res.json({ code: 200, data: template });
  } catch (err) {
    console.error('更新星期模板失败:', err);
    res.status(500).json({ code: 500, message: '更新星期模板失败', error: err.message });
  }
});

router.delete('/weekday', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), async (req, res) => {
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
