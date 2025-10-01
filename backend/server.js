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


// Middleware
app.use(cors());
app.use(express.json());
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/users', userRoutes);

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
      } catch (e) {
        console.warn('⚠️ Could not seed default tags:', e.message);
      }
    })();
    app.listen(process.env.PORT, () => {
      console.log(`🚀 Server running on port ${process.env.PORT}`);
    });
  })
  .catch(err => console.error(err));