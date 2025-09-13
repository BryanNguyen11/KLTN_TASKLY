const Task = require('../models/Task');

exports.createTask = async (req,res) => {
  try {
    const userId = req.user.userId;
  const { title, description='', date, endDate, startTime, endTime, time, priority='medium', importance='medium', type='personal', estimatedHours=1, tags=[], subTasks=[] } = req.body;
    if(!title || !date) return res.status(400).json({ message: 'Thiếu trường bắt buộc' });
    if(!startTime && !time) return res.status(400).json({ message: 'Cần startTime/endTime hoặc time' });
  if(endDate && endDate < date) return res.status(400).json({ message: 'endDate phải >= date' });
  const sanitizedSubTasks = Array.isArray(subTasks) ? subTasks.filter(st => st && st.title && st.title.trim()).map(st => ({ title: st.title.trim(), completed: !!st.completed })) : [];
  const task = await Task.create({ userId, title, description, date, endDate, startTime, endTime, time, priority, importance, type, estimatedHours, tags, subTasks: sanitizedSubTasks });
    res.status(201).json(task);
  } catch(err){
    res.status(500).json({ message: 'Lỗi tạo task', error: err.message });
  }
};

exports.getTasks = async (req,res) => {
  try {
    const userId = req.user.userId;
    const tasks = await Task.find({ userId }).sort({ createdAt: -1 }).lean();
    res.json(tasks);
  } catch(err){
    res.status(500).json({ message: 'Lỗi lấy danh sách', error: err.message });
  }
};

exports.getTask = async (req,res) => {
  try {
    const userId = req.user.userId;
    const task = await Task.findOne({ _id: req.params.id, userId });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    res.json(task);
  } catch(err){
    res.status(500).json({ message:'Lỗi lấy task', error: err.message });
  }
};

exports.updateTask = async (req,res) => {
  try {
    const userId = req.user.userId;
    const updates = { ...req.body };
    if(updates.subTasks){
      updates.subTasks = Array.isArray(updates.subTasks) ? updates.subTasks.filter(st => st && st.title && st.title.trim()).map(st => ({ title: st.title.trim(), completed: !!st.completed })) : [];
    }
    if(updates.endDate && updates.date && updates.endDate < updates.date) {
      return res.status(400).json({ message:'endDate phải >= date' });
    }
    if(Object.prototype.hasOwnProperty.call(updates,'status')){
      if(updates.status === 'completed') {
        updates.completedAt = new Date();
      } else if(updates.status !== 'completed') {
        updates.completedAt = undefined; // remove when reverting
      }
    }
    const task = await Task.findOneAndUpdate({ _id: req.params.id, userId }, updates, { new:true });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    res.json(task);
  } catch(err){
    res.status(500).json({ message:'Lỗi cập nhật', error: err.message });
  }
};

exports.deleteTask = async (req,res) => {
  try {
    const userId = req.user.userId;
    const task = await Task.findOneAndDelete({ _id: req.params.id, userId });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    res.json({ message:'Đã xóa', id: task._id });
  } catch(err){
    res.status(500).json({ message:'Lỗi xóa', error: err.message });
  }
};

exports.toggleSubTask = async (req,res) => {
  try {
    const userId = req.user.userId;
    const { id, index } = { id: req.params.id, index: parseInt(req.params.index,10) };
    if(Number.isNaN(index)) return res.status(400).json({ message:'Index không hợp lệ' });
    const task = await Task.findOne({ _id:id, userId });
    if(!task) return res.status(404).json({ message:'Không tìm thấy task' });
    if(!task.subTasks || !task.subTasks[index]) return res.status(404).json({ message:'Subtask không tồn tại' });

    // Toggle the subtask
    task.subTasks[index].completed = !task.subTasks[index].completed;

  // Re-evaluate completion percent only (no auto status change; main task completion is manual)
  // If you later need to auto-suggest completion, you can return doneCount/total here.

    await task.save();
    // Ensure we send virtuals (already enabled with toJSON) but refetch lean for consistency
    const fresh = await Task.findById(task._id).lean();
    res.json(fresh);
  } catch(err){
    res.status(500).json({ message:'Lỗi toggle subtask', error: err.message });
  }
};
