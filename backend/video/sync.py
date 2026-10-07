"""campaign_video rows in SpacetimeDB: live stage/progress while a video is made, URLs + script when done."""
import json
import logging
import time

from twins.config import WORKER_VERSION
from twins.stdb import StdbError, sql_str

log = logging.getLogger(__name__)
STAGES = {"research", "brief", "voice", "film", "stills", "revise", "render", "thumbnail"}
MIN_INTERVAL = 1.0  # render reports often; keep reducer calls to about one a second
WORKER_VERSION = 2


class VideoReporter:
    def __init__(self, stdb, video_id: str):
        self.stdb, self.video_id, self._last, self._stage = stdb, video_id, 0.0, ""

    def stage(self, status: str, progress: float) -> None:
        print(f"[{status}] {progress:.0%}", flush=True)
        if status not in STAGES:
            return
        now = time.monotonic()
        if status == self._stage == "render" and now - self._last < MIN_INTERVAL:
            return
        self._last, self._stage = now, status
        try:
            self.stdb.call("set_campaign_video_progress", self.video_id, status, round(progress, 3))
        except StdbError as exc:  # progress is cosmetic; never stop a render for it
            log.warning("progress update failed: %s", exc)

    def finish(self, meta: dict) -> None:
        brief = meta.get("brief") or {}
        review = meta.get("review_2") or meta.get("review_1") or {}
        self.stdb.call("finish_campaign_video", self.video_id, brief.get("title", ""), meta.get("video", ""),
                       meta.get("thumbnail", ""), float(meta.get("duration") or 0), json.dumps(brief), json.dumps(review))

    def fail(self, error: str) -> None:
        try:
            self.stdb.call("fail_campaign_video", self.video_id, error[:300])
        except StdbError as exc:
            log.error("video %s stuck: %s", self.video_id, exc)


def _palette(stdb, brand: str) -> list[str] | None:
    try:
        users = stdb.sql(f"SELECT user_id FROM x_user WHERE username = {sql_str(brand)}")
        kits = stdb.sql(f"SELECT * FROM brand_kit WHERE brand_user_id = {sql_str(users[0]['user_id'])}") if users else []
        return list(kits[0]["palette"]) if kits else None
    except StdbError:
        return None


def _edit(stdb, video_id: str) -> dict | None:
    rows = stdb.sql(f"SELECT * FROM video_edit WHERE video_id = {sql_str(video_id)}")
    if not rows:
        return None
    try:
        beats = json.loads(rows[0]["beats_json"]) if rows[0]["beats_json"] else []
    except ValueError:
        beats = []
    return {"parent_id": rows[0]["parent_id"], "instruction": rows[0]["instruction"], "beats": beats}


def _company(stdb, brand: str) -> dict | None:
    from creative.company import company_context
    users = stdb.sql(f"SELECT user_id FROM x_user WHERE username = {sql_str(brand)}")
    if not users:  # only brands Ripple knows get researched
        return None
    kits = stdb.sql(f"SELECT display_name FROM brand_kit WHERE brand_user_id = {sql_str(users[0]['user_id'])}")
    return company_context(stdb, brand, kits[0]["display_name"] if kits else brand)


# Draft A and draft B of a campaign get different films, so the Lab compares two real alternatives.
FILM_DIRECTIONS = {
    "A": "Product-led launch film: open on the concrete feature or number, fast kinetic type, the brand's real product "
         "screenshots as the hero, dark background, crisp cuts, confident and declarative voiceover.",
    "B": "Story-led film: open on the viewer's problem or a question, a single visual metaphor that transforms into the "
         "payoff, light or tinted background, slower glides, warmer conversational voiceover; product shown last.",
}


def _direction(stdb, video_id: str, campaign_id: str) -> dict | None:
    if not campaign_id:
        return None
    links = stdb.sql(f"SELECT * FROM campaign_draft_video WHERE campaign_id = {sql_str(campaign_id)}")
    mine = next((l for l in links if l["video_id"] == video_id), None)
    if not mine:
        return None
    direction = {"draft": mine["draft"], "style": FILM_DIRECTIONS.get(mine["draft"], FILM_DIRECTIONS["A"])}
    for link in links:
        if link["draft"] == mine["draft"]:
            continue
        rows = stdb.sql(f"SELECT * FROM campaign_video WHERE video_id = {sql_str(link['video_id'])}")
        if rows and rows[0].get("status") == "done" and rows[0].get("script_json"):
            direction["differ_from"] = rows[0]["script_json"][:3000]
    return direction


def make_tracked(stdb, maker, company: str, news: str, goal: str, audience: str, *, video_id: str,
                 campaign_id: str = "") -> dict:
    stdb.call("start_campaign_video", video_id, company, news, goal, campaign_id, WORKER_VERSION)
    rep = VideoReporter(stdb, video_id)
    try:  # recent news, the brand's best posts and real screenshots; optional
        context = _company(stdb, company)
    except Exception as exc:  # noqa: BLE001
        log.warning("company context skipped for %s: %s", company, exc)
        context = None
    try:
        direction = _direction(stdb, video_id, campaign_id)
    except Exception as exc:  # noqa: BLE001 - a film without a draft direction is still a film
        log.warning("draft direction skipped for %s: %s", video_id, exc)
        direction = None
    extra = {k: v for k, v in (("palette", _palette(stdb, company)), ("edit", _edit(stdb, video_id)),
                               ("context", context), ("direction", direction)) if v}
    from .config import VideoLimits, load_video_limits, use_limits
    try:  # /ops video settings (max length, voice) for this job
        video_limits = load_video_limits(stdb)
    except Exception as exc:  # noqa: BLE001 - the defaults are always valid
        log.warning("video settings unavailable, using defaults: %s", exc)
        video_limits = VideoLimits()
    log.info("video %s: up to %ss, voice %s", video_id, video_limits.max_seconds, video_limits.voice_id)
    try:
        with use_limits(video_limits):
            meta = maker(company, news, goal, audience, video_id=video_id, on_stage=rep.stage, **extra)
    except Exception as exc:
        rep.fail(f"{type(exc).__name__}: {exc}")
        raise
    rep.finish(meta)
    _attach_to_lab(stdb, video_id, campaign_id)
    return meta


def _attach_to_lab(stdb, video_id: str, campaign_id: str) -> None:
    """The video (~5 min) usually lands after the campaign's Lab test (~1 min): put it on both drafts now."""
    if not campaign_id:
        return
    try:
        rows = stdb.sql(f"SELECT * FROM campaign_flow WHERE campaign_id = {sql_str(campaign_id)}")
        exp = int(rows[0]["experiment_id"]) if rows else 0
        links = stdb.sql(f"SELECT * FROM campaign_draft_video WHERE campaign_id = {sql_str(campaign_id)}")
        mine = [r["draft"] for r in links if r["video_id"] == video_id]
        drafts = mine if links else ["A", "B"]  # per-draft videos go to their own tweet; a shared one to both
        for draft in drafts if exp else ():
            stdb.call("attach_lab_draft_media", exp, draft, video_id)
        # Approval may happen before rendering; keep the launch preview on the approved draft's latest film.
        if rows and rows[0].get("stage") == "approved" and mine and exp:
            experiments = stdb.sql("SELECT * FROM lab_experiment")
            tested = next((r for r in experiments if int(r["experiment_id"]) == exp), None)
            if tested and any(tested.get(f"draft_{d.lower()}") == rows[0].get("winner_text") for d in mine):
                stdb.call("update_campaign_flow", campaign_id, "approved", 0, video_id, "")
    except StdbError as exc:  # media is a bonus; the video itself is done
        log.warning("could not attach video %s to the Lab: %s", video_id, exc)


def run_pending_videos(stdb, *, maker, campaign_id=None) -> int:
    handled = 0
    for row in stdb.sql("SELECT * FROM campaign_video WHERE status = 'queued'"):
        if campaign_id and row["campaign_id"] != campaign_id:
            continue
        try:
            log.info("video %s (@%s): started", row["video_id"], row["brand"])
            make_tracked(stdb, maker, row["brand"], row["news"], row["goal"], "", video_id=row["video_id"],
                         campaign_id=row["campaign_id"])
            log.info("video %s: done", row["video_id"])
        except StdbError as exc:
            if "already claimed" in str(exc):
                continue  # another worker took it
            log.error("video %s: %s", row["video_id"], exc)
        except Exception:  # noqa: BLE001 - recorded on the row by make_tracked
            log.exception("video %s failed", row["video_id"])
        handled += 1
    return handled


def run_video_worker(stdb, *, maker, poll_seconds: float = 3.0, sleep=time.sleep, writer=None) -> None:
    import threading
    from twins.ops_pause import PauseWatch, guarded, nap
    from .copywriter import run_pending_copy
    watch = PauseWatch(stdb).start()

    def copy_loop():  # tweets take seconds; never let them wait behind a 5-minute render
        while writer:
            try:
                if not watch.paused:
                    run_pending_copy(stdb, write=writer)
            except StdbError as exc:
                log.warning("copy poll failed: %s", exc)
            sleep(2.0)
    if writer:
        threading.Thread(target=copy_loop, name="draft-copy", daemon=True).start()

    def step() -> None:
        try:
            run_pending_videos(stdb, maker=maker)
        except StdbError as exc:
            log.warning("video poll failed: %s", exc)
    while True:
        guarded(watch, step)
        nap(watch, sleep, poll_seconds)


def run_copy_worker(stdb, *, writer, poll_seconds: float = 2.0, sleep=time.sleep, max_loops: int | None = None) -> None:
    """Draft tweets only: lets campaigns get their copy while video generation is off or the video workers are down."""
    from twins.ops_pause import PauseWatch, guarded, nap
    from .copywriter import run_pending_copy
    watch = PauseWatch(stdb) if max_loops is not None else PauseWatch(stdb).start()

    def step() -> None:
        try:
            run_pending_copy(stdb, write=writer)
        except StdbError as exc:
            log.warning("copy poll failed: %s", exc)
    loops = 0
    while max_loops is None or loops < max_loops:
        guarded(watch, step)
        loops += 1
        nap(watch, sleep, poll_seconds)
