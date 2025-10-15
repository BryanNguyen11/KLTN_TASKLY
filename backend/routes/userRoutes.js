const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getMe, updateMe, getStats, updateAvatar, savePushToken, testPush } = require('../controllers/userController');

router.use(auth);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/me/stats', getStats);
router.patch('/me/avatar', updateAvatar);
router.patch('/me/push-token', savePushToken);
router.post('/me/push-test', testPush);
// removed: intraday test endpoint after feature stabilized

module.exports = router;
