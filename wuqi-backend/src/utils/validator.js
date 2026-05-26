const mongoose = require('mongoose');
const dayjs = require('dayjs');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const isRequired = (params, fields) => {
  const missing = [];
  for (const field of fields) {
    if (params[field] === undefined || params[field] === null || params[field] === '') {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    return { valid: false, missing };
  }
  return { valid: true };
};

const isValidDate = (dateStr) => {
  if (!dateStr) return false;
  const d = dayjs(dateStr);
  return d.isValid();
};

module.exports = { isValidObjectId, isRequired, isValidDate };
