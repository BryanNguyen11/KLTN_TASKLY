const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getMe, updateMe, getStats } = require('../controllers/userController');

router.use(auth);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/me/stats', getStats);

module.exports = router;
