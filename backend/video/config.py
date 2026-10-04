"""Pinned video settings. Secrets are loaded by name and never printed."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path

from twins.config import load_secret

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "frontend/public/generated/videos"
HARNESS = Path(__file__).with_name("harness") / "core.js"

OPUS_MODEL = "claude-opus-5-5"
WIDTH, HEIGHT, FPS, SUBFRAMES, SHUTTER = 1920, 1080, 30, 2, 0.5
DEFAULT_MAX_SECONDS = 20
DEFAULT_VOICE = "y0s2ExEMuum3muUnA6Zd"  # chosen by the team; /ops can change it
WORDS_PER_SECOND = 2.7
END_ROOM = 2  # seconds left after the voiceover for the closing card
ELEVENLABS_MODEL = "eleven_multilingual_v2"
THUMB_SIZE = (1280, 720)


@dataclass(frozen=True)
class VideoLimits:
    """Max film length and ElevenLabs voice for the video being made (the /ops video_settings row)."""
    max_seconds: int = DEFAULT_MAX_SECONDS
    voice_id: str = DEFAULT_VOICE

    @property
    def max_words(self) -> int:  # 20 s -> 48 words: the voiceover ends about 2 s before the cut
        return int((self.max_seconds - END_ROOM) * WORDS_PER_SECOND)


_LIMITS: ContextVar[VideoLimits] = ContextVar("video_limits", default=VideoLimits())


def limits() -> VideoLimits:
    return _LIMITS.get()


@contextmanager
def use_limits(value: VideoLimits):
    token = _LIMITS.set(value)
    try:
        yield value
    finally:
        _LIMITS.reset(token)


def load_video_limits(stdb) -> VideoLimits:
    rows = stdb.sql("SELECT * FROM video_settings WHERE key = 'global'")
    if not rows:
        return VideoLimits()
    return VideoLimits(max_seconds=int(rows[0]["max_seconds"]), voice_id=rows[0]["voice_id"] or DEFAULT_VOICE)


def opus_key() -> str:
    return load_secret("CLAUDE_API_KEY_2")  # this pipeline uses the Opus key only


def xai_key() -> str:
    return load_secret("XAI_API_KEY")


def elevenlabs_key() -> str:
    return load_secret("ELEVENLABS_API_KEY")


def exa_key() -> str:
    return load_secret("EXA_API_KEY")
