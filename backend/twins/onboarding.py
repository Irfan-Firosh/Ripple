"""Onboarding worker: a browser calls request_onboarding(handle); this scrapes the brand's X followers (Scweet),
builds twins and the audience graph, and advances onboarding.status so the form shows live progress.

Hybrid: the live phase stores every follower profile but only LIVE_TIMELINES new timelines and LIVE_TWINS twins,
so the brand is usable in about a minute; `after_ready` backfills the rest (X rate-limits timelines).
"""
import logging
import time
from typing import Callable

from .stdb import StdbError

log = logging.getLogger(__name__)
LIVE_FOLLOWERS = 300
LIVE_POSTS = 20
LIVE_TIMELINES = 40
LIVE_TWINS = 60
LIVE_WORKERS = 8
MAX_ERROR = 300


def run_id_for(row: dict) -> str:
    return f"onboard-{row['onboarding_id']}-{row['handle']}"


def _onboard(stdb, client, row: dict, ingest: Callable, build: Callable, edges: Callable) -> dict:
    oid, handle, run_id = row["onboarding_id"], row["handle"], run_id_for(row)
    twin_run = f"twins-{run_id}"
    stdb.call("set_onboarding_progress", oid, "scraping", "", run_id, "")
    summary = ingest(handle, followers=LIVE_FOLLOWERS, posts=LIVE_POSTS, run_id=run_id,
                     max_new_timelines=LIVE_TIMELINES)
    brand_id = summary["brand_user_id"]
    stdb.call("set_onboarding_progress", oid, "twins", brand_id, run_id, twin_run)
    build(stdb, client, handle, limit=LIVE_TWINS, workers=LIVE_WORKERS, run_id=twin_run,
          richest_first=True, skip_existing=True)
    stdb.call("set_onboarding_progress", oid, "graph", brand_id, run_id, twin_run)
    edges(stdb, handle)
    stdb.call("set_onboarding_progress", oid, "ready", brand_id, run_id, twin_run)
    return summary


def run_pending_onboardings(stdb, client, *, ingest: Callable, build: Callable, edges: Callable,
                            after_ready: Callable[[dict, dict], None] | None = None) -> int:
    handled = 0
    for row in stdb.sql("SELECT * FROM onboarding WHERE status = 'queued'"):
        oid = row["onboarding_id"]
        try:
            stdb.call("claim_onboarding", oid)
        except StdbError:
            continue  # another worker took it
        try:
            summary = _onboard(stdb, client, row, ingest, build, edges)
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
    while True:
        try:
            run_pending_onboardings(stdb, client, **deps)
        except StdbError as exc:
            log.warning("onboarding poll failed: %s", exc)
        sleep(poll_seconds)
