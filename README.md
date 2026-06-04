# 🎙️ VoiceCore — Production-Grade Voice Cloning System

> A clean, modular, production-ready voice cloning system built on ElevenLabs, Node.js, and Redis — with persistent per-user voice memory, real-time TTS streaming, and a well-defined pipeline from audio sample to synthesized speech.

---

## Table of Contents

1. [Why This Architecture?](#why-this-architecture)
2. [How ElevenLabs Voice Cloning Works Under the Hood](#how-elevenlabs-voice-cloning-works-under-the-hood)
3. [System Architecture Overview](#system-architecture-overview)
4. [Full Pipeline — Step by Step](#full-pipeline--step-by-step)
5. [Memory System Design](#memory-system-design)
6. [Directory Structure](#directory-structure)
7. [Tech Stack Explained](#tech-stack-explained)
8. [Environment Setup](#environment-setup)
9. [API Reference](#api-reference)
10. [Key Design Decisions](#key-design-decisions)

---

## Why This Architecture?

Your original repo (`himasnhu77/VOICE-CLONING`) works — but it has several issues that will hurt you in production:

| Issue | Original Repo | VoiceCore |
|---|---|---|
| Memory storage | Flat JS file (`memory.js`) | Redis with TTL + namespaced keys |
| TTS server | Single Python file, no error handling | Express service layer + retry logic |
| Voice ID management | Hardcoded or ad-hoc | Per-user voice registry in Redis |
| Audio uploads | Dumped in root dir (`New Recording 10.wav`) | `uploads/` with UUID filenames + cleanup |
| Config management | No `.env` discipline | Centralized `config/` with Joi validation |
| Process model | `node server.js` directly | PM2 with cluster mode + graceful shutdown |
| No separation of concerns | `server.js` does everything | Routes → Controllers → Services → Adapters |

---

## How ElevenLabs Voice Cloning Works Under the Hood

This is the core of the system. Understanding this makes everything else click.

### What "Voice Cloning" Actually Means

ElevenLabs uses **Instant Voice Cloning (IVC)** — not model fine-tuning. The key difference:

- **Fine-tuned models** (like OpenVoice, Coqui YourTTS) train new weights on your audio. This takes time and compute.
- **Instant Voice Cloning** extracts a **voice embedding** from your sample and conditions a pre-trained neural TTS model on it.

The pre-trained model already knows how to speak. Your voice sample tells it *how your voice specifically sounds*.

### The Embedding Pipeline (What Happens Inside ElevenLabs)

```
Your WAV/MP3 sample
        │
        ▼
 ┌─────────────────────────────┐
 │  1. Audio Preprocessing     │
 │  - Resample to 22kHz mono   │
 │  - Normalize amplitude      │
 │  - Trim silence             │
 └────────────┬────────────────┘
              │
              ▼
 ┌─────────────────────────────┐
 │  2. Speaker Encoder         │
 │  (GE2E or similar LSTM)     │
 │                             │
 │  Input:  mel-spectrogram    │
 │  Output: 256-dim d-vector   │
 │          (voice embedding)  │
 └────────────┬────────────────┘
              │
              ▼
       [ Voice ID stored ]
       (ElevenLabs servers)
              │
              ▼ (at synthesis time)
 ┌─────────────────────────────┐
 │  3. Conditioned TTS Model   │
 │  (Transformer-based)        │
 │                             │
 │  Input:  text + d-vector    │
 │  Output: mel-spectrogram    │
 └────────────┬────────────────┘
              │
              ▼
 ┌─────────────────────────────┐
 │  4. Neural Vocoder          │
 │  (HiFi-GAN or WaveNet)      │
 │                             │
 │  Input:  mel-spectrogram    │
 │  Output: raw PCM waveform   │
 └────────────┬────────────────┘
              │
              ▼
       MP3 / WAV audio bytes
         streamed back to you
```

### The d-vector (Voice Embedding)

The **d-vector** is what makes your voice *your* voice. It encodes:

- Fundamental frequency (F0) — your pitch range
- Formant structure — the resonance of your vocal tract shape
- Speaking rhythm and prosody patterns
- Breathiness, nasality, vocal quality markers

Once ElevenLabs has this embedding, it can synthesize any text in your voice without re-uploading your sample. The `voice_id` returned by their API is just a pointer to where this embedding lives on their infrastructure.

### Stability vs. Similarity Sliders

When you call the TTS endpoint, you pass:
- `stability` (0–1): Controls how consistent the voice sounds across sentences. High = robotic but reliable. Low = expressive but variable.
- `similarity_boost` (0–1): How closely to match your original voice. High = sounds more like you but can amplify artifacts.

These are not post-processing effects. They are **inference-time parameters** passed directly to the decoder, influencing how much the model "deviates" from the learned voice embedding.

---

## System Architecture Overview

```
                          ┌────────────────────────────────┐
                          │         CLIENT                 │
                          │  (Browser / Postman / SDK)     │
                          └──────────────┬─────────────────┘
                                         │ HTTP / WebSocket
                                         ▼
                          ┌────────────────────────────────┐
                          │       API GATEWAY              │
                          │       (Express.js)             │
                          │                                │
                          │  /api/voices   (voice CRUD)    │
                          │  /api/tts      (synthesize)    │
                          │  /api/memory   (memory ops)    │
                          └───┬──────────────┬─────────────┘
                              │              │
              ┌───────────────▼──┐    ┌──────▼──────────────┐
              │  VoiceService    │    │   MemoryService      │
              │                  │    │                      │
              │ - clone()        │    │ - set(userId, key)   │
              │ - synthesize()   │    │ - get(userId, key)   │
              │ - list()         │    │ - listVoices(userId) │
              │ - delete()       │    │ - flush(userId)      │
              └────────┬─────────┘    └──────┬───────────────┘
                       │                     │
          ┌────────────▼──────┐   ┌──────────▼────────────┐
          │  ElevenLabs       │   │   Redis               │
          │  Adapter          │   │                       │
          │  (HTTP wrapper)   │   │  voice:{userId}:*     │
          │                   │   │  session:{userId}:*   │
          │  POST /voices     │   │  memory:{userId}:*    │
          │  POST /text-to-   │   │                       │
          │       speech/:id  │   └───────────────────────┘
          └────────┬──────────┘
                   │
          ┌────────▼──────────┐
          │  ElevenLabs API   │
          │  (External)       │
          └───────────────────┘
```

---

## Full Pipeline — Step by Step

### Phase 1: Voice Registration

```
User uploads audio sample
          │
          │  POST /api/voices/clone
          │  multipart/form-data { audio, userId, label }
          ▼
  [ Multer middleware ]
  - Validates MIME type (audio/wav, audio/mpeg, audio/ogg only)
  - Saves to uploads/{uuid}.{ext}
  - Max 25MB enforced
          │
          ▼
  [ VoiceController.clone() ]
          │
          ▼
  [ VoiceService.clone(userId, filePath, label) ]
  - Reads file as Buffer
  - Calls ElevenLabsAdapter.cloneVoice(buffer, name)
          │
          ▼
  [ ElevenLabs API ]
  POST https://api.elevenlabs.io/v1/voices/add
  Headers: { xi-api-key: ELEVENLABS_API_KEY }
  Body: FormData { name, files[], description }
          │
          ▼
  Response: { voice_id: "abc123...", name: "Himanshu" }
          │
          ▼
  [ MemoryService.registerVoice(userId, voiceId, label) ]
  Redis SET: voice:{userId}:{voiceId} = { label, createdAt, samplePath }
  Redis SADD: voices:{userId} = voiceId  (set of all voiceIds for user)
          │
          ▼
  Cleanup: delete temp file from uploads/
          │
          ▼
  Return { voiceId, label } to client
```

### Phase 2: Text-to-Speech Synthesis

```
Client sends text to synthesize
          │
          │  POST /api/tts
          │  { userId, voiceId, text, stability?, similarityBoost? }
          ▼
  [ TTSController.synthesize() ]
          │
          ▼
  [ MemoryService.getVoice(userId, voiceId) ]
  Validates voiceId belongs to this userId
  (Prevents unauthorized voice use)
          │
          ▼
  [ VoiceService.synthesize(voiceId, text, settings) ]
          │
          ▼
  [ ElevenLabsAdapter.textToSpeech(voiceId, text, settings) ]
  POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
  Headers: { xi-api-key, Accept: audio/mpeg }
  Body: {
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability, similarity_boost }
  }
          │
          ▼
  ElevenLabs streams back MP3 bytes
          │
          ▼
  [ Response streaming to client ]
  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Transfer-Encoding', 'chunked')
  elevenLabsStream.pipe(res)
  (No full buffering — first byte latency ~200–400ms)
```

### Phase 3: Voice Memory Lookup

```
Client requests all voices for a user
          │
          │  GET /api/voices?userId=abc
          ▼
  [ MemoryService.listVoices(userId) ]
  Redis SMEMBERS voices:{userId}  → [voiceId1, voiceId2, ...]
          │
          ▼
  Redis MGET voice:{userId}:{id} for each id
          │
          ▼
  Returns [ { voiceId, label, createdAt } ]
```

---

## Memory System Design

The memory layer is intentionally Redis-first. Here's the key schema:

```
Key Pattern                        Type    TTL         Purpose
─────────────────────────────────────────────────────────────────────
voice:{userId}:{voiceId}           Hash    90 days     Voice metadata
voices:{userId}                    Set     90 days     Index of voiceIds per user
session:{userId}:last_voice        String  24 hours    Last used voiceId
memory:{userId}:{key}              String  configurable  Arbitrary KV memory
```

### Why Redis and not a flat JS file?

Your original `memory.js` is a module-level singleton — fine for a single process, broken the moment you:
- Run 2+ Node processes (PM2 cluster mode)
- Restart the server (all state gone)
- Try to query memory per user
- Need TTL/expiry on old voices

Redis gives you: persistence, pub/sub, atomic operations, TTL natively, and horizontal scaling.

### Why not PostgreSQL?

For voice ID lookup (which is pure KV — userId → [voiceIds]), Redis is the right tool. There are no relational queries here. Postgres would be overkill until you need billing, user auth tables, or analytics.

---

## Directory Structure

```
voicecore/
│
├── src/
│   ├── config/
│   │   ├── index.js          # Central config with env validation (Joi)
│   │   └── redis.js          # Redis client singleton
│   │
│   ├── adapters/
│   │   └── elevenlabs.js     # All ElevenLabs API calls live here only
│   │                         # (one place to update if their API changes)
│   │
│   ├── services/
│   │   ├── voice.service.js  # Business logic: clone, synthesize, delete
│   │   └── memory.service.js # Redis read/write for voice registry + memory
│   │
│   ├── controllers/
│   │   ├── voice.controller.js   # HTTP handler: parse req, call service, send res
│   │   └── tts.controller.js     # HTTP handler: synthesize and stream audio
│   │
│   ├── routes/
│   │   ├── voice.routes.js   # /api/voices/* route definitions
│   │   ├── tts.routes.js     # /api/tts route definitions
│   │   └── index.js          # Mount all routers here
│   │
│   ├── middleware/
│   │   ├── upload.js         # Multer config (audio MIME check, size limit)
│   │   ├── validate.js       # Joi request body validation
│   │   └── errorHandler.js   # Global Express error handler
│   │
│   └── app.js                # Express setup: middleware, routes, error handler
│
├── uploads/                  # Temp audio uploads (auto-cleaned after cloning)
│   └── .gitkeep
│
├── tests/
│   ├── voice.service.test.js
│   └── memory.service.test.js
│
├── .env.example              # All required env vars documented here
├── .gitignore                # node_modules, .env, uploads/*.wav, uploads/*.mp3
├── ecosystem.config.js       # PM2 config: cluster mode, restart policy
├── package.json
└── README.md
```

### Why this structure works

Every layer has exactly one job:
- **adapters/** — talks to ElevenLabs. Nothing else imports the HTTP client.
- **services/** — holds business logic. No `req`/`res` objects in here.
- **controllers/** — just glues HTTP to services. No business logic.
- **routes/** — just maps paths to controllers. No logic.

If ElevenLabs changes their API, you edit one file: `adapters/elevenlabs.js`. Everything else stays the same.

---

## Tech Stack Explained

### Node.js + Express

The TTS pipeline is I/O bound (waiting on ElevenLabs API), not CPU bound. Node's async event loop is perfect for this — you can handle hundreds of simultaneous TTS requests without spawning threads.

**Why not the Python `tts_server.py` approach?** Python is fine for ML inference, but if you're just calling ElevenLabs over HTTP, you're introducing an extra network hop and process boundary for no benefit. Keep it in Node.

### Redis (via `ioredis`)

- `ioredis` over `redis` package: better TypeScript support, pipeline/cluster support built in, auto-reconnect by default.
- Use Redis **Hashes** for voice metadata (not JSON strings) — enables partial updates without deserializing the whole object.

### ElevenLabs `eleven_multilingual_v2` model

Use this model, not `eleven_monolingual_v1`. Reasons:
- Better prosody and naturalness even for English-only use cases
- Handles code-switching (Hindi + English, which you likely care about)
- Better at preserving voice characteristics from short samples

### Multer for file uploads

Handles `multipart/form-data`, stream-to-disk (not buffered in memory), MIME type filtering, and file size limits. Keep `uploads/` as a temp dir only — delete files immediately after the ElevenLabs clone API returns.

### Joi for validation

Validate every request body. A missing `userId` on a TTS request would silently use undefined as the Redis key — poisoning your memory store. Joi catches this at the edge before any service is called.

---

## Environment Setup

```bash
# Clone and install
git clone https://github.com/yourusername/voicecore
cd voicecore
npm install

# Copy env template
cp .env.example .env
```

**.env.example:**
```
# ElevenLabs
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_MODEL_ID=eleven_multilingual_v2

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
NODE_ENV=development

# Voice settings defaults
DEFAULT_STABILITY=0.5
DEFAULT_SIMILARITY_BOOST=0.75

# Upload limits
MAX_AUDIO_SIZE_MB=25
UPLOAD_DIR=./uploads
```

```bash
# Start Redis (Docker)
docker run -d -p 6379:6379 redis:7-alpine

# Dev
npm run dev       # nodemon

# Production (PM2 cluster)
pm2 start ecosystem.config.js
```

---

## API Reference

### `POST /api/voices/clone`

Upload an audio sample and create a cloned voice.

```
Content-Type: multipart/form-data

Fields:
  userId  string  required   Your user identifier
  label   string  required   Human-readable name ("Himanshu Work Voice")
  audio   file    required   WAV/MP3/OGG, max 25MB
```

**Response:**
```json
{
  "voiceId": "abc123xyz",
  "label": "Himanshu Work Voice",
  "createdAt": "2026-06-04T10:00:00Z"
}
```

---

### `POST /api/tts`

Synthesize text using a cloned voice.

```json
{
  "userId": "user_001",
  "voiceId": "abc123xyz",
  "text": "Hello, this is my cloned voice speaking.",
  "stability": 0.5,
  "similarityBoost": 0.75
}
```

**Response:** `audio/mpeg` stream (chunked)

---

### `GET /api/voices?userId=user_001`

List all cloned voices for a user.

**Response:**
```json
{
  "voices": [
    { "voiceId": "abc123xyz", "label": "Himanshu Work Voice", "createdAt": "..." },
    { "voiceId": "def456uvw", "label": "Himanshu Casual", "createdAt": "..." }
  ]
}
```

---

### `DELETE /api/voices/:voiceId?userId=user_001`

Delete a voice from ElevenLabs and remove from Redis memory.

---

## Key Design Decisions

**1. No Python process in the pipeline**

Your original repo runs a Python TTS server alongside Node. For ElevenLabs-based synthesis, this adds latency and operational complexity for zero benefit. Keep the stack to a single Node process.

**2. Stream audio, don't buffer it**

Never do `const audio = await elevenlabs.tts(...)` and then `res.send(audio)`. Buffer the entire response, wait for it, then send it. Instead, pipe the stream directly: `elevenLabsStream.pipe(res)`. This cuts time-to-first-audio from 2–4s to 200–400ms.

**3. Voice ID ownership is enforced in Redis**

Before any TTS call, verify the `voiceId` exists in `voices:{userId}`. Without this, any user can synthesize audio with any voice ID — a real authorization hole.

**4. Temp uploads are ephemeral**

Audio samples are only needed for the initial clone API call. After ElevenLabs returns a `voice_id`, the local file has zero value. Delete it immediately. Do not store user voice samples on disk.

**5. Single adapter for ElevenLabs**

All HTTP calls to ElevenLabs go through `src/adapters/elevenlabs.js`. This means: one place for retry logic, one place to update when their API changes, one place for rate limit handling.

---

## License

MIT
