const router = require('express').Router();
const voiceRoutes = require('./voice.routes');
const ttsRoutes = require('./tts.routes');

router.use('/voices', voiceRoutes);
router.use('/tts', ttsRoutes);

module.exports = router;
