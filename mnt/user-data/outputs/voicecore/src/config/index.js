require('dotenv').config();

const required = ['ELEVENLABS_API_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    baseUrl: 'https://api.elevenlabs.io/v1',
  },

  voice: {
    defaultStability: parseFloat(process.env.DEFAULT_STABILITY || '0.5'),
    defaultSimilarityBoost: parseFloat(process.env.DEFAULT_SIMILARITY_BOOST || '0.75'),
  },

  upload: {
    maxSizeMb: parseInt(process.env.MAX_AUDIO_SIZE_MB || '25'),
    dir: process.env.UPLOAD_DIR || './uploads',
    allowedMimes: ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  },

  memory: {
    // in-process Map — swap for Redis adapter if you need multi-process
    voiceTtlMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  },
};
