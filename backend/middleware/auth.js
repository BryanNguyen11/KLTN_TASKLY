const jwt = require('jsonwebtoken');

module.exports = function(req,res,next){
  const auth = req.headers.authorization;
  if(!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Thiếu token' });
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, role }
    next();
  } catch(err){
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }
};
