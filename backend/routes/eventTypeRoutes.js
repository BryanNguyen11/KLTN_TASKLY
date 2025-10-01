const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { listTypes, createType, updateType, deleteType } = require('../controllers/eventTypeController');

router.use(auth);
router.get('/', listTypes);
router.post('/', createType);
router.put('/:id', updateType);
router.delete('/:id', deleteType);

module.exports = router;
