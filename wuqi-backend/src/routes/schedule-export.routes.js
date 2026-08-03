const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const { success, error } = require('../utils/response');
const ScheduleExportConfig = require('../models/ScheduleExportConfig');
const scheduleService = require('../services/schedule.service');

// 获取当前激活的背景图配置
router.get('/background', auth, storeFilter(), async (req, res, next) => {
  try {
    const config = await ScheduleExportConfig.findOne({ is_active: true }).sort({ updated_at: -1 });
    res.json(success(config, '获取背景图配置成功'));
  } catch (err) {
    next(err);
  }
});

// 获取所有背景图列表
router.get('/backgrounds', auth, storeFilter(), async (req, res, next) => {
  try {
    const list = await ScheduleExportConfig.find().sort({ created_at: -1 }).lean();
    res.json(success(list, '获取背景图列表成功'));
  } catch (err) {
    next(err);
  }
});

// 上传新背景图（设置URL为激活）
router.post('/background', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { background_url, background_name } = req.body;
    if (!background_url) {
      return res.status(400).json(error(400, '缺少 background_url 参数'));
    }

    // 将之前的激活记录设为非激活
    await ScheduleExportConfig.updateMany({ is_active: true }, { is_active: false });

    const config = await ScheduleExportConfig.create({
      background_url,
      background_name: background_name || '',
      is_active: true,
      created_by: req.user ? req.user._id : null,
    });

    res.json(success(config, '背景图设置成功'));
  } catch (err) {
    next(err);
  }
});

// 设置某背景图为激活
router.put('/background/:id/activate', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const config = await ScheduleExportConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json(error(404, '背景图不存在'));
    }

    await ScheduleExportConfig.updateMany({ is_active: true }, { is_active: false });
    config.is_active = true;
    await config.save();

    res.json(success(config, '激活成功'));
  } catch (err) {
    next(err);
  }
});

// 删除背景图
router.delete('/background/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const config = await ScheduleExportConfig.findById(req.params.id);
    if (!config) {
      return res.status(404).json(error(404, '背景图不存在'));
    }

    const wasActive = config.is_active;
    await ScheduleExportConfig.findByIdAndDelete(req.params.id);

    // 如果删除的是激活图，自动激活最新的一条
    if (wasActive) {
      const latest = await ScheduleExportConfig.findOne().sort({ created_at: -1 });
      if (latest) {
        latest.is_active = true;
        await latest.save();
      }
    }

    res.json(success(null, '删除成功'));
  } catch (err) {
    next(err);
  }
});

// 获取周课程表导出数据
router.get('/week-export', auth, storeFilter(), async (req, res, next) => {
  try {
    const { store_id, start_date, end_date } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json(error(400, '缺少 start_date 或 end_date 参数'));
    }

    const data = await scheduleService.getWeekExportData(store_id, start_date, end_date);

    // 获取当前激活的背景图
    const bgConfig = await ScheduleExportConfig.findOne({ is_active: true }).lean();
    data.background_url = bgConfig ? bgConfig.background_url : '';

    res.json(success(data, '获取周课程表数据成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
