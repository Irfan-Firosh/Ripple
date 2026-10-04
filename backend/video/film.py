"""Opus 5.5 writes the film: one self-contained HTML page whose window.seek(t) paints the frame at time t."""
import json
import re

from .config import HARNESS, HEIGHT, OPUS_MODEL, WIDTH
from .models import Brief, Word

FILM_RULES = f"""You are a senior motion designer who works only in code. Write ONE self-contained HTML file for a
{WIDTH}x{HEIGHT} marketing film. Hard requirements:
- <div id="stage"> is exactly {WIDTH}x{HEIGHT}px, overflow hidden, positioned at 0,0; the body has margin 0.
- Load the harness with <script src="core.js"></script> (it defines H: H.P, H.step, H.S, H.lerp, H.ease, H.rise,
  H.hide, H.rng, H.set). No other external URLs, no CDN, no web fonts: use system fonts ("Inter", "SF Pro Display",
  "Helvetica Neue", Arial, sans-serif) and big type.
- Define window.seek = async (t) => {{ ...; return true; }}. EVERY visual property is computed from t only: no CSS
  transitions or animations, no timers, no requestAnimationFrame, no state carried between calls, no Math.random
  (use H.rng(seed)). seek(t) must work for any t in any order.
- Set window.ready = true at the end of the script.
- Scenes follow the given beat start times exactly; the on-screen text of each beat appears with H.rise on its start.
Minimal and clean (the brand look):
- Use ONLY the given accent and background colours plus white/near-black for text; nothing else, no tints of other hues.
- At most two elements on screen at once (one headline + one supporting shape or UI). Generous empty space.
- One typeface, two weights at most. Flat shapes, hairline (1px) rules, no shadows, no glows, no textures, no gradients.
Taste (anti "AI motion"):
- ONE accent colour (given) on the given background; no gradients as backgrounds, no particles, no emoji, no glow.
- One thing moves at a time; springs (H.step / H.S with damping >= 0.72), never linear moves.
- Never open on a centred title fading in over a gradient. Open with a hook that is already moving at t=0.
- One shape or visual system carried through the whole film; transform it between beats instead of hard cuts.
- Something new every 2-3 seconds; nothing frozen except the final 0.8 s hold on the end card.
- Type must be readable on a phone: headlines >= 96px, nothing under 40px.
- Show only the facts provided; any number or claim not in the facts must be labelled "Example".
- If assets (real screenshots, 1440x900 PNG files beside the page) are listed, show the real product with them
  (<img src="shot-1.png">, scaled inside a clean rounded frame, with a slow camera move); never redraw the product UI
  from imagination when a screenshot exists.
- End card: brand name + promise, fully revealed and held still for the last 0.8 s.
- Never draw or invent a logo or app icon: write the brand name as a typographic wordmark instead.
- Every text block must fit inside its container with padding at every t (no overflow, no clipping):
  size pills/buttons to their text, never let a line wrap outside its box, and keep line-height >= 1.1.
- All text must be fully revealed by 0.8 s after its beat starts and stay readable until its exit.
Reply with only the HTML in one ```html code block."""


def extract_html(reply: str) -> str:
    m = re.search(r"```html\s*(.*?)```", reply, re.S)
    page = (m.group(1) if m else reply).strip()
    if "window.seek" not in page:
        raise ValueError("film page does not define window.seek")
    if "window.ready" not in page:
        raise ValueError("film page never sets window.ready")
    return page


def film_request(brief: Brief, starts: list[float], words: list[Word], duration: float, assets: list[str] | None = None) -> str:
    beats = [{"start": round(s, 3), "on_screen": b.on_screen, "voiceover": b.voiceover, "visual": b.visual}
             for s, b in zip(starts, brief.beats)]
    return json.dumps({
        "title": brief.title, "promise": brief.promise, "reference_style": brief.reference_style,
        "accent": brief.accent_hex, "background": brief.background_hex, "duration_seconds": round(duration, 3),
        "beats": beats, "facts": [f.model_dump() for f in brief.facts_used],
        "spoken_words": [{"w": w.text, "t": round(w.start, 2)} for w in words],
        **({"assets": [{"file": a, "what": "screenshot of the brand's real website"} for a in assets]} if assets else {}),
    }, indent=1)


MAX_TOKENS = 48000


def _ask(client, content: str, raw_path=None) -> str:
    """Stream (long pages), keep the raw reply for diagnosis, and send a broken page back once with its error."""
    messages = [{"role": "user", "content": content}]
    for attempt in range(2):
        with client.messages.stream(model=OPUS_MODEL, max_tokens=MAX_TOKENS, system=FILM_RULES,
                                    messages=messages) as stream:
            msg = stream.get_final_message()
        reply = "".join(b.text for b in msg.content if b.type == "text")
        if raw_path:
            raw_path.with_suffix(f".raw{attempt}.txt").write_text(reply)
        try:
            return extract_html(reply)
        except ValueError as exc:
            if attempt:
                raise ValueError(f"{exc} (stop_reason={msg.stop_reason})") from exc
            messages += [{"role": "assistant", "content": reply},
                         {"role": "user", "content": f"That page is invalid: {exc}. Return the complete, fixed HTML."}]
    raise AssertionError("unreachable")


def write_film(client, brief: Brief, starts: list[float], words: list[Word], duration: float, raw_path=None,
               assets: list[str] | None = None) -> str:
    harness = HARNESS.read_text()
    return _ask(client, f"Harness core.js (already loaded):\n```js\n{harness}\n```\n\n"
                        f"Film spec:\n```json\n{film_request(brief, starts, words, duration, assets)}\n```", raw_path)


def revise_film(client, page: str, critique: str, raw_path=None) -> str:
    return _ask(client, f"Current film:\n```html\n{page}\n```\n\nA harsh motion director reviewed 4 stills:\n"
                        f"{critique}\n\nFix every listed problem without breaking the rest. Return the full corrected HTML.",
                raw_path)
