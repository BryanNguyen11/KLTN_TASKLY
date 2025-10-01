const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  typeId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventType', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  endDate: { type: String }, // optional YYYY-MM-DD
  startTime: { type: String }, // HH:mm
  endTime: { type: String },   // HH:mm
  location: { type: String },
  notes: { type: String },
  link: { type: String },
  // flexible properties, keyed by EventType fields
  props: { type: Object, default: {} },
  tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag' }],
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
