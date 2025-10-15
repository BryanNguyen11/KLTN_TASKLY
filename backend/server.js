const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST','PUT','DELETE','PATCH'] }
});

// Socket.IO auth handshake (simple token pass-through; real verification can decode JWT)
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  socket.userToken = token; // Attach raw token for potential later verification
  next();
});

io.on('connection', (socket) => {
  // Join a personal room after optional token parse (simplified: use token as key if present)
  if(socket.userToken){
    socket.join(`user:${socket.userToken}`);
  }
  socket.on('joinProject', (projectId) => {
    if(projectId) socket.join(`project:${projectId}`);
  });
  socket.on('leaveProject', (projectId) => {
    if(projectId) socket.leave(`project:${projectId}`);
  });
});

// Helper emitters (can be imported later by separating into its own module if needed)
app.set('io', io);
const authRoutes = require('./routes/authRoutes');
const taskRoutes = require('./routes/taskRoutes');
const tagRoutes = require('./routes/tagRoutes');
const userRoutes = require('./routes/userRoutes');
const Tag = require('./models/Tag');
const eventTypeRoutes = require('./routes/eventTypeRoutes');
const eventRoutes = require('./routes/eventRoutes');
const EventType = require('./models/EventType');
const projectRoutes = require('./routes/projectRoutes');
const User = require('./models/User');
const Task = require('./models/Task');
const Event = require('./models/Event');


// Middleware
app.use(cors());
app.use(express.json());
// Debug: minimal request logger (method, path)
app.use((req, res, next) => {
  try {
    console.log(`[REQ] ${req.method} ${req.url}`);
  } catch(_) {}
  next();
});
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/users', userRoutes);
app.use('/api/event-types', eventTypeRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/projects', projectRoutes);

// Routes test
app.get('/', (req, res) => {
  res.send('Taskly API is running...');
});

// Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    // Seed default tags if missing
    (async () => {
      try {

// Simple daily push scheduler (runs every minute; sends once per day per user)
const sentTodayFor = new Set();
async function sendExpoPush(pushTokens, title, body, data){
  if(!Array.isArray(pushTokens) || pushTokens.length===0) return;
  const messages = pushTokens.filter(t => typeof t === 'string' && t.startsWith('ExpoPushToken[')).map(to => ({ to, sound: 'default', title, body, data }));
  if(messages.length===0) return;
  try{
    const res = await fetch('https://exp.host/--/api/v2/push/send',{ method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(messages) });
    await res.json().catch(()=>null);
  }catch(_e){ /* ignore network errors */ }
}

async function runDailySummary(){
  try{
    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();
    const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0,10); // YYYY-MM-DD
    // send around 08:00 local
    if(!(hh === 8 && mm < 2)) return;
    const users = await User.find({ expoPushTokens: { $exists: true, $not: { $size: 0 } } }).select('_id expoPushTokens lastDailyPushDate name');
    for(const u of users){
      if(u.lastDailyPushDate === todayISO) continue; // already sent
      // Today tasks: date==today or (repeat occurrence falls today) or within span if endDate>=today and date<=today
      const tasks = await Task.find({ $or:[ { userId: u._id }, { assignedTo: u._id } ], status: { $ne: 'completed' } }).select('date endDate repeat title');
      const occursToday = (t) => {
        const start = t.date;
        const end = t.endDate || t.date;
        if(start <= todayISO && todayISO <= end) return true;
        // simple repeat check for daily/weekly/monthly/yearly start<=today
        const r = t.repeat;
        if(!r || todayISO < start) return false;
        const diffDays = (a,b)=> Math.round((new Date(b)-new Date(a))/86400000);
        const diffMonths = (a,b)=> { const A=new Date(a), B=new Date(b); return (B.getFullYear()-A.getFullYear())*12 + (B.getMonth()-A.getMonth()); };
        if(r.frequency==='daily'){
          const k = diffDays(start, todayISO); if(k<0) return false; return true;
        }
        if(r.frequency==='weekly'){
          const k = Math.floor(diffDays(start, todayISO)/7); if(k<0) return false; return true;
        }
        if(r.frequency==='monthly'){
          const m = diffMonths(start, todayISO); if(m<0) return false; return true;
        }
        if(r.frequency==='yearly'){
          const A=new Date(start), B=new Date(todayISO); const years=B.getFullYear()-A.getFullYear(); if(years<0) return false; return true;
        }
        return false;
      };
      const todays = tasks.filter(occursToday);
      if(todays.length>0){
        const title = 'Tác vụ hôm nay';
        const body = `${todays.length} tác vụ cần hoàn thành`;
        await sendExpoPush(u.expoPushTokens, title, body, { type:'daily-summary', count: todays.length });
        u.lastDailyPushDate = todayISO;
        await u.save();
      }
    }
  }catch(_e){ /* ignore */ }
}

setInterval(runDailySummary, 60*1000);

// Reminders scheduler: check every minute for due reminders in tasks/events
async function runReminders(){
  try{
    const now = new Date();
    const windowMs = 60*1000; // 1 minute window
    const from = new Date(now.getTime() - windowMs);
    // Tasks
    const tasks = await Task.find({ 'reminders.sent': false, 'reminders.at': { $lte: now } }).select('title userId assignedTo reminders projectId');
    for(const t of tasks){
      const due = (t.reminders||[]).filter(r => !r.sent && r.at <= now);
      if(due.length===0) continue;
      const users = await User.find({ _id: { $in: Array.from(new Set([ String(t.userId), t.assignedTo? String(t.assignedTo): null ].filter(Boolean))) } }).select('expoPushTokens');
      const tokens = users.flatMap(u => Array.isArray(u.expoPushTokens)? u.expoPushTokens: []);
      if(tokens.length){
        try{
          const messages = tokens.filter(to => typeof to==='string' && to.startsWith('ExpoPushToken[')).map(to => ({ to, sound:'default', title:'Nhắc nhở tác vụ', body: t.title, data:{ type:'task-reminder', id: String(t._id) } }));
          if(messages.length){ await fetch('https://exp.host/--/api/v2/push/send',{ method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(messages) }); }
        }catch(_e){}
      }
      // mark due reminders as sent
      (t.reminders||[]).forEach(r => { if(!r.sent && r.at <= now) r.sent = true; });
      await t.save();
    }
    // Events
    const events = await Event.find({ 'reminders.sent': false, 'reminders.at': { $lte: now } }).select('title userId reminders');
    for(const e of events){
      const due = (e.reminders||[]).filter(r => !r.sent && r.at <= now);
      if(due.length===0) continue;
      const u = await User.findById(e.userId).select('expoPushTokens');
      const tokens = u?.expoPushTokens || [];
      if(tokens.length){
        try{
          const messages = tokens.filter(to => typeof to==='string' && to.startsWith('ExpoPushToken[')).map(to => ({ to, sound:'default', title:'Nhắc nhở lịch', body: e.title, data:{ type:'event-reminder', id: String(e._id) } }));
          if(messages.length){ await fetch('https://exp.host/--/api/v2/push/send',{ method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(messages) }); }
        }catch(_e){}
      }
      (e.reminders||[]).forEach(r => { if(!r.sent && r.at <= now) r.sent = true; });
      await e.save();
    }
  }catch(_e){ /* ignore */ }
}
setInterval(runReminders, 60*1000);
        const defaults = [
          { name: 'Học tập', slug: 'hoc-tap' },
          { name: 'Công việc', slug: 'cong-viec' },
          { name: 'Cá nhân', slug: 'ca-nhan' },
        ];
        for (const t of defaults) {
          const exists = await Tag.findOne({ slug: t.slug });
          if (!exists) {
            await Tag.create({ name: t.name, slug: t.slug, isDefault: true });
          } else if (!exists.isDefault) {
            exists.isDefault = true;
            await exists.save();
          }
        }
        console.log('✅ Default tags ensured');

        // Seed default event types
        const defaultTypes = [
          {
            name: 'Lịch học', slug: 'lich-hoc', isDefault: true,
            fields: [
              { key: 'phong', label: 'Phòng', type: 'text' },
              { key: 'coSo', label: 'Cơ sở', type: 'text' },
              { key: 'giangVien', label: 'Giảng viên', type: 'text' },
            ]
          },
          {
            name: 'Công việc', slug: 'su-kien-cong-viec', isDefault: true,
            fields: [
              { key: 'diaDiem', label: 'Địa điểm', type: 'text' },
              { key: 'ghiChu', label: 'Ghi chú', type: 'text' },
              { key: 'link', label: 'Link', type: 'url' },
            ]
          }
        ];
        for (const et of defaultTypes) {
          const exists = await EventType.findOne({ slug: et.slug, isDefault: true });
          if (!exists) {
            await EventType.create(et);
          }
        }
        console.log('✅ Default event types ensured');
      } catch (e) {
        console.warn('⚠️ Seed defaults failed:', e.message);
      }
    })();
    const PORT = process.env.PORT || 5000;
    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server + Socket.IO running on port ${PORT}`);
    });
  })
  .catch(err => console.error(err));