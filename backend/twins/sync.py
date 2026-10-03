"""SpacetimeDB is the shared state: build progress, twins, and the Ask-the-twin queue."""
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone

import anthropic

from .ask import ask_twin
from .builder import NotEnoughPosts, build_twin
from .llm import TwinLLMError
from .models import Account, AccountStats, Twin, TwinPersona, XPost
from .source import load_audience
from .stdb import StdbError, opt, sql_str

MAX_ERROR = 300


@dataclass(frozen=True)
class BuildSummary:
    run_id: str
    ready: int
    failed: int
    skipped: int
    status: str


def _twin_args(run_id: str, twin: Twin) -> list:
    s, p = twin.stats, twin.persona
    return [run_id, twin.user_id, twin.username, twin.brand_user_id, s.post_count, s.reply_share, s.quote_share,
            s.mention_rate, s.avg_likes, s.avg_impressions, s.engagement_rate, s.active_hours_utc,
            [t.model_dump() for t in p.topics], p.tone, p.persona_summary, p.hot_buttons, p.ignores,
            p.format_prefs, p.evidence_post_ids, twin.model]


def _build_one(stdb, client, run_id: str, brand_user_id: str, account: Account, min_posts: int) -> str:
    uid, name = account.user.user_id, account.user.username

    def status(value: str, error: str | None = None) -> None:
        stdb.call("set_twin_job_status", run_id, uid, name, value, opt(error[:MAX_ERROR] if error else None))

    try:
        status("building")
        twin = build_twin(client, account, brand_user_id, min_posts=min_posts)
        stdb.call("publish_twin", *_twin_args(run_id, twin))
        return "ready"
    except NotEnoughPosts as exc:
        outcome, error = "skipped", str(exc)
    except Exception as exc:  # one account must never abort the whole run
        outcome, error = "failed", f"{type(exc).__name__}: {exc}"
    try:
        status(outcome, error)
    except StdbError as exc:
        _log(f"@{name}: could not record {outcome} status: {exc}")
    return outcome


def run_build(stdb, client, brand_username: str, *, min_posts: int = 3, workers: int = 4,
              limit: int | None = None, run_id: str | None = None) -> BuildSummary:
    brand, accounts = load_audience(stdb, brand_username)
    accounts = accounts[:limit] if limit else accounts
    run_id = run_id or f"twins-{brand.username.lower()}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}"
    stdb.call("start_twin_build_run", run_id, brand.user_id, len(accounts))
    for a in accounts:
        stdb.call("set_twin_job_status", run_id, a.user.user_id, a.user.username, "queued", opt(None))
    results: Counter = Counter()
    try:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            results.update(pool.map(lambda a: _build_one(stdb, client, run_id, brand.user_id, a, min_posts), accounts))
    finally:  # never leave the run stuck at "running"
        status = "completed" if not results["failed"] else ("partial" if results["ready"] else "failed")
        if sum(results.values()) < len(accounts):
            status = "partial" if results["ready"] else "failed"
        stdb.call("complete_twin_build_run", run_id, status)
    return BuildSummary(run_id, results["ready"], results["failed"], results["skipped"], status)


def load_twin(stdb, user_id: str) -> Twin:
    rows = stdb.sql(f"SELECT * FROM twin WHERE user_id = {sql_str(user_id)}")
    if not rows:
        raise LookupError(f"no twin for user {user_id}")
    r = rows[0]
    evidence = []
    for pid in r["evidence_post_ids"]:
        evidence += [XPost.model_validate(p) for p in stdb.sql(f"SELECT * FROM x_post WHERE post_id = {sql_str(pid)}")]
    stats = AccountStats(post_count=r["post_count"], reply_share=r["reply_share"], quote_share=r["quote_share"],
                         mention_rate=r["mention_rate"], avg_likes=r["avg_likes"], avg_impressions=r["avg_impressions"],
                         engagement_rate=r["engagement_rate"], active_hours_utc=r["active_hours_utc"],
                         top_mentions=[], x_topics=[])
    persona = TwinPersona(topics=r["topics"], tone=r["tone"], format_prefs=r["format_prefs"],
                          hot_buttons=r["hot_buttons"], ignores=r["ignores"], persona_summary=r["persona_summary"],
                          evidence_post_ids=r["evidence_post_ids"])
    return Twin(user_id=r["user_id"], username=r["username"], brand_user_id=r["brand_user_id"],
                stats=stats, persona=persona, evidence=evidence, model=r["model"])


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def answer_pending(stdb, client) -> int:
    handled = 0
    for q in stdb.sql("SELECT * FROM twin_question WHERE status = 'pending'"):
        qid = q["question_id"]
        try:
            stdb.call("claim_twin_question", qid)
        except StdbError as exc:
            if "already claimed" not in str(exc):  # a lost race is normal; anything else is not
                _log(f"question {qid}: {exc}")
            continue
        try:
            answer = ask_twin(client, load_twin(stdb, q["user_id"]), q["draft"], q["question"])
            stdb.call("answer_twin_question", qid, answer.action, answer.confidence,
                      answer.answer, answer.cited_post_ids)
        except (TwinLLMError, anthropic.APIError, LookupError, ValueError, StdbError) as exc:
            try:
                stdb.call("fail_twin_question", qid, str(exc)[:MAX_ERROR])
            except StdbError as fail_exc:
                _log(f"question {qid}: left in 'answering'; could not mark failed: {fail_exc}")
        handled += 1
    return handled


def run_worker(stdb, client, *, poll_seconds: float = 2.0, max_loops: int | None = None, sleep=time.sleep) -> None:
    loops = 0
    while max_loops is None or loops < max_loops:
        try:
            if answer_pending(stdb, client):
                print(f"answered pending twin questions at {datetime.now(timezone.utc):%H:%M:%S}", flush=True)
        except Exception as exc:  # keep polling through transient SpacetimeDB/Claude errors
            _log(f"worker poll failed: {type(exc).__name__}: {exc}")
        loops += 1
        sleep(poll_seconds)
