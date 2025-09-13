const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getMe, updateMe, getStats, updateAvatar } = require('../controllers/userController');

router.use(auth);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/me/stats', getStats);
router.patch('/me/avatar', updateAvatar);

module.exports = router;
