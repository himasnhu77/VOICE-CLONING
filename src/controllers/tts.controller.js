const voiceService = require('../services/voice.service');

/**
 * POST /api/tts
 * Body: { userId, voiceId, text, stability?, similarityBoost? }
 *
 * Streams MP3 audio directly to client — no full buffering.
 */
async function synthesize(req, res, next) {
  try {
    const { userId, voiceId, text, stability, similarityBoost } = req.body;

    if (!userId || !voiceId || !text) {
      return res.status(400).json({ error: 'userId, voiceId, and text are required' });
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text must be a non-empty string' });
    }

    const audioStream = await voiceService.synthesize(userId, voiceId, text, {
      stability,
      similarityBoost,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Pipe directly — client receives audio as it streams in
    audioStream.pipe(res);

    audioStream.on('error', (err) => next(err));
  } catch (err) {
    next(err);
  }
}

module.exports = { synthesize };
