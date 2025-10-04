const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['admin','member'], default: 'member' }
}, { _id: false });

const inviteSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true, lowercase: true },
  token: { type: String, required: true },
  status: { type: String, enum: ['pending','accepted','expired'], default: 'pending' },
  invitedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date }
}, { _id: true });

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, default: '' },
  // Optional planned timeline (YYYY-MM-DD strings for consistency with tasks/events)
  startDate: { type: String },
  dueDate: { type: String },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: { type: [memberSchema], default: [] },
  invites: { type: [inviteSchema], default: [] },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['active','archived'], default: 'active' }
}, { timestamps: true });

projectSchema.index({ name: 1, owner: 1 });

module.exports = mongoose.model('Project', projectSchema);