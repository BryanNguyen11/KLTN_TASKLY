const crypto = require('crypto');
const Project = require('../models/Project');
const User = require('../models/User');

// Create project: requester becomes owner + admin member
exports.createProject = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { name, description='', inviteEmails=[] } = req.body;
    if(!name) return res.status(400).json({ message:'Thiếu tên dự án' });
    const project = await Project.create({
      name: name.trim(),
      description: description.trim(),
      owner: userId,
      members: [{ user: userId, role: 'admin' }]
    });
    // Prepare invites
    if(Array.isArray(inviteEmails)){
      const uniqueEmails = [...new Set(inviteEmails.filter(e=>/^\S+@\S+\.\S+$/.test(e) && e.toLowerCase() !== req.user.email.toLowerCase()))];
      if(uniqueEmails.length){
        const invites = uniqueEmails.map(email => ({
          email: email.toLowerCase(),
          token: crypto.randomBytes(16).toString('hex'),
          expiresAt: new Date(Date.now()+ 1000*60*60*24*7) // 7 days
        }));
        project.invites.push(...invites);
        await project.save();
      }
    }
    res.status(201).json(project);
  } catch(err){
    res.status(500).json({ message:'Lỗi tạo dự án', error: err.message });
  }
};

// List projects for user (owner or member or invited)
exports.listProjects = async (req,res) => {
  try {
    const userId = req.user.userId;
    const email = (req.user.email || '').toLowerCase();
    const projects = await Project.find({ $or:[ { owner: userId }, { 'members.user': userId }, { 'invites.email': email } ] })
      .sort({ updatedAt:-1 })
      .lean();
    res.json(projects);
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy danh sách dự án', error: err.message });
  }
};

exports.getProject = async (req,res) => {
  try {
    const userId = req.user.userId;
    const email = (req.user.email || '').toLowerCase();
    const p = await Project.findOne({ _id: req.params.id, $or:[ { owner: userId }, { 'members.user': userId }, { 'invites.email': email } ] });
    if(!p) return res.status(404).json({ message:'Không tìm thấy dự án' });
    res.json(p);
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy dự án', error: err.message });
  }
};

// Invite new members (only admin)
exports.inviteMembers = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { emails=[] } = req.body;
    console.log('[inviteMembers] incoming', { projectId:id, requester:userId, emails });
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const isAdmin = project.owner.equals(userId) || project.members.some(m=> m.user.equals(userId) && m.role==='admin');
    if(!isAdmin) return res.status(403).json({ message:'Không có quyền mời' });
    const valid = emails.filter(e=>/^\S+@\S+\.\S+$/.test(e));
    const existingMembers = new Set(project.members.map(m=> String(m.user)));
    const existingInvites = new Set(project.invites.filter(i=> i.status==='pending').map(i=> i.email));
    const userDocs = await User.find({ email: { $in: valid.map(v=> v.toLowerCase()) } });
    const emailToUserId = new Map(userDocs.map(u=> [u.email.toLowerCase(), String(u._id)]));
    const newInvites = [];
    for(const raw of valid){
      const email = raw.toLowerCase();
      const uid = emailToUserId.get(email);
      if(uid && existingMembers.has(uid)) continue; // already member
      if(existingInvites.has(email)) continue;       // already invited
      newInvites.push({ email, token: crypto.randomBytes(16).toString('hex'), expiresAt: new Date(Date.now()+ 1000*60*60*24*7) });
    }
    if(newInvites.length){
      project.invites.push(...newInvites);
      await project.save();
      console.log('[inviteMembers] saved invites', newInvites.map(i=>i.email));
      // Emit realtime invite updates to each invited email token room if you later map email->user
      const io = req.app.get('io');
      if(io){
        newInvites.forEach(inv => {
          // Without user id mapping, broadcast a generic update channel
          io.emit('project:invited', { projectId: project._id, email: inv.email, invites: project.invites });
        });
        io.to(`project:${project._id}`).emit('project:updated', { projectId: project._id, invites: project.invites });
      }
    }
    console.log('[inviteMembers] final invite count', project.invites.length);
    res.json({ message:'Đã tạo lời mời', invites: project.invites });
  } catch(err){
    console.error('[inviteMembers] error', err);
    res.status(500).json({ message:'Lỗi mời thành viên', error: err.message });
  }
};

// Accept invite (by token)
exports.acceptInvite = async (req,res) => {
  try {
    const userId = req.user.userId;
    const email = req.user.email.toLowerCase();
    const { id } = req.params;
    const { token } = req.body;
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const invite = project.invites.find(i=> i.email===email && i.token===token && i.status==='pending');
    if(!invite) return res.status(400).json({ message:'Lời mời không hợp lệ hoặc đã hết hạn' });
    if(invite.expiresAt && invite.expiresAt < new Date()){
      invite.status='expired';
      await project.save();
      return res.status(400).json({ message:'Lời mời đã hết hạn' });
    }
    // Add member if not already
    if(!project.members.some(m=> m.user.equals(userId))){
      project.members.push({ user: userId, role:'member' });
    }
    invite.status='accepted';
    await project.save();
    const io = req.app.get('io');
    if(io){
      io.to(`project:${project._id}`).emit('project:memberJoined', { projectId: project._id, memberId: userId, project });
    }
    res.json({ message:'Đã tham gia dự án', project });
  } catch(err){
    res.status(500).json({ message:'Lỗi chấp nhận lời mời', error: err.message });
  }
};

// Archive project (owner or admin)
exports.archiveProject = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const isAdmin = project.owner.equals(userId) || project.members.some(m=> m.user.equals(userId) && m.role==='admin');
    if(!isAdmin) return res.status(403).json({ message:'Không có quyền' });
    project.status='archived';
    await project.save();
    res.json({ message:'Đã lưu trữ dự án', project });
  } catch(err){
    res.status(500).json({ message:'Lỗi lưu trữ', error: err.message });
  }
};

// Permanently delete project (only owner or admin) with password confirmation
exports.deleteProject = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { password } = req.body;
    if(!password) return res.status(400).json({ message:'Thiếu mật khẩu xác nhận' });
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const isAdmin = project.owner.equals(userId) || project.members.some(m=> m.user.equals(userId) && m.role==='admin');
    if(!isAdmin) return res.status(403).json({ message:'Không có quyền' });
    // verify password of requesting user
    const user = await User.findById(userId).select('+password');
    if(!user) return res.status(401).json({ message:'Người dùng không tồn tại' });
    const ok = await user.comparePassword(password);
    if(!ok) return res.status(401).json({ message:'Mật khẩu không đúng' });
    await Project.deleteOne({ _id: project._id });
    const io = req.app.get('io');
    if(io){
      io.to(`project:${project._id}`).emit('project:deleted', { projectId: project._id });
      io.emit('project:deletedGlobal', { projectId: project._id });
    }
    res.json({ message:'Đã xóa dự án vĩnh viễn', id: project._id });
  } catch(err){
    res.status(500).json({ message:'Lỗi xóa dự án', error: err.message });
  }
};