const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function(req,res,next){
  const auth = req.headers.authorization;
  if(!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Thiếu token' });
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // ensure email present in req.user for invite features
    if(!decoded.email && decoded.userId){
      try{
        const u = await User.findById(decoded.userId).select('email role');
        if(u){ decoded.email = u.email; decoded.role = decoded.role || u.role; }
      } catch(_e){}
    }
    req.user = decoded; // { userId, role, email }
    next();
  } catch(err){
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }
};
