const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwtSecret = process.env.JWT_SECRET;
const { sendMail, renderResetEmail } = require('../utils/emailService');

exports.register = async (req, res) => {
  try {
    console.log('req.body:', req.body);
    const { name, email, password } = req.body;
    if(!email || !password || !name){
      return res.status(400).json({ message: 'Thiếu thông tin' });
    }
    // Validate Gmail-only and password length >= 8
    const isGmail = /^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(String(email).trim());
    if(!isGmail){
      return res.status(400).json({ message: 'Chỉ chấp nhận email @gmail.com' });
    }
    if(String(password).length < 8){
      return res.status(400).json({ message: 'Mật khẩu tối thiểu 8 ký tự' });
    }

    // Kiểm tra email đã tồn tại
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã được sử dụng' });
    }

    // Tạo user mới (mật khẩu sẽ tự động được hash nhờ pre('save'))
    const user = new User({ name, email, password });
    await user.save();
    // ✅ In thông tin user ra terminal
    console.log('🆕 Người dùng mới đăng ký:', {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role
    });


    // Tạo token ngay sau khi đăng ký (tuỳ chọn)
    const token = jwt.sign(
      { userId: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Đăng ký thành công',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar || ''
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Email không tồn tại' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Mật khẩu không đúng' });
    const token = jwt.sign(
      { userId: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      message: 'Đăng nhập thành công',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar || '' }
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Request password reset: sends an email with a token link (placeholder: console log)
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Thiếu email' });
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Email không tồn tại' });
    // generate token and OTP
    const token = crypto.randomBytes(24).toString('hex');
    const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    user.otpCode = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();
    // In thực tế: gửi email chứa link/reset token cho người dùng
    console.log('📧 Reset password token for', email, ':', token);
    console.log('📧 OTP code for', email, ':', otp);
    // Gửi email thực tế nếu cấu hình SMTP đầy đủ, nếu không sẽ log ra console
    try {
      const mail = renderResetEmail({ name: user.name, email, otp, resetToken: token });
      await sendMail({ to: email, subject: 'Taskly - Mã OTP đặt lại mật khẩu', html: mail.html, text: mail.text });
    } catch (e) {
      console.log('[MAIL][ERROR]', e?.message);
    }
    res.json({ message: 'Đã gửi email đặt lại mật khẩu (kèm OTP)', ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Confirm password reset using token
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Thiếu token hoặc mật khẩu mới' });
    const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: new Date() } });
    if (!user) return res.status(400).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
    if (String(password).length < 8) return res.status(400).json({ message: 'Mật khẩu tối thiểu 8 ký tự' });
    // set new password
    user.password = password; // will be hashed by pre('save')
    user.resetPasswordToken = '';
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: 'Đặt lại mật khẩu thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};

// Verify OTP before allowing reset password screen
exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Thiếu email hoặc mã OTP' });
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Email không tồn tại' });
    if (!user.otpCode || !user.otpExpires || user.otpExpires <= new Date()) {
      return res.status(400).json({ message: 'OTP hết hạn hoặc không hợp lệ' });
    }
    if (String(user.otpCode) !== String(otp)) {
      return res.status(400).json({ message: 'OTP không đúng' });
    }
    // Clear OTP after successful verification
    user.otpCode = '';
    user.otpExpires = undefined;
    await user.save();
    // Client có thể lấy resetPasswordToken (đã tạo) để dùng ở màn reset
    res.json({ message: 'Xác thực OTP thành công', resetToken: user.resetPasswordToken });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ', error: err.message });
  }
};