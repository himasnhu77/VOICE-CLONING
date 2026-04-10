require("dotenv").config();

const express = require("express");
const path = require("path");
const OpenAI = require("openai");
const { saveSelectiveMemory, recallMemory, recallRelatedTopics, getAllSessions } = require("./memory");

const app = express();
const PORT = 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "aae2f5b9205fea4152701c59ddc2e39a67d31fa1";

// ─── OpenAI Client Setup ──────────────────────────────────────────────────────
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || undefined;
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY  || (OPENAI_BASE_URL ? "ollama" : "");
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || "missing-key",
  ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
});

// ─── Local XTTS-v2 TTS microservice ──────────────────────────────────────────
// Run tts_server.py alongside this server:
//   uvicorn tts_server:app --host 0.0.0.0 --port 8000
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || "http://localhost:8000";

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── Agent Definitions ────────────────────────────────────────────────────────
const MODEL_DEFAULT = process.env.OPENAI_MODEL        || "gpt-4o-mini";
const MODEL_VISION  = process.env.OPENAI_VISION_MODEL || "gpt-4o";

const AGENTS = {
  planner:  { model: MODEL_DEFAULT, role: "Break down user query and decide routing" },
  coder:    { model: MODEL_DEFAULT, role: "Write code and technical answers" },
  vision:   { model: MODEL_VISION,  role: "Analyze images" },
  general:  { model: MODEL_DEFAULT, role: "Answer general questions" },
  reviewer: { model: MODEL_DEFAULT, role: "Improve and refine final output" },
};

// ─── Core OpenAI Caller ───────────────────────────────────────────────────────
async function callOpenAI(model, messages) {
  const response = await openai.chat.completions.create({ model, messages });
  return response.choices[0]?.message?.content || "";
}

// ─── Planner Agent ────────────────────────────────────────────────────────────
async function plannerAgent(userMessage) {
  const prompt = `You are a routing agent. Classify the user query into EXACTLY one of:
- code     (programming, debugging, scripts, technical)
- vision   (image analysis, describe image, what is in picture)
- general  (everything else)

User query: "${userMessage}"

Reply with ONE word only. No explanation.`;

  const result = await callOpenAI(AGENTS.planner.model, [{ role: "user", content: prompt }]);
  const clean  = result.trim().toLowerCase();
  if (clean.includes("code"))   return "code";
  if (clean.includes("vision")) return "vision";
  return "general";
}

// ─── Memory Importance Detector ───────────────────────────────────────────────
async function detectImportantMemory(userText) {
  const prompt = `You are a memory filter. Analyze if this message contains any of:
1. Facts about the user: name, age, job, location, skills, preferences
2. User interests or topics they care about

Message: "${userText}"

Reply in this exact JSON format only. No explanation:
{
  "shouldSave": true or false,
  "reason": "one short sentence why",
  "type": "user_fact" or "interest" or "none",
  "extractedFact": "the key fact in under 15 words"
}`;

  try {
    const result    = await callOpenAI(AGENTS.planner.model, [{ role: "user", content: prompt }]);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { shouldSave: false };
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn("[MemoryDetector] Could not parse AI response:", e.message);
    return { shouldSave: false };
  }
}

// ─── Task Agents ──────────────────────────────────────────────────────────────
async function coderAgent(messages) {
  return await callOpenAI(AGENTS.coder.model, [
    { role: "system", content: "You are an expert programmer. Only write code if needed. Give clear, well-commented code with brief explanations. Use markdown code blocks." },
    ...messages,
  ]);
}

async function visionAgent(messages) {
  const processed = messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.images) && msg.images.length > 0) {
      const text = typeof msg.content === "string" ? msg.content : "";
      return {
        role: "user",
        content: [
          { type: "text", text: text || "Describe this image." },
          ...msg.images.map((img) => ({
            type: "image_url",
            image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
          })),
        ],
      };
    }
    return msg;
  });

  return await callOpenAI(AGENTS.vision.model, [
    { role: "system", content: "You are a vision AI. Describe images clearly and in detail." },
    ...processed,
  ]);
}

async function generalAgent(messages) {
  return await callOpenAI(AGENTS.general.model, [
    { role: "system", content: "You are a helpful, concise AI assistant. Give clear and accurate answers." },
    ...messages,
  ]);
}

// ─── Reviewer Agent ───────────────────────────────────────────────────────────
async function reviewerAgent(content, type) {
  const instructions = {
    code:    "Review this code response. Fix any issues, improve clarity, ensure code is correct and well explained.",
    vision:  "Review this image description. Make it clearer and more structured.",
    general: "Review this response. Make it clearer, better structured, and more helpful.",
  };

  const prompt = `${instructions[type] || instructions.general}

--- Original Response ---
${content}
--- End ---

Provide the improved version only. No meta-commentary.`;

  return await callOpenAI(AGENTS.reviewer.model, [{ role: "user", content: prompt }]);
}

// ─── Models list endpoint ─────────────────────────────────────────────────────
app.get("/api/models", (req, res) => {
  res.json(Object.entries(AGENTS).map(([id, a]) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    role:  a.role,
    model: a.model,
  })));
});

// ─── Sessions endpoint ────────────────────────────────────────────────────────
app.get("/api/sessions", async (req, res) => {
  try {
    res.json(await getAllSessions());
  } catch (e) {
    console.error("[Sessions] Neo4j error:", e.message);
    res.json([]);
  }
});

// ─── Deepgram STT token ───────────────────────────────────────────────────────
app.get("/api/deepgram-token", (req, res) => {
  if (!DEEPGRAM_API_KEY) return res.status(500).json({ error: "DEEPGRAM_API_KEY not set" });
  res.json({ key: DEEPGRAM_API_KEY });
});

// ─── TTS endpoint — proxies to local XTTS-v2 Python microservice ─────────────
//
// Before using this, start the Python TTS server:
//   pip install TTS fastapi uvicorn pydantic
//   uvicorn tts_server:app --host 0.0.0.0 --port 8000
//
// Place your 6-second voice WAV at: ./my_voice_sample.wav
app.post("/api/tts", async (req, res) => {
  const { text, language = "en" } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text field is required" });
  }

  // XTTS-v2 works best under ~2000 chars per request
  const trimmed = text.length > 2000 ? text.slice(0, 2000) + "..." : text;
  console.log(`[TTS] chars=${trimmed.length}  language=${language}`);

  try {
    // 1. Health-check — give a clear error if the Python service isn't running
    let healthOk = false;
    try {
      const health = await fetch(`${TTS_SERVICE_URL}/health`);
      healthOk = health.ok;
    } catch (_) {
      healthOk = false;
    }

    if (!healthOk) {
      return res.status(503).json({
        error:
          "XTTS-v2 service is not running.\n" +
          "Start it with:\n" +
          "  uvicorn tts_server:app --host 0.0.0.0 --port 8000",
      });
    }

    // 2. Forward synthesis request to the Python microservice
    const ttsRes = await fetch(`${TTS_SERVICE_URL}/synthesize`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text: trimmed, language }),
    });

    if (!ttsRes.ok) {
      const errBody = await ttsRes.text();
      console.error("[TTS] Python service error:", ttsRes.status, errBody);
      return res.status(ttsRes.status).json({ error: `TTS service error: ${errBody}` });
    }

    // 3. Stream WAV audio bytes back to the browser
    res.setHeader("Content-Type",      "audio/wav");
    res.setHeader("Transfer-Encoding", "chunked");

    const reader = ttsRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (e) {
    console.error("[TTS] Unexpected error:", e.message);
    res.status(500).json({ error: "TTS route error: " + e.message });
  }
});

// ─── Main Multi-Agent Chat Endpoint ──────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, sessionId = "default_session" } = req.body;

  const lastMessage = messages[messages.length - 1];
  const userText    =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : lastMessage.content?.find?.((c) => c.type === "text")?.text || "";

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // ── Step 0: Memory recall ─────────────────────────────────────────────
    send({ agent: "memory", status: "Loading important memories..." });
    let enrichedMessages = [...messages];

    try {
      const pastMemory    = await recallMemory(sessionId);
      const relatedTopics = await recallRelatedTopics(sessionId);

      if (pastMemory.length > 0) {
        const memoryContext = pastMemory.map((m) => `[${m.type || "fact"}] ${m.content}`).join("\n");
        const topicsContext = relatedTopics.length > 0 ? `\nUser interests: ${relatedTopics.join(", ")}` : "";
        enrichedMessages = [
          {
            role:    "system",
            content: `You know these facts about this user:\n\n${memoryContext}${topicsContext}\n\nPersonalize naturally.`,
          },
          ...messages,
        ];
        send({ agent: "memory", status: `Recalled ${pastMemory.length} memories ✓` });
      } else {
        send({ agent: "memory", status: "No memories yet — learning from this conversation" });
      }
    } catch (memErr) {
      console.warn("[Memory] Neo4j unavailable:", memErr.message);
      send({ agent: "memory", status: "Memory unavailable — running without it" });
    }

    // ── Step 1: Planner ───────────────────────────────────────────────────
    send({ agent: "planner", status: "Planner agent thinking..." });
    const hasImage = Array.isArray(lastMessage.images) && lastMessage.images.length > 0;
    const decision = hasImage ? "vision" : await plannerAgent(userText);
    send({ agent: "planner", decision, status: `Routing to → ${decision} agent` });

    // ── Step 2: Task agent ────────────────────────────────────────────────
    send({ agent: decision, status: `${decision.charAt(0).toUpperCase() + decision.slice(1)} agent working...` });
    let result = "";
    if (decision === "code")        result = await coderAgent(enrichedMessages);
    else if (decision === "vision") result = await visionAgent(enrichedMessages);
    else                            result = await generalAgent(enrichedMessages);

    // ── Step 3: Reviewer ──────────────────────────────────────────────────
    send({ agent: "reviewer", status: "Reviewer agent improving output..." });
    const finalOutput = await reviewerAgent(result, decision);

    // ── Step 4: Memory save ───────────────────────────────────────────────
    try {
      send({ agent: "memory", status: "Checking if message is worth remembering..." });
      const memoryCheck = await detectImportantMemory(userText);
      if (memoryCheck.shouldSave) {
        await saveSelectiveMemory(sessionId, memoryCheck.extractedFact, memoryCheck.type, memoryCheck.reason);
        console.log(`[Memory] ✅ Saved: "${memoryCheck.extractedFact}" (${memoryCheck.type})`);
        send({ agent: "memory", status: `Remembered: "${memoryCheck.extractedFact}" ✓` });
      } else {
        send({ agent: "memory", status: "Not important enough to remember — skipped" });
      }
    } catch (saveErr) {
      console.warn("[Memory] Could not save:", saveErr.message);
    }

    // ── Step 5: Stream output ─────────────────────────────────────────────
    send({ agent: "done", status: "Streaming final response..." });
    for (const word of finalOutput.split(" ")) {
      send({ token: word + " " });
      await new Promise((r) => setTimeout(r, 18));
    }
    send({ done: true });

  } catch (e) {
    console.error(e);
    const root     = e?.cause?.cause?.message || e?.cause?.message || e?.message || String(e);
    const isAuth   = root.includes("401") || root.includes("API key") || root.includes("Incorrect API key");
    const isNet    = root.includes("ENOTFOUND") || root.includes("fetch failed") || root.includes("ECONNREFUSED") || root.includes("ETIMEDOUT");
    send({
      error: isAuth ? "Invalid or missing OpenAI API key. Set OPENAI_API_KEY in .env."
           : isNet  ? `Cannot reach the AI API (${root}). Check internet or Ollama config.`
           : "Agent pipeline error: " + root,
    });
  }

  res.end();
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   🤖 Multi-Agent OpenAI System       ║
║   http://localhost:${PORT}               ║
╚══════════════════════════════════════╝
API:  ${OPENAI_BASE_URL || "https://api.openai.com/v1"}
TTS:  XTTS-v2 (local, free) → ${TTS_SERVICE_URL}

Agents:
  🧠 Planner   → ${AGENTS.planner.model}
  💻 Coder     → ${AGENTS.coder.model}
  👁  Vision    → ${AGENTS.vision.model}
  ✨ Reviewer   → ${AGENTS.reviewer.model}
  🎤 STT       → Deepgram Nova-2
  🔊 TTS       → XTTS-v2 (your cloned voice, runs locally)
  🗄  Memory    → Neo4j
`);
});