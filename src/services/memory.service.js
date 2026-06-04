/**
 * MemoryService
 *
 * Stores voice registrations per user using an in-process Map.
 * Each entry: { voiceId, label, createdAt }
 *
 * To scale to multiple processes: swap the Map for a Redis client
 * in this file only — nothing else in the codebase changes.
 */

// store: Map<userId, Map<voiceId, { label, createdAt }>>
const store = new Map();

function _getUser(userId) {
  if (!store.has(userId)) store.set(userId, new Map());
  return store.get(userId);
}

/**
 * Register a new cloned voice for a user.
 */
function registerVoice(userId, voiceId, label) {
  const userVoices = _getUser(userId);
  userVoices.set(voiceId, { voiceId, label, createdAt: new Date().toISOString() });
}

/**
 * Get a single voice entry for a user.
 * Returns null if not found.
 */
function getVoice(userId, voiceId) {
  const userVoices = _getUser(userId);
  return userVoices.get(voiceId) || null;
}

/**
 * List all voices registered for a user.
 */
function listVoices(userId) {
  const userVoices = _getUser(userId);
  return Array.from(userVoices.values());
}

/**
 * Remove a voice from the registry.
 */
function removeVoice(userId, voiceId) {
  const userVoices = _getUser(userId);
  return userVoices.delete(voiceId);
}

/**
 * Check if a voiceId belongs to a given userId.
 */
function ownsVoice(userId, voiceId) {
  return _getUser(userId).has(voiceId);
}

module.exports = { registerVoice, getVoice, listVoices, removeVoice, ownsVoice };
