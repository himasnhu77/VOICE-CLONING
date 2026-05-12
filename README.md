# 🎙️ VOICE-CLONING

A real-time voice cloning system that lets you build an AI assistant that speaks in **your own voice**. The project is split into two servers — a **Node.js chat backend** (`server.js`) and a **Python TTS microservice** (`tts_server.py`) — that work together to deliver a full conversational pipeline: text in → LLM response → cloned-voice audio out.

---

## 🏗️ Architecture

```
Browser / Client
      │  (HTTP + WebSocket)
      ▼
┌─────────────────────────┐
│   Node.js Server        │  server.js  (port 3000)
│   Express + OpenAI SDK  │
│   Neo4j Memory Layer    │
│   Deepgram STT          │
└────────────┬────────────┘
             │  POST /synthesize
             ▼
┌─────────────────────────┐
│   Python TTS Server     │  tts_server.py  (port 8000)
│   FastAPI + XTTS-v2     │
│   Coqui TTS             │
│   GPU / CPU inference   │
└─────────────────────────┘
```

### Data flow

1. User speaks → Deepgram transcribes audio in real time.
2. Transcript hits the Node.js server, which optionally stores/retrieves context from Neo4j.
3. The LLM (via OpenAI-compatible API) generates a reply.
4. Node.js POSTs the reply text to the Python TTS server.
5. XTTS-v2 synthesises the speech using your voice sample WAV.
6. Streamed WAV audio is returned and played back to the user.

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| HTTP / API server | Node.js + Express |
| AI chat | OpenAI SDK (compatible with Ollama or OpenAI) |
| Speech-to-Text | Deepgram SDK v5 (`nova-2-phonecall`) |
| Text-to-Speech | Coqui TTS — XTTS-v2 (voice cloning) |
| TTS API | FastAPI + Uvicorn |
| Memory / context | Neo4j (graph DB — Caller, Entity, Memory nodes) |
| Frontend | HTML + Vanilla JS (`public/`) |

---

## 📁 Project Structure

```
VOICE-CLONING/
├── server.js              # Node.js backend — chat, STT, memory orchestration
├── memory.js              # Neo4j helper — read/write conversation memory
├── tts_server.py          # Python FastAPI — XTTS-v2 voice synthesis endpoint
├── package.json           # Node dependencies
├── my_voice_sample.wav    # YOUR voice sample (6+ sec, clean audio)
├── New Recording 10.wav   # Alternative/test voice sample
├── public/                # Static frontend served by Express
│   └── index.html         # Chat UI
└── __pycache__/           # Python bytecode cache
```

---

## ⚙️ Prerequisites

### System requirements

- **Node.js** v18+ and npm
- **Python** 3.10+
- **CUDA GPU** (strongly recommended for XTTS-v2; CPU works but is slow)
- A **Neo4j** instance — local, Docker, or [Neo4j Aura](https://neo4j.com/cloud/aura/) (free tier works)

### API keys / services

| Service | Purpose | Required |
|---|---|---|
| OpenAI API **or** local Ollama | LLM responses | Yes |
| Deepgram | Real-time speech-to-text | Yes |
| Neo4j | Persistent conversation memory | Yes |

---

## 🚀 Setup & Installation

### 1. Clone the repository

```bash
git clone https://github.com/himasnhu77/VOICE-CLONING.git
cd VOICE-CLONING
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Install Python dependencies

```bash
pip install TTS fastapi uvicorn pydantic torch
```

> **GPU users:** Install the CUDA-enabled version of PyTorch from [pytorch.org](https://pytorch.org/get-started/locally/) before running `pip install TTS`.

### 4. Add your voice sample

Record at least **6 seconds** of clean speech (no background noise, no music) and save it as:

```
my_voice_sample.wav
```

Place it in the project root. The quality of this sample directly determines how realistic the cloned voice sounds.

### 5. Configure environment variables

Create a `.env` file in the project root:

```env
# LLM
OPENAI_API_KEY=your_openai_key
# Or for local Ollama: OPENAI_BASE_URL=http://localhost:11434/v1

# Speech-to-Text
DEEPGRAM_API_KEY=your_deepgram_key

# Neo4j memory
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password

# TTS microservice (Python server URL)
TTS_SERVER_URL=http://localhost:8000
```

---

## ▶️ Running the Project

You need **two terminals** — one for each server.

### Terminal 1 — Python TTS server

```bash
uvicorn tts_server:app --host 0.0.0.0 --port 8000
```

On first run, XTTS-v2 model weights (~2 GB) are downloaded automatically. Subsequent starts load from cache.

Expected output:
```
[TTS] Loading XTTS-v2 on cuda...
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Terminal 2 — Node.js backend

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## 🛠️ API Reference

### Python TTS Server (`http://localhost:8000`)

#### `POST /synthesize`

Synthesise text using the cloned voice.

**Request body:**
```json
{
  "text": "Hello, this is my cloned voice speaking.",
  "language": "en"
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `text` | string | required | Text to speak (max 2000 chars) |
| `language` | string | `"en"` | Language code — `"en"`, `"hi"`, `"fr"`, etc. |

**Response:** `audio/wav` stream (inline)

#### `GET /health`

```json
{
  "status": "ok",
  "model": "xtts_v2",
  "device": "cuda",
  "voice_sample_found": true
}
```

---

## 🧠 Memory System (Neo4j)

`memory.js` manages a graph-based memory layer with three node types:

- **Caller** — represents the user/session
- **Entity** — people, places, topics mentioned in conversation
- **Memory** — individual conversation turns linked to Caller and Entity nodes

This allows the assistant to recall context from previous calls rather than treating every conversation as a blank slate.

---

## 🌍 Multilingual Voice Cloning

XTTS-v2 supports **17+ languages** out of the box. Pass the `language` field in the synthesis request:

| Language | Code |
|---|---|
| English | `en` |
| Hindi | `hi` |
| Spanish | `es` |
| French | `fr` |
| German | `de` |
| Japanese | `ja` |
| Chinese | `zh-cn` |

---

## 🔧 Troubleshooting

**`Voice sample not found` error**
→ Ensure `my_voice_sample.wav` is in the project root and is a valid WAV file.

**XTTS-v2 is slow / timing out**
→ CPU inference is expected to be slow. Use a CUDA GPU. As a workaround, reduce `max_tokens` in the LLM call so responses are shorter.

**Deepgram WebSocket closes with `1005`**
→ This is a silent close. Check your Deepgram API key and ensure the audio format sent matches the configured encoding (typically `ulaw_8000` for telephony or `linear16` for browser mic).

**Neo4j connection refused**
→ Confirm Neo4j is running and `NEO4J_URI` in `.env` is correct. For Aura, use the `neo4j+s://` URI from the Aura console.

**Port 8000 already in use**
→ Change the Uvicorn port and update `TTS_SERVER_URL` in `.env` accordingly.

---

## 🗺️ Roadmap

- [ ] Emotion-aware synthesis (adjust TTS style based on LLM sentiment output)
- [ ] Real-time streaming TTS (chunk audio while generating)
- [ ] Twilio integration for inbound/outbound phone calls
- [ ] Multi-tenant voice profiles (per-user voice samples)
- [ ] Docker Compose setup for one-command startup

---

## 📄 License

This project is currently unlicensed. Contact the author before using in production.

---

## 👤 Author

**Himanshu** — [@himasnhu77](https://github.com/himasnhu77)

Built as part of a larger AI voice + memory ecosystem including calling agents, CRM automation, and voice-cloned email clients.
