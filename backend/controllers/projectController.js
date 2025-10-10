const crypto = require('crypto');
const Project = require('../models/Project');
const User = require('../models/User');

// Create project: requester becomes owner + admin member
exports.createProject = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { name, description='', inviteEmails=[], startDate, dueDate } = req.body;
    if(!name) return res.status(400).json({ message:'Thiếu tên dự án' });
    // Validate dates (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let start = startDate;
    const today = new Date();
  const toLocalISODate = (d) => {
      const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`;
    };
    if(!start){ start = toLocalISODate(today); }
    else if(start && !dateRegex.test(start)) return res.status(400).json({ message:'startDate không đúng định dạng YYYY-MM-DD' });
    if(dueDate && !dateRegex.test(dueDate)) return res.status(400).json({ message:'dueDate không đúng định dạng YYYY-MM-DD' });
    if(dueDate && start && dueDate < start) return res.status(400).json({ message:'Ngày kết thúc dự kiến phải >= ngày bắt đầu' });
    const project = await Project.create({
      name: name.trim(),
      description: description.trim(),
      startDate: start,
      dueDate: dueDate || undefined,
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
    const projects = await Project.find({ $or:[
      { owner: userId },
      { 'members.user': userId },
      { invites: { $elemMatch: { email, status: 'pending' } } }
    ] })
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
    const p = await Project.findOne({ _id: req.params.id, $or:[
      { owner: userId },
      { 'members.user': userId },
      { invites: { $elemMatch: { email, status: 'pending' } } }
    ] })
      .populate('members.user', 'name email avatar');
    if(!p) return res.status(404).json({ message:'Không tìm thấy dự án' });
    res.json(p);
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy dự án', error: err.message });
  }
};

// Update member role (admin only)
exports.updateMemberRole = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id, userId: targetId } = { id: req.params.id, userId: req.params.userId };
    const { role } = req.body; // 'admin' | 'member'
    if(!['admin','member'].includes(role)) return res.status(400).json({ message:'Role không hợp lệ' });
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const isAdmin = project.owner.equals(userId) || project.members.some(m=> m.user.equals(userId) && m.role==='admin');
    if(!isAdmin) return res.status(403).json({ message:'Không có quyền' });
    // không đổi role của owner
    if(project.owner.equals(targetId)) return res.status(400).json({ message:'Không thể đổi quyền của Owner' });
    const m = project.members.find(m=> String(m.user) === String(targetId));
    if(!m) return res.status(404).json({ message:'Không tìm thấy thành viên' });
    m.role = role;
    await project.save();
    const io = req.app.get('io');
    if(io){ io.to(`project:${project._id}`).emit('project:updated', { projectId: project._id, project }); }
    res.json({ message:'Đã cập nhật quyền', project });
  } catch(err){
    res.status(500).json({ message:'Lỗi cập nhật quyền', error: err.message });
  }
};

// Remove member (admin only)
exports.removeMember = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id, userId: targetId } = { id: req.params.id, userId: req.params.userId };
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const isAdmin = project.owner.equals(userId) || project.members.some(m=> m.user.equals(userId) && m.role==='admin');
    if(!isAdmin) return res.status(403).json({ message:'Không có quyền' });
    if(project.owner.equals(targetId)) return res.status(400).json({ message:'Không thể xóa Owner' });
    const before = project.members.length;
    project.members = project.members.filter(m=> String(m.user) !== String(targetId));
    if(project.members.length === before) return res.status(404).json({ message:'Không tìm thấy thành viên' });
    await project.save();
    const io = req.app.get('io');
    if(io){ io.to(`project:${project._id}`).emit('project:updated', { projectId: project._id, project }); }
    res.json({ message:'Đã xóa thành viên', project });
  } catch(err){
    res.status(500).json({ message:'Lỗi xóa thành viên', error: err.message });
  }
};

// Revoke invite (admin only)
exports.revokeInvite = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id, inviteId } = { id: req.params.id, inviteId: req.params.inviteId };
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const isAdmin = project.owner.equals(userId) || project.members.some(m=> m.user.equals(userId) && m.role==='admin');
    if(!isAdmin) return res.status(403).json({ message:'Không có quyền' });
    const inv = project.invites.id(inviteId);
    if(!inv) return res.status(404).json({ message:'Không tìm thấy lời mời' });
    if(inv.status !== 'pending') return res.status(400).json({ message:'Chỉ có thể hủy lời mời đang chờ' });
    inv.deleteOne();
    await project.save();
    const io = req.app.get('io');
    if(io){ io.to(`project:${project._id}`).emit('project:updated', { projectId: project._id, project }); }
    res.json({ message:'Đã hủy lời mời', project });
  } catch(err){
    res.status(500).json({ message:'Lỗi hủy lời mời', error: err.message });
  }
};

// Leave project (self remove, not owner)
exports.leaveProject = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    if(project.owner.equals(userId)) return res.status(400).json({ message:'Owner không thể rời dự án' });
    const before = project.members.length;
    project.members = project.members.filter(m=> !m.user.equals(userId));
    if(project.members.length === before) return res.status(400).json({ message:'Bạn không phải là thành viên của dự án' });
    await project.save();
    const io = req.app.get('io');
    if(io){ io.to(`project:${project._id}`).emit('project:updated', { projectId: project._id, project }); }
    res.json({ message:'Đã rời dự án', project });
  } catch(err){
    res.status(500).json({ message:'Lỗi rời dự án', error: err.message });
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

// Update project basic info: name, description, startDate, dueDate (owner/admin only)
exports.updateProject = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, description, startDate, dueDate } = req.body;
    const project = await Project.findById(id);
    if(!project) return res.status(404).json({ message:'Không tìm thấy dự án' });
    const isAdmin = project.owner.equals(userId) || project.members.some(m=> m.user.equals(userId) && m.role==='admin');
    if(!isAdmin) return res.status(403).json({ message:'Không có quyền' });
    // Basic validation
    if(name !== undefined){
      const n = String(name).trim();
      if(!n) return res.status(400).json({ message:'Tên dự án không được trống' });
      if(n.length>120) return res.status(400).json({ message:'Tên quá dài (tối đa 120 ký tự)' });
      project.name = n;
    }
    if(description !== undefined){ project.description = String(description); }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if(startDate !== undefined){
      if(startDate && !dateRegex.test(startDate)) return res.status(400).json({ message:'startDate không đúng định dạng YYYY-MM-DD' });
      project.startDate = startDate || undefined;
    }
    if(dueDate !== undefined){
      if(dueDate && !dateRegex.test(dueDate)) return res.status(400).json({ message:'dueDate không đúng định dạng YYYY-MM-DD' });
      project.dueDate = dueDate || undefined;
    }
    if(project.startDate && project.dueDate && project.dueDate < project.startDate){
      return res.status(400).json({ message:'Ngày kết thúc dự kiến phải >= ngày bắt đầu' });
    }
    await project.save();
    const io = req.app.get('io');
    if(io){ io.to(`project:${project._id}`).emit('project:updated', { projectId: project._id, project }); }
    res.json({ message:'Đã cập nhật dự án', project });
  } catch(err){
    res.status(500).json({ message:'Lỗi cập nhật dự án', error: err.message });
  }
};