const Event = require('../models/Event');
const EventType = require('../models/EventType');

exports.createEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
  const { title, typeId, date, endDate, startTime, endTime, location, notes, link, tags = [], props = {}, repeat } = req.body;
    if (!title || !typeId || !date) return res.status(400).json({ message: 'Thiếu trường bắt buộc' });
    // check type exists
    const et = await EventType.findById(typeId);
    if (!et) return res.status(400).json({ message: 'Loại sự kiện không hợp lệ' });
    if (endDate && endDate < date) return res.status(400).json({ message: 'endDate phải >= date' });
  const doc = await Event.create({ userId, title, typeId, date, endDate, startTime, endTime, location, notes, link, tags, props, repeat });
    res.status(201).json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi tạo sự kiện', error: e.message });
  }
};

exports.getEvents = async (req, res) => {
  try {
    const userId = req.user.userId;
    const list = await Event.find({ userId }).sort({ date: 1, startTime: 1 }).lean();
    res.json(list);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi lấy danh sách sự kiện', error: e.message });
  }
};

exports.getEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const doc = await Event.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi lấy sự kiện', error: e.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const updates = { ...req.body };
    if (updates.endDate && updates.date && updates.endDate < updates.date) {
      return res.status(400).json({ message: 'endDate phải >= date' });
    }
    const doc = await Event.findOneAndUpdate({ _id: req.params.id, userId }, updates, { new: true });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi cập nhật sự kiện', error: e.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const doc = await Event.findOneAndDelete({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
    res.json({ message: 'Đã xóa', id: doc._id });
  } catch (e) {
    res.status(500).json({ message: 'Lỗi xóa sự kiện', error: e.message });
  }
};
