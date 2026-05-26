const WeekTemplate = require('../models/WeekTemplate');
const logService = require('./log.service');

// 获取门店的星期模板
exports.getWeekTemplate = async (storeId) => {
  try {
    let template = await WeekTemplate.findOne({ store_id: storeId });
    
    if (!template) {
      // 如果没有模板，创建一个默认模板
      template = await WeekTemplate.create({
        store_id: storeId,
        template: {
          0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []
        }
      });
    }
    
    return template.toObject().template;
  } catch (err) {
    console.error('获取星期模板失败:', err);
    throw err;
  }
};

// 保存门店的星期模板
exports.saveWeekTemplate = async (storeId, templateData, operatorId) => {
  try {
    const validTemplate = {
      0: templateData[0] || [],
      1: templateData[1] || [],
      2: templateData[2] || [],
      3: templateData[3] || [],
      4: templateData[4] || [],
      5: templateData[5] || [],
      6: templateData[6] || []
    };

    const template = await WeekTemplate.findOneAndUpdate(
      { store_id: storeId },
      {
        template: validTemplate,
        updated_at: new Date()
      },
      { upsert: true, new: true }
    );

    try {
      let totalItems = 0;
      Object.values(validTemplate).forEach(arr => { totalItems += arr.length; });
      await logService.createLog({
        operator_id: operatorId || null,
        action: 'update',
        module: 'week_template',
        target_id: template._id,
        detail: `更新门店(${storeId})星期模板，共${totalItems}条排课项`,
      });
    } catch (logErr) {
      console.error('[WeekTemplate] 记录日志失败:', logErr.message);
    }

    return template.template;
  } catch (err) {
    console.error('保存星期模板失败:', err);
    throw err;
  }
};

// 更新特定星期的模板数据
exports.updateWeekdayTemplate = async (storeId, weekday, scheduleList, operatorId) => {
  try {
    let template = await WeekTemplate.findOne({ store_id: storeId });

    if (!template) {
      template = await WeekTemplate.create({
        store_id: storeId,
        template: {
          0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []
        }
      });
    }

    template.template[weekday] = scheduleList || [];
    template.updated_at = new Date();

    await template.save();

    try {
      await logService.createLog({
        operator_id: operatorId || null,
        action: 'update',
        module: 'week_template',
        target_id: template._id,
        detail: `更新门店(${storeId})星期${weekday}模板，${(scheduleList || []).length}条排课项`,
      });
    } catch (logErr) {
      console.error('[WeekTemplate] 记录日志失败:', logErr.message);
    }

    return template.template;
  } catch (err) {
    console.error('更新星期模板失败:', err);
    throw err;
  }
};

// 删除特定星期的模板数据
exports.deleteWeekdaySchedule = async (storeId, weekday, index, operatorId) => {
  try {
    const template = await WeekTemplate.findOne({ store_id: storeId });

    if (!template) {
      throw new Error('模板不存在');
    }

    let deletedItem = null;
    if (template.template[weekday] && Array.isArray(template.template[weekday])) {
      deletedItem = template.template[weekday][index];
      template.template[weekday].splice(index, 1);
      template.updated_at = new Date();
      await template.save();
    }

    try {
      await logService.createLog({
        operator_id: operatorId || null,
        action: 'delete',
        module: 'week_template',
        target_id: template._id,
        detail: `删除门店(${storeId})星期${weekday}第${index}条排课: ${(deletedItem && deletedItem.course_name) || ''}`,
      });
    } catch (logErr) {
      console.error('[WeekTemplate] 记录日志失败:', logErr.message);
    }

    return template.template;
  } catch (err) {
    console.error('删除模板排课失败:', err);
    throw err;
  }
};
