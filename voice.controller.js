const voiceService = require('../services/voice.service');

/**
 * POST /api/voices/clone
 * Body: multipart/form-data { userId, label, audio (file) }
 */
async function clone(req, res, next) {
  try {
    const { userId, label } = req.body;

    if (!userId || !label) {
      return res.status(400).json({ error: 'userId and label are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const result = await voiceService.cloneVoice(userId, req.file.path, label);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/voices?userId=xxx
 */
function list(req, res, next) {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const voices = voiceService.listVoices(userId);
    res.json({ voices });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/voices/:voiceId?userId=xxx
 */
async function remove(req, res, next) {
  try {
    const { voiceId } = req.params;
    const { userId } = req.query;

    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const result = await voiceService.deleteVoice(userId, voiceId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { clone, list, remove };
