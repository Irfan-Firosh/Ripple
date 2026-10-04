"""ElevenLabs voiceover with character timestamps: the voice sets the film's timeline."""
import base64
from pathlib import Path

import requests

from .config import DEFAULT_VOICE, ELEVENLABS_MODEL, elevenlabs_key


def voiceover(text: str, out: Path, *, voice_id: str = DEFAULT_VOICE, session=requests) -> dict:
    r = session.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps", timeout=120,
                     headers={"xi-api-key": elevenlabs_key()},
                     json={"text": text, "model_id": ELEVENLABS_MODEL,
                           "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.2}})
    r.raise_for_status()
    data = r.json()
    out.write_bytes(base64.b64decode(data["audio_base64"]))
    return data["alignment"]
