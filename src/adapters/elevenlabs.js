const FormData = require('form-data');
const fs = require('fs');
const fetch = require('node-fetch');
const { elevenlabs } = require('../config');

const headers = () => ({
  'xi-api-key': elevenlabs.apiKey,
});

/**
 * Upload an audio file and create a cloned voice on ElevenLabs.
 * Returns { voice_id, name }
 */
async function cloneVoice(filePath, name, description = '') {
  const form = new FormData();
  form.append('name', name);
  form.append('description', description);
  form.append('files', fs.createReadStream(filePath));

  const res = await fetch(`${elevenlabs.baseUrl}/voices/add`, {
    method: 'POST',
    headers: { ...headers(), ...form.getHeaders() },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs cloneVoice failed (${res.status}): ${err}`);
  }

  return res.json(); // { voice_id, name }
}

/**
 * Synthesize text using a voice ID.
 * Returns a readable stream of MP3 audio bytes.
 */
async function textToSpeech(voiceId, text, settings = {}) {
  const body = {
    text,
    model_id: elevenlabs.modelId,
    voice_settings: {
      stability: settings.stability ?? 0.5,
      similarity_boost: settings.similarityBoost ?? 0.75,
    },
  };

  const res = await fetch(
    `${elevenlabs.baseUrl}/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs textToSpeech failed (${res.status}): ${err}`);
  }

  return res.body; // Node.js readable stream
}

/**
 * Delete a voice from ElevenLabs.
 */
async function deleteVoice(voiceId) {
  const res = await fetch(`${elevenlabs.baseUrl}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs deleteVoice failed (${res.status}): ${err}`);
  }

  return true;
}

/**
 * List all voices on the ElevenLabs account.
 */
async function listVoices() {
  const res = await fetch(`${elevenlabs.baseUrl}/voices`, {
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs listVoices failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.voices;
}

module.exports = { cloneVoice, textToSpeech, deleteVoice, listVoices };
