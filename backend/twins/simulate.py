"""Run a draft through the policy (Claude) and the cascade (SpacetimeDB), then summarise it for agents."""
import os
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable

from pydantic import BaseModel

from .brand_twins import load_brand_twins
from .graph import publish_edges
from .comments import write_comments
from .filler import fill_replies
from .settings import cap_twins, load_settings
from .policy import NO_PREDICTION, SignalScore, score_signals
from .stdb import StdbError, sql_str

DASHBOARD_BASE = os.environ.get("RIPPLE_DASHBOARD_URL", "http://localhost:5173/dashboard")
PROB_CHUNK = 200
TOP_RESPONDERS = 5
TOP_NICHES = 4
MAX_UNSCORED = 0.25  # fail rather than report a reach that silently ignores a quarter of the audience


SIGNAL_ORDER = ("like", "repost", "reply", "quote")
TIE_BAND = 0.05
REPOST_VIEW_RATE = 0.1  # mirrors the start_cascade reducer
OUT_OF_NETWORK = 0.5
LAB_TRIALS = 1000  # more trials → steadier ranges on the card (the winner itself is computed exactly)
LAB_DEADLINE = 300  # Lab runs in the background worker; the agent path keeps the 90 s scoring deadline


class SimSignal(BaseModel):
    signal: str
    p10: int
    p50: int
    p90: int
    mean: float


class SimNiche(BaseModel):
    slug: str
    label: str
    engaged_share: float
    people: int


class SimResponder(BaseModel):
    user_id: str
    handle: str
    name: str
    avatar: str
    profile_url: str
    action: str
    p_engage: float
    engaged_share: float
    reason: str


class SimSummary(BaseModel):
    run_id: str
    brand: str
    draft: str
    people: int
    scored: int
    reach_p10: int
    reach_p50: int
    reach_p90: int
    seen_p50: int
    top_niches: list[SimNiche]
    top_responders: list[SimResponder]
    dashboard_url: str
    signals: list[SimSignal] = []
    views: SimSignal | None = None  # everyone who saw it: the audience + people reached through reposts
    outside_share: float = 0.0  # share of expected engagements that came from beyond the brand's followers


def profile_url(user_id: str, handle: str) -> str:
    if user_id.startswith("did:") or "." in handle:
        return f"https://bsky.app/profile/{handle}"
    return f"https://x.com/{handle}"


def _wait_for_cascade(stdb, run_id: str, poll_seconds: float, timeout: float, sleep) -> dict:
    waited = 0.0
    while True:
        rows = stdb.sql(f"SELECT * FROM sim_run WHERE run_id = {sql_str(run_id)}")
        if rows and rows[0]["status"] in ("replaying", "done"):
            return rows[0]
        if rows and rows[0]["status"] == "failed":
            raise RuntimeError(rows[0].get("error") or "simulation failed")
        if waited >= timeout:
            raise TimeoutError(f"cascade for {run_id} did not finish in {timeout}s")
        sleep(poll_seconds)
        waited += poll_seconds


def _create_runs(stdb, brand_user_id: str, drafts: list[str], people: int) -> list[str]:
    run_ids = [f"sim-{uuid.uuid4().hex[:12]}" for _ in drafts]
    for run_id, draft in zip(run_ids, drafts):
        stdb.call("create_sim_run", run_id, brand_user_id, draft, people)
    return run_ids


def _check_scored(scores: list[SignalScore]) -> int:
    scored = sum(s.reason != NO_PREDICTION for s in scores)
    if scored < len(scores) * (1 - MAX_UNSCORED):
        raise RuntimeError(f"Claude scored only {scored} of {len(scores)} twins; try again shortly")
    return scored


def _write_probs_and_start(stdb, run_id: str, scores: list[SignalScore], trials: int) -> None:
    legacy = [{"user_id": s.user_id, "p_engage": round(s.p_any, 6), "action": s.top, "reason": s.reason} for s in scores]
    signal = [{"user_id": s.user_id, "p_like": s.p_like, "p_repost": s.p_repost, "p_reply": s.p_reply,
               "p_quote": s.p_quote} for s in scores]
    for i in range(0, len(scores), PROB_CHUNK):
        stdb.call("set_sim_probs", run_id, legacy[i:i + PROB_CHUNK])
    for i in range(0, len(scores), PROB_CHUNK):
        stdb.call("set_sim_signal_probs", run_id, signal[i:i + PROB_CHUNK])
    stdb.call("start_cascade", run_id, trials)


def _fail(stdb, run_ids: list[str], exc: Exception) -> None:
    for run_id in run_ids:
        try:
            stdb.call("fail_sim_run", run_id, f"{type(exc).__name__}: {exc}"[:300])
        except StdbError:
            pass


def _summarise(stdb, run_id: str, run: dict, brand_user, twins, draft: str, scores: list[SignalScore],
               scored: int, dashboard_base: str) -> SimSummary:
    nodes = {n["user_id"]: n for n in stdb.sql(f"SELECT * FROM sim_node WHERE run_id = {sql_str(run_id)}")}
    labels = {n["slug"]: n["label"] for n in stdb.sql("SELECT * FROM niche")}
    by_signal = {r["signal"]: r for r in stdb.sql(f"SELECT * FROM sim_signal WHERE run_id = {sql_str(run_id)}")}
    score_by = {s.user_id: s for s in scores}
    niche_sum: dict[str, list[float]] = defaultdict(list)
    for t in twins:
        niche_sum[t.niches[0][0] if t.niches else "other"].append(nodes.get(t.user_id, {}).get("engaged_share", 0.0))
    top_niches = sorted(
        (SimNiche(slug=k, label=labels.get(k, k), engaged_share=round(sum(v) / len(v), 3), people=len(v))
         for k, v in niche_sum.items()),
        key=lambda n: (-n.engaged_share * n.people, -n.people))[:TOP_NICHES]
    ranked = sorted(twins, key=lambda t: -nodes.get(t.user_id, {}).get("engaged_share", 0.0))[:TOP_RESPONDERS]
    top_responders = [SimResponder(
        user_id=t.user_id, handle=t.username, name=t.name, avatar=t.avatar, profile_url=profile_url(t.user_id, t.username),
        action=score_by[t.user_id].top, p_engage=round(score_by[t.user_id].p_any, 4),
        engaged_share=round(nodes.get(t.user_id, {}).get("engaged_share", 0.0), 3), reason=score_by[t.user_id].reason)
        for t in ranked]
    def as_signal(name: str) -> SimSignal:
        r = by_signal[name]
        return SimSignal(signal=name, p10=r["p_10"], p50=r["p_50"], p90=r["p_90"], mean=r["mean"])
    signals = [as_signal(s) for s in SIGNAL_ORDER if s in by_signal]
    sources = stdb.sql(f"SELECT * FROM sim_signal_source WHERE run_id = {sql_str(run_id)}")
    engaged = [r for r in sources if r["signal"] in SIGNAL_ORDER]
    total = sum(r["mean"] for r in engaged)
    outside_share = round(sum(r["mean"] for r in engaged if r["source"] == "outside") / total, 4) if total else 0.0
    return SimSummary(run_id=run_id, brand=brand_user.username, draft=draft, people=len(twins), scored=scored,
                      reach_p10=run["reach_p_10"], reach_p50=run["reach_p_50"], reach_p90=run["reach_p_90"],
                      seen_p50=run["seen_p_50"], top_niches=top_niches, top_responders=top_responders,
                      dashboard_url=f"{dashboard_base}?brand={brand_user.username}&run={run_id}", signals=signals,
                      views=as_signal("view") if "view" in by_signal else None, outside_share=outside_share)


def _project_replies(stdb, client, settings, run_id: str, draft: str, twins) -> None:
    """Results projected linearly onto the real audience also get replies from real non-twin followers."""
    if settings.scale_mode == "linear" and settings.fill_replies:
        fill_replies(stdb, client, run_id, draft, twin_ids={t.user_id for t in twins}, limit=settings.fill_replies)


def run_simulation(stdb, client, brand: str, draft: str, *, trials: int = 200, run_id: str | None = None,
                   dashboard_base: str = DASHBOARD_BASE, poll_seconds: float = 0.5, timeout: float = 60,
                   sleep=time.sleep) -> SimSummary:
    publish_edges(stdb, brand)
    settings = load_settings(stdb)
    brand_user, twins = load_brand_twins(stdb, brand)
    twins = cap_twins(twins, settings.sim_twins)
    run_id = run_id or f"sim-{uuid.uuid4().hex[:12]}"
    stdb.call("create_sim_run", run_id, brand_user.user_id, draft, len(twins))
    try:
        scores = score_signals(client, twins, [draft])[0]
        scored = _check_scored(scores)
        _write_probs_and_start(stdb, run_id, scores, trials)
        run = _wait_for_cascade(stdb, run_id, poll_seconds, timeout, sleep)
    except Exception as exc:
        _fail(stdb, [run_id], exc)
        raise
    write_comments(stdb, client, run_id, draft, twins)
    _project_replies(stdb, client, settings, run_id, draft, twins)
    return _summarise(stdb, run_id, run, brand_user, twins, draft, scores, scored, dashboard_base)


def expected_engagements(s: SimSummary) -> float:
    return sum(x.mean for x in s.signals)


def decide(a: SimSummary, b: SimSummary) -> tuple[str, float]:
    ea, eb = expected_engagements(a), expected_engagements(b)
    lift = round((eb - ea) / max(ea, 0.5), 4)
    if abs(lift) < TIE_BAND:
        return "tie", lift
    return ("B" if lift > 0 else "A"), lift


def align_drafts(a: list[SignalScore], b: list[SignalScore]) -> tuple[list[SignalScore], list[SignalScore]]:
    """Compare like with like: a twin missing either draft's prediction is dropped from both."""
    def blank(s: SignalScore) -> SignalScore:
        return SignalScore(user_id=s.user_id, p_like=0, p_repost=0, p_reply=0, p_quote=0, reason=NO_PREDICTION)
    pairs = [(x, y) if NO_PREDICTION not in (x.reason, y.reason) else (blank(x), blank(y)) for x, y in zip(a, b)]
    return [x for x, _ in pairs], [y for _, y in pairs]


def expected_engagements_exact(scores: list[SignalScore], followers: dict[str, int]) -> float:
    """Exact expected engagements under the cascade's model, without Monte Carlo noise: everyone in the audience sees
    the post (sum of all probabilities), plus the first outside wave each repost/quote brings from the reposter's own
    followers (REPOST_VIEW_RATE see it; they act at OUT_OF_NETWORK x the audience's mean rate)."""
    if not scores:
        return 0.0
    inside = sum(getattr(s, f"p_{n}") for s in scores for n in SIGNAL_ORDER)
    mean_rate = inside / len(scores)
    known = sorted(followers.values())
    median = known[len(known) // 2] if known else 0
    spread = sum((s.p_repost + s.p_quote) * followers.get(s.user_id, median) for s in scores)
    return inside + spread * REPOST_VIEW_RATE * OUT_OF_NETWORK * mean_rate


def decide_scores(a: list[SignalScore], b: list[SignalScore], followers: dict[str, int]) -> tuple[str, float]:
    ea, eb = expected_engagements_exact(a, followers), expected_engagements_exact(b, followers)
    lift = round((eb - ea) / max(ea, 0.5), 4)
    if abs(lift) < TIE_BAND:
        return "tie", lift
    return ("B" if lift > 0 else "A"), lift


@dataclass(frozen=True)
class LabOutcome:
    run_a: SimSummary
    run_b: SimSummary
    winner: str
    lift: float


def run_lab(stdb, client, brand: str, draft_a: str, draft_b: str, *, on_runs: Callable[[str, str], None] | None = None,
            trials: int = LAB_TRIALS, timeout: float = 120, dashboard_base: str = DASHBOARD_BASE, poll_seconds: float = 0.5,
            sleep=time.sleep) -> LabOutcome:
    publish_edges(stdb, brand)
    settings = load_settings(stdb)
    brand_user, twins = load_brand_twins(stdb, brand)
    twins = cap_twins(twins, settings.sim_twins)
    run_ids = _create_runs(stdb, brand_user.user_id, [draft_a, draft_b], len(twins))
    try:
        if on_runs:
            on_runs(run_ids[0], run_ids[1])
        per_draft = list(align_drafts(*score_signals(client, twins, [draft_a, draft_b], deadline=LAB_DEADLINE)))
        scored = [_check_scored(s) for s in per_draft]
        for run_id, scores in zip(run_ids, per_draft):
            _write_probs_and_start(stdb, run_id, scores, trials)
        runs = [_wait_for_cascade(stdb, r, poll_seconds, timeout, sleep) for r in run_ids]
    except BaseException as exc:
        _fail(stdb, run_ids, exc)
        raise
    a, b = (_summarise(stdb, r, run, brand_user, twins, d, s, n, dashboard_base)
            for r, run, d, s, n in zip(run_ids, runs, [draft_a, draft_b], per_draft, scored))
    for run_id, draft in zip(run_ids, [draft_a, draft_b]):
        write_comments(stdb, client, run_id, draft, twins)
        _project_replies(stdb, client, settings, run_id, draft, twins)
    winner, lift = decide_scores(per_draft[0], per_draft[1], {t.user_id: t.followers for t in twins})
    return LabOutcome(run_a=a, run_b=b, winner=winner, lift=lift)


def compare_drafts(stdb, client, brand: str, drafts: list[str], **kw) -> tuple[list[SimSummary], int]:
    if not 2 <= len(drafts) <= 3:
        raise ValueError("compare 2 or 3 drafts")
    summaries = [run_simulation(stdb, client, brand, d, **kw) for d in drafts]
    winner = max(range(len(summaries)), key=lambda i: (summaries[i].reach_p50, -i))
    return summaries, winner
