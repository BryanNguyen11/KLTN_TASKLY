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

// Connect to MongoDB and start schedulers + server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');

    // Simple daily push scheduler (runs every minute; sends once per day per user)
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
        const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0,10);
        if(!(hh === 8 && mm < 2)) return;
        const users = await User.find({ expoPushTokens: { $exists: true, $not: { $size: 0 } } }).select('_id expoPushTokens lastDailyPushDate name');
        for(const u of users){
          if(u.lastDailyPushDate === todayISO) continue;
          const tasks = await Task.find({ $or:[ { userId: u._id }, { assignedTo: u._id } ], status: { $ne: 'completed' } }).select('date endDate repeat title');
          const occursToday = (t) => {
            const start = t.date;
            const end = t.endDate || t.date;
            if(start <= todayISO && todayISO <= end) return true;
            const r = t.repeat; if(!r || todayISO < start) return false;
            const diffDays = (a,b)=> Math.round((new Date(b)-new Date(a))/86400000);
            const diffMonths = (a,b)=> { const A=new Date(a), B=new Date(b); return (B.getFullYear()-A.getFullYear())*12 + (B.getMonth()-A.getMonth()); };
            if(r.frequency==='daily'){ const k = diffDays(start, todayISO); return k>=0; }
            if(r.frequency==='weekly'){ const k = Math.floor(diffDays(start, todayISO)/7); return k>=0; }
            if(r.frequency==='monthly'){ const m = diffMonths(start, todayISO); return m>=0; }
            if(r.frequency==='yearly'){ const A=new Date(start), B=new Date(todayISO); const years=B.getFullYear()-A.getFullYear(); return years>=0; }
            return false;
          };
          const todays = tasks.filter(occursToday);
          if(todays.length>0){
            await sendExpoPush(u.expoPushTokens, 'Tác vụ hôm nay', `${todays.length} tác vụ cần hoàn thành`, { type:'daily-summary', count: todays.length });
            u.lastDailyPushDate = todayISO; await u.save();
          }
        }
      }catch(_e){}
    }
    setInterval(runDailySummary, 60*1000);

    // Intraday task digest at fixed times (09:00, 12:00, 16:00)
    async function runIntraDayTaskDigest(){
      try{
        const nowUtc = new Date();
        const desired = [9,12,16];
        const users = await User.find({ expoPushTokens: { $exists: true, $not: { $size: 0 } } }).select('_id expoPushTokens name timezone intradayDigestDate intradayDigestSlots');
        for(const u of users){
          const tz = u.timezone && typeof u.timezone==='string' && u.timezone.length>0 ? u.timezone : undefined;
          const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour:'2-digit', minute:'2-digit', hour12:false, year:'numeric', month:'2-digit', day:'2-digit' });
          const parts = fmt.formatToParts(nowUtc);
          const get = (type)=> parts.find(p=>p.type===type)?.value;
          const y = Number(get('year')); const m = Number(get('month')); const d = Number(get('day'));
          const hh = Number(get('hour')); const mm = Number(get('minute'));
          if(!desired.includes(hh) || mm >= 2) continue;
          const todayISO = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const slots = Array.isArray(u.intradayDigestSlots) ? u.intradayDigestSlots : [];
          if(u.intradayDigestDate === todayISO && slots.includes(hh)) continue;
          const remaining = await Task.countDocuments({
            status: { $ne: 'completed' },
            $and: [
              { $or: [ { userId: u._id }, { assignedTo: u._id } ] },
              { $or: [
                { endDate: todayISO },
                { $and: [ { $or:[ { endDate: { $exists:false } }, { endDate: null }, { endDate: '' } ] }, { date: todayISO } ] }
              ] }
            ]
          });
          if(remaining > 0){
            await sendExpoPush(u.expoPushTokens, 'Nhắc nhở tác vụ', `Bạn còn ${remaining} tác vụ đến hạn hôm nay`, { type:'intraday-digest', slot: hh, count: remaining, localDate: todayISO });
          }
          if(u.intradayDigestDate !== todayISO){ u.intradayDigestDate = todayISO; u.intradayDigestSlots = [hh]; }
          else { u.intradayDigestSlots = Array.from(new Set([ ...slots, hh ])).sort(); }
          try{ await u.save(); }catch(_e){}
        }
      }catch(_e){}
    }
    setInterval(runIntraDayTaskDigest, 60*1000);

    // Reminders scheduler
    async function runReminders(){
      try{
        const now = new Date();
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
      }catch(_e){}
    }
    setInterval(runReminders, 60*1000);

    // Seed defaults
    (async () => {
      try {
        const defaults = [
          { name: 'Học tập', slug: 'hoc-tap' },
          { name: 'Công việc', slug: 'cong-viec' },
          { name: 'Cá nhân', slug: 'ca-nhan' },
        ];
        for (const t of defaults) {
          const exists = await Tag.findOne({ slug: t.slug });
          if (!exists) { await Tag.create({ name: t.name, slug: t.slug, isDefault: true }); }
          else if (!exists.isDefault) { exists.isDefault = true; await exists.save(); }
        }
        const defaultTypes = [
          { name: 'Lịch học', slug: 'lich-hoc', isDefault: true, fields: [ { key: 'phong', label: 'Phòng', type: 'text' }, { key: 'coSo', label: 'Cơ sở', type: 'text' }, { key: 'giangVien', label: 'Giảng viên', type: 'text' } ] },
          { name: 'Công việc', slug: 'su-kien-cong-viec', isDefault: true, fields: [ { key: 'diaDiem', label: 'Địa điểm', type: 'text' }, { key: 'ghiChu', label: 'Ghi chú', type: 'text' }, { key: 'link', label: 'Link', type: 'url' } ] }
        ];
        for (const et of defaultTypes) {
          const exists = await EventType.findOne({ slug: et.slug, isDefault: true });
          if (!exists) { await EventType.create(et); }
        }
        console.log('✅ Default tags/types ensured');
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