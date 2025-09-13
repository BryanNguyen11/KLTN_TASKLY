const User = require('../models/User');
const Task = require('../models/Task');

// GET /api/users/me
exports.getMe = async (req, res) => {
  try {
  const user = await User.findById(req.user.userId).select('_id name email role createdAt avatar');
    if (!user) return res.status(404).json({ message: 'Không tìm thấy user' });
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
  createdAt: user.createdAt,
  avatar: user.avatar || ''
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy thông tin', error: err.message });
  }
};

// PATCH /api/users/me  { name }
exports.updateMe = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Tên không được rỗng' });
    if (name.trim().length < 2) return res.status(400).json({ message: 'Tên tối thiểu 2 ký tự' });
    if (name.trim().length > 50) return res.status(400).json({ message: 'Tên tối đa 50 ký tự' });
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { name: name.trim() },
      { new: true, runValidators: true, select: '_id name email role createdAt avatar' }
    );
    if (!user) return res.status(404).json({ message: 'Không tìm thấy user' });
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      avatar: user.avatar || ''
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật', error: err.message });
  }
};

// PATCH /api/users/me/avatar { avatar }
exports.updateAvatar = async (req, res) => {
  try {
    const { avatar } = req.body;
    if (typeof avatar !== 'string' || avatar.length > 500) {
      return res.status(400).json({ message: 'Avatar không hợp lệ' });
    }
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { avatar },
      { new: true, select: '_id name email role createdAt avatar' }
    );
    if (!user) return res.status(404).json({ message: 'Không tìm thấy user' });
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      avatar: user.avatar || ''
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật avatar', error: err.message });
  }
};

// GET /api/users/me/stats
// Calculates task performance metrics
exports.getStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    // Only completed tasks are relevant for on-time vs late
    const tasks = await Task.find({ userId, status: 'completed' }).select('date endDate completedAt');
    const totalCompleted = tasks.length;
    let onTime = 0;
    let late = 0;

    tasks.forEach(t => {
      if (!t.completedAt) return; // safety
      // Determine deadline date (endDate if provided else date)
      const deadlineDateStr = t.endDate || t.date; // both stored as YYYY-MM-DD
      if (!deadlineDateStr) return; // skip if malformed
      // Deadline considered end-of-day 23:59:59 local
      const deadline = new Date(`${deadlineDateStr}T23:59:59`);
      if (t.completedAt <= deadline) onTime++; else late++;
    });

    const onTimeRate = totalCompleted ? onTime / totalCompleted : 0;
    let evaluation;
    if (!totalCompleted) evaluation = 'Chưa có dữ liệu';
    else if (onTimeRate >= 0.8) evaluation = 'Đúng deadline';
    else if (onTimeRate >= 0.5) evaluation = 'Cần cải thiện';
    else evaluation = 'Trì hoãn';

    res.json({
      totalCompleted,
      onTime,
      late,
      onTimeRate,
      evaluation
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi thống kê', error: err.message });
  }
};
