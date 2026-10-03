const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  // 弹窗显示：none=不弹窗 normal=一般弹窗(进首页弹一次) important=重要弹窗(读秒3秒) always=永久弹窗
  popup_type: { type: String, enum: ['none', 'normal', 'important', 'always'], default: 'none' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Announcement', announcementSchema);