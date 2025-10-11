const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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