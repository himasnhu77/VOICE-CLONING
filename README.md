# 🎙️ VoiceCore

Production-ready voice cloning system built on **ElevenLabs + Node.js + Express** — clean layered architecture, real-time TTS streaming, per-user voice memory.

---

## Architecture

The entire system follows one rule: `routes → controllers → services → adapters`. No exceptions.

```
Client
  │
  │  HTTP request
  ▼
┌─────────────────────────────────────────┐
│  routes/                                │
│  Maps URL paths to controllers only     │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  controllers/                           │
│  Parse req → call service → send res    │
│  No business logic lives here           │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  services/                              │  ← ALL logic lives here
│  voice.service.js  memory.service.js    │
│  No req/res objects. No fetch() calls.  │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  adapters/elevenlabs.js                 │  ← ONLY file that calls fetch()
│  cloneVoice()  textToSpeech()           │
│  deleteVoice() listVoices()             │
└──────────────────┬──────────────────────┘
                   │
             ElevenLabs API
```

**Why this matters:** If ElevenLabs changes their API tomorrow, you edit one file: `adapters/elevenlabs.js`. Nothing else touches their HTTP API — so nothing else breaks.

---

## Voice Clone Pipeline

What happens when a user uploads an audio sample:

```
POST /api/voices/clone  { userId, label, audio file }
          │
          ▼
Multer middleware
  - Checks MIME type (wav/mp3/ogg only, rejects others)
  - Saves file as UUID.ext → uploads/3f9a1b2c.wav
  - Enforces 25MB size limit
          │
          ▼
voice.controller.js
  - Validates userId and label are present
  - Passes req.file.path to service
          │
          ▼
voice.service.cloneVoice(userId, filePath, label)
  - Calls adapter with file path
  - Wraps everything in try/finally for cleanup
          │
          ▼
elevenlabs.cloneVoice(filePath, label)
  - Reads file as ReadStream
  - POST /v1/voices/add  (multipart)
  - Returns { voice_id: "abc123" }
          │
          ├──────────────────────────────────┐
          ▼                                  ▼
memory.service.registerVoice()         fs.unlink(filePath)
  Map: userId → { voiceId, label }       Delete temp file ALWAYS
  (persists in process memory)           (even if clone failed)
          │
          ▼
  return { voiceId, label, createdAt }
```

**Key design decision:** The temp audio file is deleted immediately after clone. ElevenLabs stores only the voice embedding (d-vector), not your original audio — so there's no reason to keep the file on disk.

---

## TTS Streaming Pipeline

What happens when a user requests synthesized speech:

```
POST /api/tts  { userId, voiceId, text, stability? }
          │
          ▼
memory.ownsVoice(userId, voiceId)
  - Checks the userId → voiceId mapping in memory
  - Returns 404 if voiceId doesn't belong to this user
  (Without this check: any userId can use any voiceId)
          │
          ▼
voice.service.synthesize(userId, voiceId, text, settings)
          │
          ▼
elevenlabs.textToSpeech(voiceId, text, settings)
  POST /v1/text-to-speech/:voiceId
  Headers: { Accept: audio/mpeg }
  Returns: Node.js readable stream (not a buffer)
          │
          ▼
audioStream.pipe(res)
  res headers: Content-Type: audio/mpeg
               Transfer-Encoding: chunked

  ┌─────────────────────────────────────────┐
  │  WITHOUT pipe (wrong way):              │
  │  Wait for full MP3 to download → 2-4s   │
  │  Buffer entire file in memory           │
  │  Then send to client                    │
  ├─────────────────────────────────────────┤
  │  WITH pipe (correct way):               │
  │  First audio chunk arrives → ~300ms     │
  │  Bytes flow directly client             │
  │  Zero full-file buffering               │
  └─────────────────────────────────────────┘
```

---

## How ElevenLabs Voice Cloning Works Internally

ElevenLabs uses **Instant Voice Cloning** — not model fine-tuning. This is the key distinction:

```
Fine-tuning (what ElevenLabs does NOT do):
  Your audio → train new model weights → takes hours, needs GPU

Instant Voice Cloning (what actually happens):
  Your audio → extract voice embedding → store as voice_id → done in seconds
```

The actual pipeline under the hood:

```
Your audio file
      │
      ▼
Audio preprocessing
  - Resample to 22kHz mono
  - Normalize amplitude
  - Trim silence at edges
      │
      ▼
Speaker Encoder  (LSTM-based neural net)
  Input:  mel-spectrogram of your audio
  Output: 256-dimensional d-vector
          (this is your "voice fingerprint")
      │
      ▼
d-vector stored on ElevenLabs servers
voice_id = pointer to your d-vector
      │
      ▼  (at synthesis time, when you call /text-to-speech)
Conditioned TTS Model  (Transformer-based)
  Input:  text tokens + your d-vector
  Output: mel-spectrogram
      │
      ▼
Neural Vocoder  (HiFi-GAN)
  Input:  mel-spectrogram
  Output: raw PCM audio waveform
      │
      ▼
Encoded as MP3, streamed back
```

**What the `stability` and `similarity_boost` params actually do:**

These are not post-processing effects. They are passed directly to the decoder at inference time:

- `stability` (0–1) — controls how much the model deviates from the "average" pronunciation of each phoneme. High = robotic but consistent. Low = expressive but variable between runs.
- `similarity_boost` (0–1) — how tightly the output matches your d-vector. High = sounds more like you, but also amplifies any artifacts in your voice sample.

---

## Memory System

The `memory.service.js` uses an in-process JavaScript `Map`. It works like this:

```
store = Map {
  "user_001" → Map {
    "abc123" → { voiceId: "abc123", label: "Himanshu work", createdAt: "..." }
    "def456" → { voiceId: "def456", label: "Himanshu casual", createdAt: "..." }
  },
  "user_002" → Map {
    "xyz789" → { voiceId: "xyz789", label: "Demo voice", createdAt: "..." }
  }
}
```

**Why not Redis?** For a single-process deployment, an in-memory Map is faster and simpler. If you need to scale to multiple processes, the comment at the top of `memory.service.js` tells you exactly what to swap — and nothing else in the codebase changes.

**Why not the original `memory.js` singleton?** The original was a flat module-level object — no per-user namespacing, lost on every restart, and broken the moment you ran two Node processes.

---

## Project Structure

```
voicecore/
├── index.js                    # Entry point — just starts the server
├── .env.example                # All required env vars documented
│
└── src/
    ├── app.js                  # Express setup, middleware mounting
    │
    ├── config/
    │   └── index.js            # Env vars validated on boot (throws if missing)
    │
    ├── adapters/
    │   └── elevenlabs.js       # ALL ElevenLabs HTTP calls live here only
    │
    ├── services/
    │   ├── voice.service.js    # clone, synthesize, delete logic
    │   └── memory.service.js   # userId → voiceId registry
    │
    ├── controllers/
    │   ├── voice.controller.js # Handles /api/voices/* requests
    │   └── tts.controller.js   # Handles /api/tts requests + streams audio
    │
    ├── routes/
    │   ├── index.js            # Mounts voice and tts routers
    │   ├── voice.routes.js     # /api/voices/* route definitions
    │   └── tts.routes.js       # /api/tts route definition
    │
    └── middleware/
        ├── upload.js           # Multer: MIME validation, UUID filenames, 25MB limit
        └── errorHandler.js     # Global Express error handler
```

---

## Setup

```bash
npm install
cp .env.example .env
# Add ELEVENLABS_API_KEY to .env

npm run dev   # development (nodemon)
npm start     # production
```

**.env.example:**
```
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

## API Reference

### Clone a voice
```
POST /api/voices/clone
Content-Type: multipart/form-data

Fields: userId, label, audio (file)
Response: { voiceId, label, createdAt }
```

### Synthesize speech
```
POST /api/tts
Content-Type: application/json

Body: { userId, voiceId, text, stability?, similarityBoost? }
Response: audio/mpeg stream
```

### List voices
```
GET /api/voices?userId=xxx
Response: { voices: [{ voiceId, label, createdAt }] }
```

### Delete a voice
```
DELETE /api/voices/:voiceId?userId=xxx
Response: { deleted: voiceId }
```

---

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Server | Node.js + Express | I/O bound workload, async streaming |
| File uploads | Multer | Stream-to-disk, MIME validation |
| Voice API | ElevenLabs | Best instant voice cloning |
| Memory | In-process Map | Simple KV, swap for Redis to scale |
| TTS model | eleven_multilingual_v2 | Better prosody, Hindi+English support |

---

## Branch

This is `feature/clean-folder-structure` — full refactor of the original monolithic `server.js`.

Original: [himasnhu77/VOICE-CLONING](https://github.com/himasnhu77/VOICE-CLONING)

---

MIT License
