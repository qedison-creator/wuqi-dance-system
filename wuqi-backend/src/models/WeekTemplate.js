const mongoose = require('mongoose');

const weekTemplateSchema = new mongoose.Schema({
  store_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true
  },
  // 星期模板数据，键为星期数字(0=周日,1=周一,...,6=周六)，值为课程数组
  template: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      0: [], // 周日
      1: [], // 周一
      2: [], // 周二
      3: [], // 周三
      4: [], // 周四
      5: [], // 周五
      6: []  // 周六
    }
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// 确保每个门店只有一个模板
weekTemplateSchema.index({ store_id: 1 }, { unique: true });

module.exports = mongoose.model('WeekTemplate', weekTemplateSchema);
