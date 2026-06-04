# 🎙️ VoiceCore

A clean, production-ready voice cloning system built on **ElevenLabs**, **Node.js**, and **Express** — with persistent per-user voice memory, real-time TTS streaming, and a proper layered architecture.

> Refactored from a monolithic `server.js` into a clean `routes → controllers → services → adapters` pattern.

---

## 📁 Project Structure

```
voicecore/
├── index.js                    # Entry point
├── .env.example                # Environment variables template
│
└── src/
    ├── app.js                  # Express setup, middleware, routes
    │
    ├── config/
    │   └── index.js            # All env vars validated in one place
    │
    ├── adapters/
    │   └── elevenlabs.js       # All ElevenLabs API calls live here only
    │
    ├── services/
    │   ├── voice.service.js    # Business logic: clone, synthesize, delete
    │   └── memory.service.js   # Per-user voice registry (in-memory Map)
    │
    ├── controllers/
    │   ├── voice.controller.js # Handles clone, list, delete requests
    │   └── tts.controller.js   # Handles TTS synthesis + audio streaming
    │
    ├── routes/
    │   ├── index.js            # Mounts all routers
    │   ├── voice.routes.js     # /api/voices/*
    │   └── tts.routes.js       # /api/tts
    │
    └── middleware/
        ├── upload.js           # Multer config with MIME validation
        └── errorHandler.js     # Global Express error handler
```

---

## ⚡ How It Works

```
Client
  │
  ▼
Express Router
  │
  ▼
Controller        ← parses req, sends res, no logic
  │
  ▼
Service           ← all business logic lives here
  │
  ▼
Adapter           ← only file that talks to ElevenLabs API
  │
  ▼
ElevenLabs API
```

### Voice Cloning Pipeline

```
Upload audio sample
        │
        ▼
Multer middleware (MIME check + UUID filename)
        │
        ▼
VoiceService.cloneVoice()
        │
        ▼
ElevenLabsAdapter.cloneVoice()
  → POST /v1/voices/add
  → Returns voice_id
        │
        ▼
MemoryService.registerVoice(userId, voiceId)
        │
        ▼
Delete temp file from uploads/
        │
        ▼
Return { voiceId, label } to client
```

### TTS Synthesis Pipeline

```
POST /api/tts { userId, voiceId, text }
        │
        ▼
MemoryService.ownsVoice(userId, voiceId)  ← auth check
        │
        ▼
ElevenLabsAdapter.textToSpeech()
  → POST /v1/text-to-speech/:voiceId
  → Returns MP3 stream
        │
        ▼
Stream piped directly to client (chunked)
  → No buffering, first audio in ~300ms
```

---

## 🚀 Setup

```bash
# Install dependencies
npm install

# Copy env template
cp .env.example .env
# Add your ELEVENLABS_API_KEY

# Run dev server
npm run dev

# Run production
npm start
```

---

## 🔑 Environment Variables

```env
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_MODEL_ID=eleven_multilingual_v2

PORT=3000
NODE_ENV=development

DEFAULT_STABILITY=0.5
DEFAULT_SIMILARITY_BOOST=0.75

MAX_AUDIO_SIZE_MB=25
UPLOAD_DIR=./uploads
```

---

## 📡 API Reference

### Clone a Voice
```
POST /api/voices/clone
Content-Type: multipart/form-data

Fields:
  userId  — your user ID
  label   — name for this voice
  audio   — WAV/MP3/OGG file (max 25MB)

Response:
  { voiceId, label, createdAt }
```

### Synthesize Speech
```
POST /api/tts
Content-Type: application/json

Body:
  { userId, voiceId, text, stability?, similarityBoost? }

Response:
  audio/mpeg stream (chunked)
```

### List Voices
```
GET /api/voices?userId=xxx

Response:
  { voices: [{ voiceId, label, createdAt }] }
```

### Delete a Voice
```
DELETE /api/voices/:voiceId?userId=xxx

Response:
  { deleted: voiceId }
```

---

## 🧠 How ElevenLabs Voice Cloning Works

ElevenLabs uses **Instant Voice Cloning** — not model fine-tuning. Here's what happens under the hood:

```
Your audio sample
      │
      ▼
Audio preprocessing (resample to 22kHz, normalize, trim silence)
      │
      ▼
Speaker Encoder (LSTM-based)
  Input:  mel-spectrogram of your audio
  Output: 256-dim d-vector (your voice fingerprint)
      │
      ▼
voice_id stored on ElevenLabs servers
      │
      ▼  (at synthesis time)
Conditioned TTS Model
  Input:  text + your d-vector
  Output: mel-spectrogram
      │
      ▼
Neural Vocoder (HiFi-GAN)
  Input:  mel-spectrogram
  Output: raw PCM audio
      │
      ▼
MP3 bytes streamed back to you
```

The `voice_id` is just a pointer to your stored d-vector. Once cloned, ElevenLabs never needs your original audio again.

---

## 🛠️ Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Server | Node.js + Express | I/O bound workload, perfect for async streaming |
| File uploads | Multer | Stream-to-disk, MIME validation, size limits |
| Voice API | ElevenLabs | Best instant voice cloning quality |
| Memory | In-process Map | Simple KV store, swap for Redis to scale |
| TTS model | eleven_multilingual_v2 | Better prosody, supports Hindi+English |

---

## 📝 Key Design Decisions

**1. No Python process** — original repo had `tts_server.py` running alongside Node. For ElevenLabs-based synthesis you're just proxying HTTP — Python adds latency for zero benefit.

**2. Stream audio, don't buffer** — `elevenLabsStream.pipe(res)` gives first audio in ~300ms. Buffering the full response first adds 2-4s delay.

**3. Voice ownership enforced** — before any TTS call, `MemoryService.ownsVoice(userId, voiceId)` is checked. Without this, any userId can synthesize with any voiceId.

**4. Adapters are the only HTTP callers** — `src/adapters/elevenlabs.js` is the only file that calls `fetch()`. If ElevenLabs changes their API, one file changes.

**5. Temp uploads are ephemeral** — audio files deleted immediately after clone API returns. No user voice samples stored on disk.

---

## 📂 Branch Info

This is the `feature/clean-folder-structure` branch — a full refactor of the original monolithic `server.js` into a proper layered architecture.

Original repo: [himasnhu77/VOICE-CLONING](https://github.com/himasnhu77/VOICE-CLONING)

---

## 📄 License

MIT
