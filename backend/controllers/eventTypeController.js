const EventType = require('../models/EventType');

exports.listTypes = async (req, res) => {
  try {
    const userId = req.user.userId;
    const types = await EventType.find({ $or: [{ isDefault: true }, { createdBy: userId }] }).sort({ isDefault: -1, name: 1 }).lean();
    res.json(types);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi lấy loại sự kiện', error: e.message });
  }
};

exports.createType = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, slug, fields = [] } = req.body;
    if (!name || !slug) return res.status(400).json({ message: 'Thiếu name/slug' });
    const doc = await EventType.create({ name, slug, fields, createdBy: userId });
    res.status(201).json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi tạo loại sự kiện', error: e.message });
  }
};

exports.updateType = async (req, res) => {
  try {
    const userId = req.user.userId;
    const updates = { ...req.body };
    const doc = await EventType.findOneAndUpdate({ _id: req.params.id, $or: [{ createdBy: userId }, { isDefault: true }] }, updates, { new: true });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy loại sự kiện' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi cập nhật loại sự kiện', error: e.message });
  }
};

exports.deleteType = async (req, res) => {
  try {
    const userId = req.user.userId;
    const doc = await EventType.findOneAndDelete({ _id: req.params.id, createdBy: userId, isDefault: { $ne: true } });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy loại sự kiện hoặc không được phép xóa' });
    res.json({ message: 'Đã xóa', id: doc._id });
  } catch (e) {
    res.status(500).json({ message: 'Lỗi xóa loại sự kiện', error: e.message });
  }
};
