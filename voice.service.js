const fs = require('fs');
const elevenlabs = require('../adapters/elevenlabs');
const memory = require('./memory.service');

/**
 * Clone a voice from an uploaded audio file.
 * Registers it in memory and cleans up the temp file.
 */
async function cloneVoice(userId, filePath, label) {
  let voiceData;

  try {
    voiceData = await elevenlabs.cloneVoice(filePath, label);
  } finally {
    // Always delete temp upload — even if clone fails
    fs.unlink(filePath, () => {});
  }

  memory.registerVoice(userId, voiceData.voice_id, label);

  return {
    voiceId: voiceData.voice_id,
    label,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Synthesize text using a user's cloned voice.
 * Returns a readable stream of MP3 bytes.
 *
 * Throws if the voiceId doesn't belong to this userId.
 */
async function synthesize(userId, voiceId, text, settings = {}) {
  if (!memory.ownsVoice(userId, voiceId)) {
    const err = new Error(`Voice ${voiceId} not found for user ${userId}`);
    err.status = 404;
    throw err;
  }

  return elevenlabs.textToSpeech(voiceId, text, settings);
}

/**
 * Delete a voice from ElevenLabs and remove from memory.
 */
async function deleteVoice(userId, voiceId) {
  if (!memory.ownsVoice(userId, voiceId)) {
    const err = new Error(`Voice ${voiceId} not found for user ${userId}`);
    err.status = 404;
    throw err;
  }

  await elevenlabs.deleteVoice(voiceId);
  memory.removeVoice(userId, voiceId);

  return { deleted: voiceId };
}

/**
 * List all cloned voices for a user from memory.
 */
function listVoices(userId) {
  return memory.listVoices(userId);
}

module.exports = { cloneVoice, synthesize, deleteVoice, listVoices };
