"""The voice is the timeline: ElevenLabs character timings -> words -> when each beat starts."""
from .models import Word


def words_from_alignment(alignment: dict) -> list[Word]:
    chars = alignment["characters"]
    starts, ends = alignment["character_start_times_seconds"], alignment["character_end_times_seconds"]
    words, buf, w_start, w_end = [], "", 0.0, 0.0
    for ch, s, e in zip(chars, starts, ends):
        if ch.isspace():
            if buf:
                words.append(Word(text=buf, start=w_start, end=w_end))
            buf = ""
            continue
        if not buf:
            w_start = s
        buf, w_end = buf + ch, e
    if buf:
        words.append(Word(text=buf, start=w_start, end=w_end))
    return words


def beat_starts(lines: list[str], words: list[Word]) -> list[float]:
    """Each beat starts on the first spoken word of its line (lines were joined with single spaces)."""
    starts, i = [], 0
    for line in lines:
        starts.append(words[i].start if i < len(words) else (words[-1].end if words else 0.0))
        i += len(line.split())
    return starts
