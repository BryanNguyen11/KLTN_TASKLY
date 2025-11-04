const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createTask, getTasks, getTask, updateTask, deleteTask, toggleSubTask, aiSort, aiGenerateTasks } = require('../controllers/taskController');

router.use(auth);
router.post('/', createTask);
router.get('/', getTasks);
router.post('/ai-sort', aiSort);
router.post('/ai-generate', aiGenerateTasks);
router.get('/:id', getTask);
router.put('/:id', updateTask);
router.patch('/:id/subtasks/:index', toggleSubTask);
router.delete('/:id', deleteTask);

module.exports = router;
