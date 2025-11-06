const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createEvent, getEvents, getEvent, updateEvent, deleteEvent, scanImage, scanFile, aiTransform, aiGenerate, aiEcho, aiGenerateForm } = require('../controllers/eventController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(auth);
router.post('/', createEvent);
router.get('/', getEvents);
// OCR: upload an image and extract event fields (place before :id routes)
router.post('/scan-image', upload.single('image'), scanImage);
// Unified scanner: accepts 'file' (PDF or image)
router.post('/scan-file', upload.single('file'), scanFile);
// AI transform: apply user prompt to structured items
router.post('/ai-transform', aiTransform);
router.post('/ai-generate', aiGenerate);
router.post('/ai-generate-form', aiGenerateForm);
router.post('/ai-echo', aiEcho);
router.get('/:id', getEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

module.exports = router;
