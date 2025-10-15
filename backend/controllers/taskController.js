const Task = require('../models/Task');
const User = require('../models/User');

// In-memory dedupe for identical pushes in a small time window
const __PUSH_RECENT = new Map();
function __shouldSend(key, windowMs=20000){
  const now = Date.now();
  const last = __PUSH_RECENT.get(key) || 0;
  if(now - last < windowMs) return false;
  __PUSH_RECENT.set(key, now);
  return true;
}
async function sendExpoPush(tokens, title, body, data){
  if(!Array.isArray(tokens) || tokens.length===0) return;
  const unique = Array.from(new Set(tokens.filter(t => typeof t === 'string' && t.startsWith('ExpoPushToken['))));
  const list = [];
  unique.forEach(to => {
    const key = `${to}|${data?.type||''}|${data?.projectId||data?.id||''}|${title||''}|${body||''}`;
    if(__shouldSend(key, 20000)){
      list.push({ to, sound:'default', title, body, data });
    }
  });
  if(list.length===0) return;
  try {
    const doFetch = globalThis.fetch;
    await doFetch('https://exp.host/--/api/v2/push/send', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(list) });
  } catch(_){ }
}

const occursToday = (t) => {
  const now = new Date();
  const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0,10);
  const start = t.date;
  const end = t.endDate || t.date;
  if(start && start <= todayISO && todayISO <= end) return true;
  const r = t.repeat;
  if(!r || !start || todayISO < start) return false;
  const diffDays = (a,b)=> Math.round((new Date(b)-new Date(a))/86400000);
  const diffMonths = (a,b)=> { const A=new Date(a), B=new Date(b); return (B.getFullYear()-A.getFullYear())*12 + (B.getMonth()-A.getMonth()); };
  if(r.frequency==='daily'){ const k = diffDays(start, todayISO); return k>=0; }
  if(r.frequency==='weekly'){ const k = Math.floor(diffDays(start, todayISO)/7); return k>=0; }
  if(r.frequency==='monthly'){ const m = diffMonths(start, todayISO); return m>=0; }
  if(r.frequency==='yearly'){ const A=new Date(start), B=new Date(todayISO); const years=B.getFullYear()-A.getFullYear(); return years>=0; }
  return false;
};

exports.createTask = async (req,res) => {
  try {
    const userId = req.user.userId;
  const { title, description='', date, endDate, startTime, endTime, time, priority='medium', importance='medium', urgency='medium', type='personal', estimatedHours=1, tags=[], subTasks=[], repeat, projectId, assignedTo, reminders } = req.body;
    if(!title || !date) return res.status(400).json({ message: 'Thiếu trường bắt buộc' });
    if(!startTime && !time) return res.status(400).json({ message: 'Cần startTime/endTime hoặc time' });
  if(endDate && endDate < date) return res.status(400).json({ message: 'endDate phải >= date' });
  if(repeat){
    const { frequency, endMode, endDate: rEndDate, count } = repeat;
    if(!['daily','weekly','monthly','yearly'].includes(frequency)) return res.status(400).json({ message:'repeat.frequency không hợp lệ' });
    if(endMode && !['never','onDate','after'].includes(endMode)) return res.status(400).json({ message:'repeat.endMode không hợp lệ' });
    if(endMode==='onDate' && rEndDate && rEndDate < date) return res.status(400).json({ message:'repeat.endDate phải >= date' });
    if(endMode==='after' && count && count < 1) return res.status(400).json({ message:'repeat.count phải >= 1' });
  }
  const sanitizedSubTasks = Array.isArray(subTasks) ? subTasks.filter(st => st && st.title && st.title.trim()).map(st => ({ title: st.title.trim(), completed: !!st.completed })) : [];
  const payload = { userId, title, description, date, endDate, startTime, endTime, time, priority, importance, urgency, type, estimatedHours, tags, subTasks: sanitizedSubTasks, repeat: repeat || undefined };
  if(projectId){ payload.projectId = projectId; }
  if(assignedTo){ payload.assignedTo = assignedTo; }
  // Compute reminders -> array of absolute Date objects
  if(Array.isArray(reminders) && (startTime || endTime || time)){
    const targetDate = endDate || date;
    const baseTime = endTime || startTime || time || '09:00';
    const toDateTime = (isoDate, hhmm) => new Date(`${isoDate}T${hhmm}:00`);
    const baseAt = toDateTime(targetDate, baseTime);
    const calc = (r) => {
      if(!r) return null;
      if(r.type==='relative'){
        const at = new Date(baseAt.getTime() - (r.minutes||0)*60000);
        return at;
      }
      if(r.type==='absolute' && r.at){
        const at = new Date(r.at);
        return at;
      }
      return null;
    };
    const rems = reminders.map(calc).filter(Boolean).map(at => ({ at, sent:false }));
    if(rems.length){ payload.reminders = rems; }
  }
  const task = await Task.create(payload);
    // Socket emit: notify project room about new task
    try {
      const io = req.app.get('io');
      if(io && task.projectId){ io.to(`project:${task.projectId}`).emit('task:created', task.toObject ? task.toObject() : task); }
    } catch(_e){}
    // Push notify owner/assignee if task occurs today
    try {
      if(occursToday(task)){
        const targets = new Set();
        if(task.userId) targets.add(String(task.userId));
        if(task.assignedTo) targets.add(String(task.assignedTo));
        const users = await User.find({ _id: { $in: Array.from(targets) } }).select('expoPushTokens');
        const tokens = users.flatMap(u => u.expoPushTokens || []);
        await sendExpoPush(tokens, 'Tác vụ hôm nay', task.title, { type:'task-today', id: String(task._id) });
      }
    } catch(_e){}
    res.status(201).json(task);
  } catch(err){
    res.status(500).json({ message: 'Lỗi tạo task', error: err.message });
  }
};

exports.getTasks = async (req,res) => {
  try {
    const userId = req.user.userId;
    // Return all tasks created by user, plus tasks assigned to user
    const tasks = await Task.find({ $or: [ { userId }, { assignedTo: userId } ] }).sort({ createdAt: -1 }).lean();
    res.json(tasks);
  } catch(err){
    res.status(500).json({ message: 'Lỗi lấy danh sách', error: err.message });
  }
};

exports.getTask = async (req,res) => {
  try {
    const userId = req.user.userId;
    const task = await Task.findOne({ _id: req.params.id, $or: [ { userId }, { assignedTo: userId } ] });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    res.json(task);
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy task', error: err.message });
  }
};

exports.updateTask = async (req,res) => {
  try {
    const userId = req.user.userId;
  const updates = { ...req.body };
    if(updates.subTasks){
      updates.subTasks = Array.isArray(updates.subTasks) ? updates.subTasks.filter(st => st && st.title && st.title.trim()).map(st => ({ title: st.title.trim(), completed: !!st.completed })) : [];
    }
    if(updates.endDate && updates.date && updates.endDate < updates.date) {
      return res.status(400).json({ message:'endDate phải >= date' });
    }
    if(Object.prototype.hasOwnProperty.call(updates,'repeat') && updates.repeat){
      const { frequency, endMode, endDate: rEndDate, count } = updates.repeat;
      if(!['daily','weekly','monthly','yearly'].includes(frequency)) return res.status(400).json({ message:'repeat.frequency không hợp lệ' });
      if(endMode && !['never','onDate','after'].includes(endMode)) return res.status(400).json({ message:'repeat.endMode không hợp lệ' });
      const baseDate = updates.date || (await Task.findById(req.params.id)).date;
      if(endMode==='onDate' && rEndDate && rEndDate < baseDate) return res.status(400).json({ message:'repeat.endDate phải >= date' });
      if(endMode==='after' && count && count < 1) return res.status(400).json({ message:'repeat.count phải >= 1' });
    }
    if(Object.prototype.hasOwnProperty.call(updates,'status')){
      if(updates.status === 'completed') {
        updates.completedAt = new Date();
      } else if(updates.status !== 'completed') {
        updates.completedAt = undefined; // remove when reverting
      }
    }
    const before = await Task.findOne({ _id: req.params.id, $or: [ { userId }, { assignedTo: userId } ] }).lean();
    // Recompute reminders if provided
    if(Array.isArray(req.body.reminders)){
      const baseDate = updates.endDate || updates.date || before?.endDate || before?.date;
      const baseTime = updates.endTime || updates.startTime || before?.endTime || before?.startTime || before?.time || '09:00';
      const toDateTime = (isoDate, hhmm) => new Date(`${isoDate}T${hhmm}:00`);
      if(baseDate && baseTime){
        const baseAt = toDateTime(baseDate, baseTime);
        const rems = req.body.reminders.map((r)=>{
          if(r?.type==='relative') return { at: new Date(baseAt.getTime() - (r.minutes||0)*60000), sent:false };
          if(r?.type==='absolute' && r.at) return { at: new Date(r.at), sent:false };
          return null;
        }).filter(Boolean);
        updates.reminders = rems;
      }
    }
    const task = await Task.findOneAndUpdate({ _id: req.params.id, $or: [ { userId }, { assignedTo: userId } ] }, updates, { new: true });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    // Socket emit: notify project room about task update
    try {
      const io = req.app.get('io');
      if(io && task.projectId){ io.to(`project:${task.projectId}`).emit('task:updated', task.toObject ? task.toObject() : task); }
    } catch(_e){}
    // Push notifications for changes
    try {
      // Assignment changed
      const beforeAssignee = before?.assignedTo ? String(before.assignedTo) : undefined;
      const afterAssignee = task.assignedTo ? String(task.assignedTo) : undefined;
      const assignmentChanged = beforeAssignee !== afterAssignee && !!afterAssignee;
      if(assignmentChanged){
        const assignee = await User.findById(afterAssignee).select('expoPushTokens');
        await sendExpoPush(assignee?.expoPushTokens||[], 'Bạn được giao tác vụ', `${task.title}`, { type:'task-assigned', id: String(task._id) });
      }
      // Status changed to completed (notify owner if different)
      if(before?.status !== task.status && task.status === 'completed'){
        const targetUsers = [];
        if(task.userId && String(task.userId) !== afterAssignee) targetUsers.push(String(task.userId));
        const users = await User.find({ _id: { $in: targetUsers } }).select('expoPushTokens');
        const tokens = users.flatMap(u => u.expoPushTokens||[]);
        await sendExpoPush(tokens, 'Tác vụ đã hoàn thành', `${task.title}`, { type:'task-completed', id: String(task._id) });
      }
      // General update notify assignee (if exists), but avoid sending in the same update when assignment just changed to prevent duplicate pushes
      if(afterAssignee && !assignmentChanged){
        const users = await User.find({ _id: { $in: [afterAssignee] } }).select('expoPushTokens');
        const tokens = users.flatMap(u => u.expoPushTokens||[]);
        await sendExpoPush(tokens, 'Cập nhật tác vụ', `${task.title}`, { type:'task-updated', id: String(task._id) });
      }
    } catch(_e){}
    res.json(task);
  } catch(err){
    res.status(500).json({ message:'Lỗi cập nhật', error: err.message });
  }
};

exports.deleteTask = async (req,res) => {
  try {
    const userId = req.user.userId;
    const task = await Task.findOneAndDelete({ _id: req.params.id, $or: [ { userId }, { assignedTo: userId } ] });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    try {
      const io = req.app.get('io');
      if(io && task.projectId){ io.to(`project:${task.projectId}`).emit('task:deleted', { id: String(task._id), projectId: String(task.projectId) }); }
    } catch(_e){}
    res.json({ message:'Đã xóa', id: task._id });
  } catch(err){
    res.status(500).json({ message:'Lỗi xóa', error: err.message });
  }
};

exports.toggleSubTask = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id, index } = { id: req.params.id, index: parseInt(req.params.index,10) };
    if(Number.isNaN(index)) return res.status(400).json({ message:'Index không hợp lệ' });
    const task = await Task.findOne({ _id:id, $or: [ { userId }, { assignedTo: userId } ] });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    if(!task.subTasks || !task.subTasks[index]) return res.status(404).json({ message:'Subtask không tồn tại' });

    // Toggle the subtask
    task.subTasks[index].completed = !task.subTasks[index].completed;

  // Re-evaluate completion percent only (no auto status change; main task completion is manual)
  // If you later need to auto-suggest completion, you can return doneCount/total here.

    await task.save();
    // Ensure we send virtuals (already enabled with toJSON) but refetch lean for consistency
    const fresh = await Task.findById(task._id).lean();
    // Socket emit: subtask toggled
    try {
      const io = req.app.get('io');
      if(io && fresh?.projectId){ io.to(`project:${fresh.projectId}`).emit('task:updated', fresh); }
    } catch(_e){}
    res.json(fresh);
  } catch(err){
    res.status(500).json({ message:'Lỗi toggle subtask', error: err.message });
  }
};
