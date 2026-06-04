const router = require('express').Router();
const voiceController = require('../controllers/voice.controller');
const upload = require('../middleware/upload');

router.post('/clone', upload.single('audio'), voiceController.clone);
router.get('/', voiceController.list);
router.delete('/:voiceId', voiceController.remove);

module.exports = router;
