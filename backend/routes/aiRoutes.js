const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { chat } = require('../controllers/aiController');

router.use(auth);
router.post('/chat', chat);

module.exports = router;
