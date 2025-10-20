const User = require('../models/User');
const Task = require('../models/Task');

// PATCH /api/users/me/push-token { token?, replace?: boolean, clear?: boolean, timezone?: string }
exports.savePushToken = async (req, res) => {
  try {
    const { token, replace, clear, timezone } = req.body || {};
    const u = await User.findById(req.user.userId);
    if (!u) return res.status(404).json({ message: 'Không tìm thấy user' });

    // Allow clearing all tokens explicitly (useful for Expo Go fallback to avoid duplicate remote+local notifications)
    if (clear === true) {
      u.expoPushTokens = [];
      if (timezone && typeof timezone === 'string' && timezone.length <= 80) {
        u.timezone = timezone;
      }
      await u.save();
      return res.json({ ok: true, cleared: true, timezone: u.timezone || null });
    }

    if (!token || typeof token !== 'string') return res.status(400).json({ message: 'Thiếu token' });
    u.expoPushTokens = Array.isArray(u.expoPushTokens) ? u.expoPushTokens : [];
    if (replace === true) {
      // Keep only the latest token to avoid duplicate deliveries from stale tokens
      u.expoPushTokens = [token];
      await u.save();
    } else if (!u.expoPushTokens.includes(token)) {
      u.expoPushTokens.push(token);
      // De-duplicate just in case
      u.expoPushTokens = Array.from(new Set(u.expoPushTokens));
      await u.save();
    }
    if (timezone && typeof timezone === 'string' && timezone.length <= 80) {
      u.timezone = timezone;
      await u.save();
    }
    res.json({ ok: true, timezone: u.timezone || null });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lưu token', error: err.message });

};
}

// POST /api/users/me/push-test
// Sends a simple test push to the current user's registered Expo push tokens
exports.testPush = async (req, res) => {
  try {
    const u = await User.findById(req.user.userId).select('name expoPushTokens');
    if (!u) return res.status(404).json({ message: 'Không tìm thấy user' });
    const tokens = Array.isArray(u.expoPushTokens) ? u.expoPushTokens : [];
    const list = tokens
      .filter(t => typeof t === 'string' && t.startsWith('ExpoPushToken['))
      .map(to => ({ to, sound: 'default', title: 'Test thông báo', body: `Xin chào${u.name? ', ' + u.name : ''}! Đây là thông báo thử.`, data: { type: 'test' }, ttl: 120 }));
    if (list.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: 'Chưa có Expo Push Token hợp lệ' });
    }
    try {
      const r = await globalThis.fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list)
      });
      await r.json().catch(()=>null);
    } catch (_) { /* ignore network error in test */ }
    return res.json({ ok: true, sent: list.length });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi gửi test push', error: err.message });
  }
};

// POST /api/users/me/push-send { title, body, data }
// Sends a custom push to the current user's registered Expo push tokens
exports.pushSend = async (req, res) => {
  try {
    const { title, body, data } = req.body || {};
    if (typeof title !== 'string' || title.length === 0) return res.status(400).json({ message: 'Thiếu title' });
    const u = await User.findById(req.user.userId).select('expoPushTokens');
    if (!u) return res.status(404).json({ message: 'Không tìm thấy user' });
    const tokens = Array.isArray(u.expoPushTokens) ? u.expoPushTokens : [];
    const list = tokens
      .filter(t => typeof t === 'string' && t.startsWith('ExpoPushToken['))
      .map(to => ({ to, sound: 'default', title, body: typeof body === 'string' ? body : '', data: data || {}, ttl: 300 }));
    if (list.length === 0) return res.status(200).json({ ok: true, sent: 0, message: 'Chưa có Expo Push Token hợp lệ' });
    try {
      const r = await globalThis.fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list)
      });
      await r.json().catch(()=>null);
    } catch (_) { /* ignore network error */ }
    return res.json({ ok: true, sent: list.length });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi gửi push', error: err.message });
  }
};


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
