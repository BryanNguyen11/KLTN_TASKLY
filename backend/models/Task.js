const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  date: { type: String, required: true }, // YYYY-MM-DD
  endDate: { type: String }, // optional end date YYYY-MM-DD
  startTime: { type: String, required: false }, // HH:mm
  endTime: { type: String, required: false }, // HH:mm
  time: { type: String, required: false }, // legacy single time (optional)
  priority: { type: String, enum: ['low','medium','high'], default: 'medium' },
  importance: { type: String, enum: ['low','medium','high'], default: 'medium' },
  type: { type: String, enum: ['personal','group'], default: 'personal' },
  estimatedHours: { type: Number, default: 1 },
  status: { type: String, enum: ['todo','in-progress','completed'], default: 'todo' },
  completedAt: { type: Date },
  tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag' }]
},{ timestamps:true });

module.exports = mongoose.model('Task', taskSchema);
