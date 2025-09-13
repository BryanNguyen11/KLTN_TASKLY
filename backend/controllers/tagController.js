const Tag = require('../models/Tag');

function slugify(name){
  return name.toLowerCase().trim().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
}

exports.listTags = async (req,res) => {
  try {
    const userId = req.user.userId;
    const tags = await Tag.find({ $or:[ { isDefault:true }, { createdBy: userId } ] }).sort({ name:1 }).lean();
    res.json(tags);
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy tags', error: err.message });
  }
};

exports.createTag = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { name } = req.body;
    if(!name || !name.trim()) return res.status(400).json({ message: 'Tên tag bắt buộc' });
    const slug = slugify(name);
    const existing = await Tag.findOne({ slug });
    if(existing) return res.status(200).json(existing);
    const tag = await Tag.create({ name: name.trim(), slug, createdBy: userId, isDefault:false });
    res.status(201).json(tag);
  } catch(err){
    res.status(500).json({ message:'Lỗi tạo tag', error: err.message });
  }
};
