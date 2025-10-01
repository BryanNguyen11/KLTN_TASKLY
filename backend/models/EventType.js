const mongoose = require('mongoose');

const fieldSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: ['text', 'url'], default: 'text' },
  required: { type: Boolean, default: false },
}, { _id: false });

const eventTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true },
  isDefault: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  fields: [fieldSchema]
}, { timestamps: true });

eventTypeSchema.index({ slug: 1, createdBy: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('EventType', eventTypeSchema);
