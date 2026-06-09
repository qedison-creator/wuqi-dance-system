const mongoose = require('mongoose');

const mappingSchema = new mongoose.Schema({
  field_name: { type: String, default: '' },
  wx_field: { type: String, required: true },
  biz_field: { type: String, required: true },
  example_value: { type: String, default: '' }
}, { _id: true });

const templateFieldMappingSchema = new mongoose.Schema({
  template_key: { type: String, required: true, unique: true, index: true },
  template_title: { type: String, default: '' },
  template_name: { type: String, required: true },
  template_id: { type: String, default: '' },
  description: { type: String, default: '' },
  mappings: [mappingSchema]
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('TemplateFieldMapping', templateFieldMappingSchema);