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