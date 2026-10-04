"""One campaign video, end to end: research -> brief -> voice -> film -> stills check -> render -> thumbnail."""
import json
import re
import shutil
import time
from pathlib import Path
from typing import Callable

import anthropic

from .config import HARNESS, OUTPUT_DIR, limits, opus_key
from .director import critique, write_brief
from .film import film_request, revise_film, write_film
from .models import Brief
from .style import apply_beat_edits, brand_colors
from .render import check_page, frames, mix, stills
from .research import research
from .thumbnail import generate_image, overlay_title
from .timeline import beat_starts, words_from_alignment
from .voice import voiceover

END_HOLD = 1.2  # end card stays up after the last word
PASS_SCORE = 7


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "film"


def ensure_working(page: str, *, check: Callable[[str], list[str]], fix: Callable[[str, list[str]], str],
                   fallback: str | None = None) -> str:
    """Model-written pages can crash: check it, send the errors back for one repair, else use the last good page."""
    errors = check(page)
    if not errors:
        return page
    fixed = fix(page, errors)
    if not check(fixed):
        return fixed
    if fallback is not None:
        return fallback
    raise RuntimeError(f"the film page does not run: {'; '.join(errors)[:300]}")


def opus_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=opus_key(), max_retries=3, timeout=900.0)


def still_times(starts: list[float], duration: float) -> list[float]:
    picks = [starts[0] + 0.7, starts[1] + 0.9, starts[len(starts) // 2 + 1] + 0.9 if len(starts) > 3 else duration / 2,
             duration - 0.4]
    return [round(min(duration - 0.05, t), 3) for t in picks]


def _cached(path: Path, make: Callable[[], dict | list]):
    """Steps already paid for (research, brief, voice) are reused when a video is resumed."""
    if path.exists():
        return json.loads(path.read_text())
    value = make()
    path.write_text(json.dumps(value, indent=1))
    return value


def make_video(company: str, news: str, goal: str = "", audience: str = "", *, video_id: str | None = None,
               on_stage: Callable[[str, float], None] = lambda stage, progress: print(f"[{stage}] {progress:.0%}"),
               palette: list[str] | None = None, edit: dict | None = None, context: dict | None = None,
               direction: dict | None = None) -> dict:
    """palette: the brand kit's colours (forced onto film + thumbnail). edit: {parent_id, instruction, beats}
    makes a new version of an existing video, reusing its research, brief and (unless the lines changed) voice."""
    video_id = video_id or f"{_slug(company)}-{int(time.time())}"
    folder = OUTPUT_DIR / video_id
    folder.mkdir(parents=True, exist_ok=True)
    client = opus_client()
    meta: dict = {"video_id": video_id, "company": company, "news": news, "goal": goal, "audience": audience}

    on_stage("research", 0.0)
    context = context or {}
    news_sources = [{"title": n["title"], "url": n["url"], "published": n["date"], "text": n["summary"]} for n in context.get("news", [])]
    best = [{"title": f"@{company} post ({p['likes']} likes)", "url": "", "published": p.get("date", ""), "text": p["text"]}
            for p in context.get("best_posts", [])]
    sources = _cached(folder / "sources.json", lambda: news_sources + best + research(company, news))
    meta["sources"] = [{k: s[k] for k in ("title", "url", "published")} for s in sources]

    on_stage("brief", 0.1)
    parent = OUTPUT_DIR / edit["parent_id"] if edit else None
    if parent:  # an edit starts from the parent's paid-for research + brief
        for name in ("sources.json", "brief.json"):
            if (parent / name).exists() and not (folder / name).exists():
                shutil.copy(parent / name, folder / name)
    brief = Brief.model_validate(_cached(folder / "brief.json", lambda: write_brief(
        client, company, news, goal, audience, sources, direction=direction).model_dump()))
    voice_changed = True
    if edit:
        brief, voice_changed = apply_beat_edits(brief, edit.get("beats") or [])
        (folder / "brief.json").write_text(json.dumps(brief.model_dump(), indent=1))
        meta["edit"] = edit
    colors = brand_colors(palette or [])
    if colors:
        brief = brief.model_copy(update={"accent_hex": colors[0], "background_hex": colors[1]})
    meta["brief"] = brief.model_dump()

    on_stage("voice", 0.2)
    lines = [b.voiceover.strip() for b in brief.beats]
    if parent and not voice_changed and (parent / "alignment.json").exists() and not (folder / "alignment.json").exists():
        shutil.copy(parent / "voice.mp3", folder / "voice.mp3")
        shutil.copy(parent / "alignment.json", folder / "alignment.json")
    alignment = _cached(folder / "alignment.json", lambda: voiceover(" ".join(lines), folder / "voice.mp3", voice_id=limits().voice_id))
    words = words_from_alignment(alignment)
    starts = beat_starts(lines, words)
    duration = round(min(limits().max_seconds, words[-1].end + END_HOLD), 3)
    meta.update(duration=duration, beat_starts=starts)

    on_stage("film", 0.3)
    shutil.copy(HARNESS, folder / "core.js")
    assets = []
    for i, shot in enumerate(context.get("screenshots", [])[:2]):  # the real product, never invented UI
        if Path(shot).exists():
            shutil.copy(shot, folder / f"shot-{i + 1}.png")
            assets.append(f"shot-{i + 1}.png")
    if parent and (parent / "film.html").exists():
        notes = (f"User's request: {edit.get('instruction') or 'apply the script changes'}\n"
                 f"Updated film spec (beat times, text, colours) to follow exactly:\n{film_request(brief, starts, words, duration)}")
        page = revise_film(client, (parent / "film.html").read_text(), notes, raw_path=folder / "film")
    else:
        page = write_film(client, brief, starts, words, duration, raw_path=folder / "film", assets=assets)
    def check(candidate: str) -> list[str]:
        (folder / "film.html").write_text(candidate)
        return check_page(folder, duration)

    def repair(candidate: str, errors: list[str]) -> str:
        return revise_film(client, candidate, "The page crashes in the browser. Fix these errors so window.ready is "
                           "set and seek(t) works for every t:\n" + "\n".join(errors[:5]), raw_path=folder / "film.fix")

    page = ensure_working(page, check=check, fix=repair)
    (folder / "film.html").write_text(page)

    on_stage("stills", 0.5)
    sheet, errors = stills(folder, still_times(starts, duration))
    review = critique(client, sheet, [f.model_dump() for f in brief.facts_used])
    meta["review_1"] = review.model_dump() | {"page_errors": errors[:5]}
    if errors or min(review.scores.values(), default=0) < PASS_SCORE:
        on_stage("revise", 0.55)
        notes = "\n".join(review.problems + [f"Page error: {e}" for e in errors[:5]])
        (folder / "film.v1.html").write_text(page)
        good = page
        page = ensure_working(revise_film(client, page, notes, raw_path=folder / "film.v2"), check=check, fix=repair,
                              fallback=good)  # a broken revision never costs the video
        (folder / "film.html").write_text(page)
        meta["revision_kept"] = page != good
        sheet, errors = stills(folder, still_times(starts, duration))
        meta["review_2"] = critique(client, sheet, [f.model_dump() for f in brief.facts_used]).model_dump() | {
            "page_errors": errors[:5]}

    on_stage("render", 0.6)
    silent, errors = frames(folder, duration, lambda p: on_stage("render", 0.6 + 0.3 * p))
    meta["render_errors"] = errors[:5]
    mix(silent, folder / "voice.mp3", starts[1:], duration, folder / "video.mp4")
    silent.unlink(missing_ok=True)

    on_stage("thumbnail", 0.92)
    try:
        raw = folder / "thumbnail.raw.png"
        if parent and (parent / "thumbnail.raw.png").exists():
            shutil.copy(parent / "thumbnail.raw.png", raw)
        else:
            generate_image(f"{brief.thumbnail_prompt}. Minimal and clean, lots of empty space, only these brand colours: "
                           f"{brief.accent_hex} accent on {brief.background_hex}", raw)
        overlay_title(raw, folder / "thumbnail.jpg", brief.title, brief.accent_hex)
        meta["thumbnail"] = f"/generated/videos/{video_id}/thumbnail.jpg"
    except Exception as exc:  # noqa: BLE001 - a missing thumbnail must not lose a rendered film
        meta["thumbnail_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"

    meta["video"] = f"/generated/videos/{video_id}/video.mp4"
    (folder / "meta.json").write_text(json.dumps(meta, indent=1))
    on_stage("done", 1.0)
    return meta
