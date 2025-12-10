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
    // Policy: within 10 minutes of a token change or when replace=true, keep only the latest token
    const now = new Date();
    const last = u.pushTokenLastUpdatedAt ? new Date(u.pushTokenLastUpdatedAt) : null;
    const within10m = last ? (now.getTime() - last.getTime()) <= (10 * 60 * 1000) : false;
    if (replace === true || within10m) {
      u.expoPushTokens = [token];
      u.pushTokenLastUpdatedAt = now;
      await u.save();
    } else {
      if (!u.expoPushTokens.includes(token)) {
        u.expoPushTokens.push(token);
        u.expoPushTokens = Array.from(new Set(u.expoPushTokens));
        u.pushTokenLastUpdatedAt = now;
        await u.save();
      }
    }
    if (timezone && typeof timezone === 'string' && timezone.length <= 80) {
      u.timezone = timezone;
      await u.save();
    }
  res.json({ ok: true, timezone: u.timezone || null, latest: token, replaced: replace === true || within10m });
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
// Calculates task performance metrics with optional range and grouping
// Query params:
//   mode: 'month' | 'year' | 'custom' (default 'custom')
//   from: ISO date YYYY-MM-DD (optional)
//   to: ISO date YYYY-MM-DD (optional)
exports.getStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const mode = (req.query.mode === 'month' || req.query.mode === 'year' || req.query.mode === 'custom') ? req.query.mode : 'custom';
    const fromQ = typeof req.query.from === 'string' ? req.query.from : null;
    const toQ = typeof req.query.to === 'string' ? req.query.to : null;

    // Build date range
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth()+1).padStart(2,'0');
    const firstDayThisMonth = `${yyyy}-${mm}-01`;
    const firstDayThisYear = `${yyyy}-01-01`;
    const range = { from: fromQ, to: toQ };
    if (mode === 'month' && !fromQ && !toQ) {
      range.from = firstDayThisMonth;
      range.to = `${yyyy}-${mm}-31`; // safe upper bound; we will validate per task
    } else if (mode === 'year' && !fromQ && !toQ) {
      range.from = firstDayThisYear;
      range.to = `${yyyy}-12-31`;
    }

    // Fetch only completed tasks; optionally filter by range using completedAt
    const query = { userId, status: 'completed' };
    const tasks = await Task.find(query).select('date endDate completedAt');

    // Helper: parse deadline
    const getDeadline = (t) => {
      const deadlineDateStr = t.endDate || t.date;
      if (!deadlineDateStr) return null;
      return new Date(`${deadlineDateStr}T23:59:59`);
    };
    // Helper: within range
    const inRange = (d) => {
      if (!(d instanceof Date)) return false;
      if (range.from) {
        const f = new Date(`${range.from}T00:00:00`);
        if (d < f) return false;
      }
      if (range.to) {
        const t = new Date(`${range.to}T23:59:59`);
        if (d > t) return false;
      }
      return true;
    };

    // Summary counters
    let totalCompleted = 0;
    let onTime = 0;
    let late = 0;

    // Grouping buckets
    // For month mode: group by YYYY-MM
    // For year mode: group by YYYY
    // For custom: group by YYYY-MM-DD
    const buckets = new Map(); // key -> { total, onTime, late }
    const keyOf = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      if (mode === 'month') return `${y}-${m}`;
      if (mode === 'year') return String(y);
      return `${y}-${m}-${day}`; // custom/day
    };

    tasks.forEach(t => {
      if (!t.completedAt) return;
      const comp = new Date(t.completedAt);
      if (!inRange(comp)) return;
      const deadline = getDeadline(t);
      if (!deadline) return;
      totalCompleted++;
      const isOnTime = comp <= deadline;
      if (isOnTime) onTime++; else late++;
      const k = keyOf(comp);
      const cur = buckets.get(k) || { total: 0, onTime: 0, late: 0 };
      cur.total += 1;
      if (isOnTime) cur.onTime += 1; else cur.late += 1;
      buckets.set(k, cur);
    });

    const onTimeRate = totalCompleted ? onTime / totalCompleted : 0;
    let evaluation;
    if (!totalCompleted) evaluation = 'Chưa có dữ liệu';
    else if (onTimeRate >= 0.8) evaluation = 'Đúng deadline';
    else if (onTimeRate >= 0.5) evaluation = 'Cần cải thiện';
    else evaluation = 'Trì hoãn';

    // Build breakdown array sorted by key
    const breakdown = Array.from(buckets.entries())
      .sort((a,b)=> a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      .map(([period, v]) => ({ period, total: v.total, onTime: v.onTime, late: v.late, onTimeRate: v.total ? v.onTime / v.total : 0 }));

    res.json({
      mode,
      range,
      totalCompleted,
      onTime,
      late,
      onTimeRate,
      evaluation,
      breakdown
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi thống kê', error: err.message });
  }
};
