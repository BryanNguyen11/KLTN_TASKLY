const Task = require('../models/Task');
const User = require('../models/User');
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
let GoogleGenerativeAI;
try { ({ GoogleGenerativeAI } = require('@google/generative-ai')); } catch(_) { GoogleGenerativeAI = null; }

// --- Strict/relative helpers (mirroring eventController where relevant) ---
function detectStrictFromPrompt(prompt){
  try{
    const p = String(prompt||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]+/g,'');
    return /(chinh\s*xac|chuan\s*xac|that\s*sat|exact|strict|nguyen\s*van)/i.test(p);
  }catch{ return false; }
}
function detectSemanticsFromPrompt(prompt){
  try{
    const p = String(prompt||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]+/g,'');
    const due = /(\bhan\b|\bhan chot\b|deadline|\btruoc\b|\bden han\b|\bnop\b|phai xong|phai hoan thanh)/i.test(p);
    const start = /(bat ?dau|khoi ?dong|start)/i.test(p);
    return { mode: due? 'due' : (start? 'start' : 'none') };
  }catch{ return { mode:'none' }; }
}
function resolveRelativeDateTime(prompt, baseNowISO){
  try{
    const s = String(prompt||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]+/g,'');
    let now = new Date();
    if(typeof baseNowISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(baseNowISO)){
      const [y,m,d] = baseNowISO.split('-').map(n=>parseInt(n,10));
      if(y && m && d){ now = new Date(y,(m||1)-1,d||1, now.getHours(), now.getMinutes(), 0, 0); }
    }
    const pad2 = (n)=> String(n).padStart(2,'0');
    const toISO = (d)=> `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    const weekdayNames = { 'thu 2':1, 'thu 3':2, 'thu 4':3, 'thu 5':4, 'thu 6':5, 'thu 7':6, 'chu nhat':0, 'cn':0 };
    const findWeekdayToken = ()=>{ 
      for(const [k,v] of Object.entries(weekdayNames)){ if(s.includes(k)) return v; }
      const m = s.match(/\bt\s*(2|3|4|5|6|7)\b/); if(m){ return parseInt(m[1],10)-1; }
      return null; 
    };
    const hhmm = (()=>{ let m = s.match(/\b(\d{1,2}):(\d{2})\b/); if(m) return `${pad2(Math.min(23,Math.max(0,parseInt(m[1],10))))}:${pad2(Math.min(59,Math.max(0,parseInt(m[2],10))))}`; m = s.match(/\b(\d{1,2})h(\d{2})?\b/i); if(m){ const h=parseInt(m[1],10)||0; const mm=parseInt(m[2]||'0',10)||0; return `${pad2(Math.min(23,Math.max(0,h)))}:${pad2(Math.min(59,Math.max(0,mm)))}`; } return null; })();
    const thisWeek = /(tuan nay|tuan\s*nay)/i.test(s);
    const nextWeek = /(tuan sau|tuan toi)/i.test(s);
    const wd = findWeekdayToken();
    if(wd!==null){
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const baseDow = base.getDay(); // 0=Sun..6=Sat
      const targetDow = wd; // 0..6
      const delta = ((targetDow - baseDow + 7) % 7) + (nextWeek? 7 : 0);
      let dayOffset = delta;
      if(thisWeek && delta===0){ dayOffset = 0; }
      const target = new Date(base.getFullYear(), base.getMonth(), base.getDate()+dayOffset);
      return { date: toISO(target), time: hhmm || null };
    }
    return null;
  }catch{ return null; }
}

// Helpers for more informative notifications
function toDisplayDate(iso){
  try { const [y,m,d] = String(iso||'').split('-').map(n=>parseInt(n,10)); if(!y||!m||!d) return ''; return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`; } catch { return String(iso||''); }
}
function safeJoinTime(start, end){
  const a = start||''; const b = end||''; if(a && b) return `${a}–${b}`; return a || b || '';
}
function diffTaskFields(before, after){
  const changes = [];
  const push = (label, from, to) => { if(from===to) return; changes.push({ label, from, to }); };
  push('Tiêu đề', before?.title||'', after?.title||'');
  push('Ngày', toDisplayDate(before?.date), toDisplayDate(after?.date));
  push('Đến ngày', toDisplayDate(before?.endDate), toDisplayDate(after?.endDate));
  push('Giờ', safeJoinTime(before?.startTime, before?.endTime), safeJoinTime(after?.startTime, after?.endTime));
  push('Ưu tiên', before?.priority||'', after?.priority||'');
  push('Quan trọng', before?.importance||'', after?.importance||'');
  push('Cấp bách', before?.urgency||'', after?.urgency||'');
  push('Trạng thái', before?.status||'', after?.status||'');
  // assignedTo change is handled by a dedicated push, but still include in summary for others
  if(String(before?.assignedTo||'') !== String(after?.assignedTo||'')){
    changes.push({ label:'Người phụ trách', from: before?.assignedTo? String(before.assignedTo): '', to: after?.assignedTo? String(after.assignedTo): '' });
  }
  return changes;
}
function summarizeChanges(changes){
  if(!Array.isArray(changes) || changes.length===0) return '';
  const parts = changes
    .filter(ch => (ch.from||'') !== (ch.to||''))
    .map(ch => `• ${ch.label}: ${ch.from||'—'} → ${ch.to||'—'}`);
  return parts.join('\n');
}

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
    const unique = Array.from(new Set(tokens.filter(t => typeof t === 'string' && t.startsWith('ExpoPushToken'))));
  const list = [];
  unique.forEach(to => {
    const key = `${to}|${data?.type||''}|${data?.projectId||data?.id||''}|${title||''}|${body||''}`;
    if(__shouldSend(key, 20000)){
      list.push({ to, sound:'default', title, body, data, ttl: 600 });
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

const normalizeStatus = (s) => (s === 'in-progress' ? 'todo' : s);

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
  // Normalize status if provided
  if(Object.prototype.hasOwnProperty.call(req.body,'status')){ payload.status = normalizeStatus(req.body.status); }
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
    // Base filter: all tasks created by user, plus tasks assigned to user
    const base = { $or: [ { userId }, { assignedTo: userId } ] };
    const q = String(req.query?.q||'').trim();
    const from = String(req.query?.from||'');
    const to = String(req.query?.to||'');
    const weekday = parseInt(String(req.query?.weekday||''),10); // 1..7 (Mon..Sun)
    const and = [];
    if(q){
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      and.push({ $or: [ { title: re }, { description: re } ] });
    }
  if(from){ and.push({ $or: [ { endDate: { $gte: from } }, { date: { $gte: from } } ] }); }
    if(to){ and.push({ date: { $lte: to } }); }
    // Note: weekday filtering properly requires recurrence expansion; keep on frontend for now.
    const filter = and.length? { $and: [ base, ...and ] } : base;
    const tasks = await Task.find(filter).sort({ createdAt: -1 }).lean();
  // Normalize status on read
  const mapped = tasks.map(t => ({ ...t, status: normalizeStatus(t.status) }));
  res.json(mapped);
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
      updates.status = normalizeStatus(updates.status);
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
    // Push notifications for changes (detailed)
    try {
      const actorId = String(userId);
      // Assignment changed
      const beforeAssignee = before?.assignedTo ? String(before.assignedTo) : undefined;
      const afterAssignee = task.assignedTo ? String(task.assignedTo) : undefined;
      const assignmentChanged = beforeAssignee !== afterAssignee && !!afterAssignee;
      if(assignmentChanged){
        const assignee = await User.findById(afterAssignee).select('expoPushTokens');
        const summary = summarizeChanges(diffTaskFields(before, task));
        const body = summary ? `${task.title}\n${summary}` : `${task.title}`;
        await sendExpoPush(assignee?.expoPushTokens||[], 'Bạn được giao tác vụ', body, { type:'task-assigned', id: String(task._id) });
      }
      // Status changed to completed
      if(before?.status !== task.status && task.status === 'completed'){
        const summary = summarizeChanges(diffTaskFields(before, task));
        const body = summary ? `${task.title}\n${summary}` : `${task.title}`;
        if(task.projectId){
          // Project rule: send exactly one project-wide notification; do not notify actor or task owner
          try{
            const Project = require('../models/Project');
            const p = await Project.findById(task.projectId).select('owner members');
            if(p){
              const targets = new Set();
              if(p.owner) targets.add(String(p.owner));
              (p.members||[]).forEach(m => m?.user && targets.add(String(m.user)));
              // Exclude actor and task owner
              targets.delete(actorId);
              if(task.userId) targets.delete(String(task.userId));
              // If assignee completed, they are the actor; already excluded
              const users = await User.find({ _id: { $in: Array.from(targets) } }).select('expoPushTokens');
              let tokens = users.flatMap(u => Array.isArray(u.expoPushTokens)? u.expoPushTokens: []);
              tokens = Array.from(new Set(tokens));
              if(tokens.length){
                await sendExpoPush(tokens, 'Tác vụ hoàn thành (Dự án)', body, { type:'task-project-completed', id: String(task._id), projectId: String(task.projectId) });
              }
            }
          }catch(_e){}
        } else {
          // Non-project: notify the owner if they are not the actor or assignee
          const ownerId = task.userId ? String(task.userId) : '';
          if(ownerId && ownerId !== actorId && ownerId !== (afterAssignee||'')){
            const owner = await User.findById(ownerId).select('expoPushTokens');
            await sendExpoPush(owner?.expoPushTokens||[], 'Tác vụ đã hoàn thành', body, { type:'task-completed', id: String(task._id) });
          }
        }
      }
      // General update notify assignee (if exists), but avoid sending in the same update when assignment just changed to prevent duplicate pushes
      if(afterAssignee && !assignmentChanged){
        // Skip notifying actor to avoid duplicate on same device if they are the assignee
        const users = await User.find({ _id: { $in: [afterAssignee] } }).select('expoPushTokens');
        let tokens = users.flatMap(u => Array.isArray(u.expoPushTokens)? u.expoPushTokens: []);
        tokens = Array.from(new Set(tokens));
        const summary = summarizeChanges(diffTaskFields(before, task));
        const body = summary ? `${task.title}\n${summary}` : `${task.title}`;
        await sendExpoPush(tokens, 'Tác vụ cập nhật', body, { type:'task-updated', id: String(task._id) });
      }
      // Notify project members for general updates (skip completed to avoid duplicate with project-completed push)
      if(task.projectId && task.status !== 'completed'){
        try{
          const Project = require('../models/Project');
          const p = await Project.findById(task.projectId).select('owner members');
          if(p){
            const targets = new Set();
            const updater = actorId;
            const ass = task.assignedTo ? String(task.assignedTo) : '';
            if(p.owner) targets.add(String(p.owner));
            (p.members||[]).forEach(m => m?.user && targets.add(String(m.user)));
            // Exclude updater and assignee (already got a push)
            targets.delete(updater); if(ass) targets.delete(ass);
            if(targets.size){
              const users = await User.find({ _id: { $in: Array.from(targets) } }).select('expoPushTokens');
              let tokens = users.flatMap(u => Array.isArray(u.expoPushTokens)? u.expoPushTokens: []);
              tokens = Array.from(new Set(tokens));
              if(tokens.length){
                const summary = summarizeChanges(diffTaskFields(before, task));
                const body = summary ? `${task.title}\n${summary}` : `${task.title}`;
                await sendExpoPush(tokens, 'Cập nhật tác vụ (Dự án)', body, { type:'task-project-updated', id: String(task._id), projectId: String(task.projectId) });
              }
            }
          }
        }catch(_e){}
      }
    } catch(_e){}
  // Normalize status on response
  res.json(task && task.toObject ? { ...task.toObject(), status: normalizeStatus(task.status) } : task);
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

// One-time migration: convert all 'in-progress' to 'todo' in DB
exports.migrateInProgressToTodo = async (req, res) => {
  try {
    const userId = req.user.userId;
    // Only affect tasks user owns or is assigned to
    const filter = { status: 'in-progress', $or: [ { userId }, { assignedTo: userId } ] };
    const result = await Task.updateMany(filter, { $set: { status: 'todo' } });
    res.json({ matched: result.matchedCount || result.n || 0, modified: result.modifiedCount || result.nModified || 0 });
  } catch (err) {
    res.status(500).json({ message:'Lỗi migrate', error: err.message });
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

// AI sort and prioritization using Gemini. Returns ordered tasks and reasons.
exports.aiSort = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { tasks=[] } = req.body || {};
    if(!Array.isArray(tasks) || tasks.length===0){ return res.json({ ordered: [], reasons: [] }); }
    const key = process.env.GEMINI_API_KEY; if(!key || !GoogleGenerativeAI){ return res.status(400).json({ message:'Thiếu GEMINI_API_KEY hoặc thư viện' }); }
    const modelName = process.env.GEMINI_TASK_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-pro';
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelName });
    const temp = isFinite(parseFloat(process.env.GEMINI_TASK_TEMPERATURE||'')) ? parseFloat(process.env.GEMINI_TASK_TEMPERATURE||'') : 0.2;
    const generationConfig = { temperature: temp };
    const schema = `You are a productivity assistant. Given a list of tasks (JSON), return a JSON with fields: ordered (array of ids in best execution order), and reasons (array of {id, reason} explaining the placement). Consider importance, urgency (due dates), estimated hours, and grouping similar/contextual tasks. Respond JSON only.`;
    const content = [
      { role:'user', parts:[ { text: schema }, { text: JSON.stringify({ tasks }) } ] }
    ];
    const result = await model.generateContent({ contents: content, generationConfig });
    const text = String(result?.response?.text?.() || '').trim();
    let data;
    try { data = JSON.parse(text.replace(/^```json\n?|```$/g,'')); } catch { data = null; }
    if(!data || !Array.isArray(data.ordered)){
      return res.json({ ordered: tasks.map(t=> t.id), reasons: [] });
    }
    return res.json({ ordered: data.ordered, reasons: Array.isArray(data.reasons)? data.reasons : [] });
  } catch(e){
    return res.status(500).json({ message:'Lỗi AI sort', error: e.message });
  }
};

// AI generate tasks from a free-form prompt
exports.aiGenerateTasks = async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const strictFlag = !!req.body?.strict;
    const strict = strictFlag || detectStrictFromPrompt(prompt);
    if(!prompt) return res.status(400).json({ message: 'Thiếu prompt' });
    // Local Ollama provider
    if(LLM_PROVIDER === 'ollama'){
      // Lazy inline chat similar to event AI; avoid extra deps
      async function ollamaChat(messages, opts={}){
        try{
          const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
          const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
          const body = { model, messages, stream: false, options: { temperature: 0.1, ...opts } };
          const ctrl = new AbortController();
          const timeoutMs = Math.min(30000, Number(process.env.OLLAMA_TIMEOUT_MS||15000));
          const to = setTimeout(()=> ctrl.abort(), timeoutMs);
          const url = `${base}/api/chat`;
          const resp = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }).finally(()=> clearTimeout(to));
          if(!resp.ok) throw new Error(`ollama http ${resp.status}`);
          const data = await resp.json();
          return String(data?.message?.content || '').trim();
        }catch(e){ return null; }
      }
      const sys = [
        'Bạn là trợ lý tạo danh sách TÁC VỤ học tập/công việc từ mô tả (tiếng Việt).',
        'Chỉ trả về JSON hợp lệ theo schema, không giải thích hay Markdown.',
        '{ "tasks": [ { "title": string, "date": "YYYY-MM-DD"|"", "startTime": string|"", "endTime": string|"", "priority": "low"|"medium"|"high"|"", "importance": "low"|"medium"|"high"|"", "notes": string } ] }'
      ].join('\n');
      const user = `Yêu cầu người dùng:\n${prompt}`;
      let raw = await ollamaChat([ { role:'system', content: sys }, { role:'user', content: user } ]);
      // If Ollama fails/aborts, fall back to Gemini below
      const tryParse = (s)=>{ try{ return JSON.parse(s); }catch{ return null; } };
      const stripFences = (s)=> s.replace(/^```json\n?|```$/g,'').trim();
      const extract = (s)=>{ const m = s.match(/```json\n([\s\S]*?)```/i); if(m){ const d=tryParse(m[1]); if(d) return d; } const i=s.indexOf('{'); const j=s.lastIndexOf('}'); if(i>=0&&j>i){ const d=tryParse(s.slice(i,j+1)); if(d) return d; } return tryParse(stripFences(s)); };
      const data = raw ? extract(String(raw)) : null;
      let tasks = Array.isArray(data?.tasks)? data.tasks: [];
      const sanitize = (arr)=> (Array.isArray(arr)? arr: []).map(it=>({
        title: String(it.title||'').slice(0,140) || 'Tác vụ',
        date: String(it.date||''),
        startTime: String(it.startTime||''),
        endTime: String(it.endTime||''),
        priority: ['low','medium','high'].includes(String(it.priority||'').toLowerCase())? String(it.priority).toLowerCase(): undefined,
        importance: ['low','medium','high'].includes(String(it.importance||'').toLowerCase())? String(it.importance).toLowerCase(): undefined,
        notes: String(it.notes||'')
      }));
      tasks = sanitize(tasks);
      // Strict fill: preserve AI output but fill relative date/time if present in prompt
      if(strict){
  const rel = resolveRelativeDateTime(prompt, req.body?.now);
        const sem = detectSemanticsFromPrompt(prompt);
        if(rel){
          tasks = tasks.map(it => ({
            ...it,
            date: it.date || rel.date || it.date,
            ...(rel.time ? ( sem.mode==='due' ? { endTime: it.endTime || rel.time } : { startTime: it.startTime || rel.time } ) : {}),
          }));
        }
      }
      if(tasks.length){ return res.json({ tasks, provider: 'ollama', model: process.env.OLLAMA_MODEL || 'llama3.1:8b' }); }
      // Else fall through to Gemini implementation below
    }

    // Gemini provider
    if(!GoogleGenerativeAI){ return res.status(500).json({ message:'Máy chủ chưa cấu hình AI' }); }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const candidates = [
      process.env.GEMINI_TASK_MODEL,
      process.env.GEMINI_MODEL,
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-8b-latest',
      'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'
    ].filter(Boolean);
    const sys = [
      'Bạn là trợ lý tạo danh sách TÁC VỤ học tập/công việc từ mô tả (tiếng Việt).',
      'Chỉ trả về JSON hợp lệ theo schema, không giải thích hoặc Markdown.',
      'Schema: { "tasks": [ { "title": string, "date": "YYYY-MM-DD"|"", "startTime": string|"", "endTime": string|"", "priority": "low"|"medium"|"high"|"", "importance": "low"|"medium"|"high"|"", "notes": string } ] }',
      '- Nếu thiếu thời gian, để trống "startTime"/"endTime". Nếu thiếu ngày, để trống "date".',
      '- Tránh bịa đặt quá mức; nếu thông tin không có, để trống.',
      strict ? '- CHẾ ĐỘ CHÍNH XÁC: Không suy diễn. Giữ nguyên các giá trị thời gian/ngày nếu không được chỉ định rõ. Không tự ý đặt giờ.' : ''
    ].join('\n');
  const user = `${req.body?.now? `Hôm nay (theo thiết bị): ${req.body.now}. `:''}Yêu cầu người dùng:\n${prompt}`;
    const extract = (raw)=>{
      try{
        if(!raw) return null; let s=String(raw).trim();
        const m=s.match(/```(?:json)?\n([\s\S]*?)```/i); if(m) s=m[1].trim();
        return JSON.parse(s);
      }catch{ return null; }
    };
    const sanitize = (arr)=> (Array.isArray(arr)? arr: []).map(it=>({
      title: String(it.title||'').slice(0,140) || 'Tác vụ',
      date: String(it.date||''),
      startTime: String(it.startTime||''),
      endTime: String(it.endTime||''),
      priority: ['low','medium','high'].includes(String(it.priority||'').toLowerCase())? String(it.priority).toLowerCase(): undefined,
      importance: ['low','medium','high'].includes(String(it.importance||'').toLowerCase())? String(it.importance).toLowerCase(): undefined,
      notes: String(it.notes||'')
    }));
    let used = '';
    for(const name of candidates){
      try{
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent({
          contents: [ { role:'user', parts:[ { text: sys }, { text: user } ] } ],
          generationConfig: { temperature: 0.2 }
        });
        const raw = String(result?.response?.text?.() || '').trim();
        const data = extract(raw);
        const tasks = sanitize(data?.tasks);
        used = name;
        if(tasks && tasks.length){
          let out = tasks;
          if(strict){
            const rel = resolveRelativeDateTime(prompt, req.body?.now);
            const sem = detectSemanticsFromPrompt(prompt);
            if(rel){
              out = out.map(it => ({
                ...it,
                date: it.date || rel.date || it.date,
                ...(rel.time ? ( sem.mode==='due' ? { endTime: it.endTime || rel.time } : { startTime: it.startTime || rel.time } ) : {}),
              }));
            }
          }
          return res.json({ tasks: out, model: name });
        }
      }catch(_e){ /* try next */ }
    }
    return res.status(400).json({ message:'AI không tạo được danh sách phù hợp', reason:'empty-tasks' });
  } catch(e){
    return res.status(500).json({ message:'Lỗi AI generate tasks', error: e?.message || String(e) });
  }
};
