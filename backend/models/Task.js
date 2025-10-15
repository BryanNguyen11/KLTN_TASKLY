const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Optional project context
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  // Optional assignee (for group/project tasks); when absent, treated as self-assigned
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  date: { type: String, required: true }, // YYYY-MM-DD
  endDate: { type: String }, // optional end date YYYY-MM-DD
  startTime: { type: String, required: false }, // HH:mm
  endTime: { type: String, required: false }, // HH:mm
  time: { type: String, required: false }, // legacy single time (optional)
  priority: { type: String, enum: ['low','medium','high'], default: 'medium' },
  importance: { type: String, enum: ['low','medium','high'], default: 'medium' },
  urgency: { type: String, enum: ['low','medium','high'], default: 'medium' },
  type: { type: String, enum: ['personal','group'], default: 'personal' },
  estimatedHours: { type: Number, default: 1 },
  status: { type: String, enum: ['todo','in-progress','completed'], default: 'todo' },
  completedAt: { type: Date },
  tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag' }],
  subTasks: [{
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false }
  }],
  // reminders for push notifications
  reminders: [{
    at: { type: Date, required: true },
    sent: { type: Boolean, default: false }
  }],
  // optional repeat rule similar to events
  repeat: {
    frequency: { type: String, enum: ['daily','weekly','monthly','yearly'] },
    endMode: { type: String, enum: ['never','onDate','after'] },
    endDate: { type: String },
    count: { type: Number },
  }
},{ timestamps:true });

// Virtual completionPercent based on subTasks
taskSchema.virtual('completionPercent').get(function(){
  if(!this.subTasks || this.subTasks.length===0) return this.status === 'completed' ? 100 : 0;
  const done = this.subTasks.filter(st => st.completed).length;
  return Math.round((done / this.subTasks.length) * 100);
});

taskSchema.set('toJSON', { virtuals:true });
taskSchema.set('toObject', { virtuals:true });

module.exports = mongoose.model('Task', taskSchema);
