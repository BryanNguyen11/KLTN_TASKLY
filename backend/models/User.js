const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Email không hợp lệ']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  avatar: {
    type: String,
    trim: true,
    default: ''
  },
  // Password reset
  resetPasswordToken: { type: String, default: '' },
  resetPasswordExpires: { type: Date },
  // Email OTP for reset verification
  otpCode: { type: String, default: '' },
  otpExpires: { type: Date },
  // Push token maintenance
  pushTokenLastUpdatedAt: { type: Date },
  // Push notifications
  expoPushTokens: { type: [String], default: [] },
  lastDailyPushDate: { type: String }, // YYYY-MM-DD (user-local) to avoid duplicate daily summaries
  timezone: { type: String, default: '' }, // IANA timezone from device, e.g., 'Asia/Ho_Chi_Minh'
  // Intraday digest tracking per day to avoid duplicates across restarts
  intradayDigestDate: { type: String, default: '' }, // YYYY-MM-DD of last digest day
  intradayDigestSlots: { type: [Number], default: [] } // e.g., [9,12,16] for sent slots in intradayDigestDate
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare password (optional convenience)
userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
