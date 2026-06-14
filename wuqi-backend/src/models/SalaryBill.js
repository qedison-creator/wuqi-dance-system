const mongoose = require('mongoose');

const salaryBillSchema = new mongoose.Schema({
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  coaches: [{
    coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Coach', required: true },
    coach_name: { type: String },
    items: [{
      duration: { type: Number },
      count: { type: Number },
      rate: { type: Number },
      amount: { type: Number }
    }],
    total_amount: { type: Number }
  }],
  total_amount: { type: Number, default: 0 },
  coach_count: { type: Number, default: 0 },
  generated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  created_at: { type: Date, default: Date.now }
});

salaryBillSchema.index({ created_at: -1 });
salaryBillSchema.index({ start_date: 1, end_date: 1 });

module.exports = mongoose.model('SalaryBill', salaryBillSchema);
