# tts_server.py
# Install deps: pip install TTS fastapi uvicorn pydantic
# Run with:    uvicorn tts_server:app --host 0.0.0.0 --port 8000
#
# Place a 6-second clean WAV clip of your voice at: my_voice_sample.wav
# (same directory as this file)

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from TTS.api import TTS
import io
import torch
import os

app = FastAPI()

# ── Load XTTS-v2 model once at startup ────────────────────────────────────────
# Uses GPU if available, otherwise CPU (slower but works)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[TTS] Loading XTTS-v2 on {DEVICE}...")

tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)

# Path to your voice sample WAV (6+ seconds, clean, no background noise)
VOICE_SAMPLE = os.path.join(os.path.dirname(__file__), "my_voice_sample.wav")

if not os.path.exists(VOICE_SAMPLE):
    print(f"[TTS] WARNING: Voice sample not found at {VOICE_SAMPLE}")
    print("[TTS] Place a 6-second WAV clip of your voice there before making requests.")


# ── Request schema ─────────────────────────────────────────────────────────────
class SynthesizeRequest(BaseModel):
    text: str
    language: str = "en"  # change to "hi" for Hindi, "fr" for French, etc.


# ── Synthesize endpoint ────────────────────────────────────────────────────────
@app.post("/synthesize")
async def synthesize(body: SynthesizeRequest):
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="text field is required")

    if not os.path.exists(VOICE_SAMPLE):
        raise HTTPException(
            status_code=500,
            detail=f"Voice sample not found at {VOICE_SAMPLE}. Add your WAV file first."
        )

    # Trim to avoid very long generations
    text = body.text.strip()
    if len(text) > 2000:
        text = text[:2000] + "..."

    print(f"[TTS] Synthesizing {len(text)} chars in language='{body.language}'")

    try:
        # Generate audio as a list of float samples
        wav = tts.tts(
            text=text,
            speaker_wav=VOICE_SAMPLE,
            language=body.language,
        )

        # Save to an in-memory buffer as WAV
        buf = io.BytesIO()
        tts.synthesizer.save_wav(wav=wav, path=buf)
        buf.seek(0)

        return StreamingResponse(
            buf,
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"}
        )

    except Exception as e:
        print(f"[TTS] Error: {e}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "xtts_v2",
        "device": DEVICE,
        "voice_sample_found": os.path.exists(VOICE_SAMPLE),
    }