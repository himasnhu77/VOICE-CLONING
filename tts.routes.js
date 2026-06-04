const router = require('express').Router();
const ttsController = require('../controllers/tts.controller');

router.post('/', ttsController.synthesize);

module.exports = router;
