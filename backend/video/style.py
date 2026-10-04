"""Brand look (the kit's palette, not the model's taste) and user edits to a film's script."""
from .models import Beat, Brief

DEFAULT_BACKGROUND = "#0B0B0C"


def _lum(hex_color: str) -> float:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def brand_colors(palette: list[str]) -> tuple[str, str] | None:
    """(accent, background): the kit's first colour is the accent; the background is its darkest neutral."""
    colors = [c for c in palette if isinstance(c, str) and len(c) == 7 and c.startswith("#")]
    if not colors:
        return None
    accent, rest = colors[0], colors[1:]
    neutrals = [c for c in rest if _lum(c) < 0.15 or _lum(c) > 0.9]
    background = min(neutrals, key=_lum) if neutrals else DEFAULT_BACKGROUND
    return accent, background


def apply_beat_edits(brief: Brief, edits: list[dict]) -> tuple[Brief, bool]:
    """Edits line up with beats by position; missing/empty fields keep the original. Returns (brief, voice_changed)."""
    beats, voice_changed = [], False
    for i, beat in enumerate(brief.beats):
        e = edits[i] if i < len(edits) and isinstance(edits[i], dict) else {}
        on_screen = (e.get("on_screen") or "").strip() or beat.on_screen
        voiceover = (e.get("voiceover") or "").strip() or beat.voiceover
        voice_changed |= voiceover != beat.voiceover
        beats.append(Beat(voiceover=voiceover, on_screen=on_screen, visual=beat.visual))
    return Brief.model_validate({**brief.model_dump(), "beats": [b.model_dump() for b in beats]}), voice_changed
