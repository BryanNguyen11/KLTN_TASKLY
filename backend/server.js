const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const authRoutes = require('./routes/authRoutes');
const taskRoutes = require('./routes/taskRoutes');
const tagRoutes = require('./routes/tagRoutes');
const userRoutes = require('./routes/userRoutes');
const Tag = require('./models/Tag');
const eventTypeRoutes = require('./routes/eventTypeRoutes');
const eventRoutes = require('./routes/eventRoutes');
const EventType = require('./models/EventType');


// Middleware
app.use(cors());
app.use(express.json());
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/users', userRoutes);
app.use('/api/event-types', eventTypeRoutes);
app.use('/api/events', eventRoutes);

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
    app.listen(process.env.PORT, () => {
      console.log(`🚀 Server running on port ${process.env.PORT}`);
    });
  })
  .catch(err => console.error(err));