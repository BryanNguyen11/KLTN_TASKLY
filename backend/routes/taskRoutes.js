const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createTask, getTasks, getTask, updateTask, deleteTask } = require('../controllers/taskController');

router.use(auth);
router.post('/', createTask);
router.get('/', getTasks);
router.get('/:id', getTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

module.exports = router;
