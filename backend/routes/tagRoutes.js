const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { listTags, createTag } = require('../controllers/tagController');

router.use(auth);
router.get('/', listTags);
router.post('/', createTag);

module.exports = router;
