"""Onboarding worker: a browser calls request_onboarding(handle); this scrapes the brand's X followers (Scweet),
builds twins and the audience graph, and advances onboarding.status so the form shows live progress.

Hybrid: the live phase stores every follower profile, then pulls timelines and builds twins up to the /ops
twins-per-brand setting (default LIVE_TWINS),
so the brand is usable in about a minute; `after_ready` backfills the rest (X rate-limits timelines).
"""
import logging
import time
from typing import Callable

from .config import WORKER_VERSION
from .settings import load_settings
from .stdb import StdbError, sql_str

log = logging.getLogger(__name__)
LIVE_FOLLOWERS = 300
LIVE_POSTS = 20
LIVE_TIMELINES = 40
LIVE_TWINS = 60
LIVE_WORKERS = 8
MAX_ERROR = 300
REPLAY_STEP_SECONDS = 4.0  # re-onboarding a ready brand: each stage lands this long after the last


def run_id_for(row: dict) -> str:
    return f"onboard-{row['onboarding_id']}-{row['handle']}"


def _ensure_brand_kit(stdb, brand_user_id: str) -> None:
    """Every onboarded brand gets a brand kit now (derived from its X profile), so any creative worker, even one on
    older code that cannot derive one itself, can generate a campaign for it."""
    try:
        from creative.brand_kits import load_brand_kit  # noqa: PLC0415 - creative is optional for the twins worker
        load_brand_kit(stdb, brand_user_id)
    except Exception as exc:  # noqa: BLE001 - a missing kit is recoverable later; never fail the onboarding for it
        log.warning("brand kit for %s not created: %s", brand_user_id, exc)


def _onboard(stdb, client, row: dict, ingest: Callable, build: Callable, edges: Callable, archive: Callable | None = None) -> dict:
    oid, handle, run_id = row["onboarding_id"], row["handle"], run_id_for(row)
    twin_run = f"twins-{run_id}"
    if archive:
        archive(stdb, handle, run_id, 'before')
    log.info("onboarding %s (@%s): scraping followers", oid, handle)
    stdb.call("set_onboarding_progress", oid, "scraping", "", run_id, "")
    settings = load_settings(stdb)
    summary = ingest(handle, followers=settings.followers_scraped, posts=LIVE_POSTS, run_id=run_id,
                     max_new_timelines=max(LIVE_TIMELINES, settings.twins_per_brand))  # one timeline per twin
    brand_id = summary["brand_user_id"]
    log.info("onboarding %s: %s followers scraped, building twins", oid, summary.get("followers", "?"))
    stdb.call("set_onboarding_progress", oid, "twins", brand_id, run_id, twin_run)
    previous = stdb.sql("SELECT * FROM onboarding WHERE handle = '" + handle.replace("'", "''") + "'")
    refresh = any(r["status"] == "ready" and r["onboarding_id"] != oid for r in previous)
    build(stdb, client, handle, limit=settings.twins_per_brand, workers=LIVE_WORKERS, run_id=twin_run,
          richest_first=True, skip_existing=not refresh)
    stdb.call("set_onboarding_progress", oid, "graph", brand_id, run_id, twin_run)
    edges(stdb, handle)
    _ensure_brand_kit(stdb, brand_id)
    stdb.call("set_onboarding_progress", oid, "ready", brand_id, run_id, twin_run)
    log.info("onboarding %s (@%s): ready", oid, handle)
    if archive:
        archive(stdb, handle, run_id, 'ready')
    return summary


def _demo_on(stdb) -> bool:
    """The /ops demo switch (campaign replay): only then does onboarding reuse a finished build."""
    rows = stdb.sql("SELECT * FROM demo_settings WHERE key = 'global'")
    return bool(rows and rows[0].get("campaign_replay"))


def _ready_build(stdb, handle: str) -> dict | None:
    """With the demo switch on, the newest finished build of this handle whose brand still has twins, or None."""
    if not _demo_on(stdb):
        return None
    done = [r for r in stdb.sql(f"SELECT * FROM onboarding WHERE handle = {sql_str(handle)}")
            if r.get("status") == "ready" and r.get("brand_user_id") and r.get("ingestion_run_id") and r.get("twin_run_id")]
    for prior in sorted(done, key=lambda r: int(r["onboarding_id"]), reverse=True):
        if stdb.sql(f"SELECT user_id FROM twin_audience WHERE brand_user_id = {sql_str(prior['brand_user_id'])}"):
            return prior
    return None


def _replay(stdb, row: dict, prior: dict, sleep: Callable[[float], None]) -> None:
    """A brand that is already built reuses its audience: the form steps through every stage in seconds,
    pointing at the finished scrape and twin runs, instead of reading X again."""
    oid, ids = row["onboarding_id"], (prior["brand_user_id"], prior["ingestion_run_id"], prior["twin_run_id"])
    log.info("onboarding %s (@%s): reusing build %s", oid, row["handle"], prior["onboarding_id"])
    for stage in ("scraping", "twins", "graph"):
        stdb.call("set_onboarding_progress", oid, stage, *ids)
        sleep(REPLAY_STEP_SECONDS)
    stdb.call("set_onboarding_progress", oid, "ready", *ids)


def run_pending_onboardings(stdb, client, *, ingest: Callable, build: Callable, edges: Callable,
                            after_ready: Callable[[dict, dict], None] | None = None, archive: Callable | None = None,
                            sleep: Callable[[float], None] = time.sleep) -> int:
    handled = 0
    for row in stdb.sql("SELECT * FROM onboarding WHERE status = 'queued'"):
        oid = row["onboarding_id"]
        try:
            stdb.call("claim_onboarding", oid, WORKER_VERSION)
        except StdbError:
            continue  # another worker took it
        try:
            prior = _ready_build(stdb, row["handle"])
            if prior:
                _replay(stdb, row, prior, sleep)
                handled += 1
                continue
            summary = _onboard(stdb, client, row, ingest, build, edges, archive)
        except Exception as exc:  # noqa: BLE001 - every failure is shown to the user on the form
            log.exception("onboarding %s failed", oid)
            try:
                stdb.call("fail_onboarding", oid, f"{type(exc).__name__}: {exc}"[:MAX_ERROR])
            except StdbError as fail_exc:
                log.error("onboarding %s stuck: %s", oid, fail_exc)
            handled += 1
            continue
        handled += 1
        if after_ready:
            after_ready(row, summary)
    return handled


def run_onboarding_worker(stdb, client, *, poll_seconds: float = 2.0, sleep=time.sleep, **deps) -> None:
    from .ops_pause import PauseWatch, guarded, nap
    from .topup import run_pending_topups
    watch = PauseWatch(stdb).start()

    def step() -> None:
        try:
            run_pending_onboardings(stdb, client, **deps)
            run_pending_topups(stdb, client, build=deps["build"], edges=deps["edges"])
        except StdbError as exc:
            log.warning("onboarding poll failed: %s", exc)
    while True:
        guarded(watch, step)
        nap(watch, sleep, poll_seconds)
