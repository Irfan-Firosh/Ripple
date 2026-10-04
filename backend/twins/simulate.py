"""Run a draft through the policy (Claude) and the cascade (SpacetimeDB), then summarise it for agents."""
import os
import time
import uuid
from collections import defaultdict

from pydantic import BaseModel

from .brand_twins import load_brand_twins
from .graph import publish_edges
from .policy import NO_PREDICTION, score_twins
from .stdb import StdbError, sql_str

DASHBOARD_BASE = os.environ.get("RIPPLE_DASHBOARD_URL", "http://localhost:5173/dashboard")
PROB_CHUNK = 200
TOP_RESPONDERS = 5
TOP_NICHES = 4
MAX_UNSCORED = 0.25  # fail rather than report a reach that silently ignores a quarter of the audience


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


def run_simulation(stdb, client, brand: str, draft: str, *, trials: int = 200, run_id: str | None = None,
                   dashboard_base: str = DASHBOARD_BASE, poll_seconds: float = 0.5, timeout: float = 60,
                   sleep=time.sleep) -> SimSummary:
    publish_edges(stdb, brand)
    brand_user, twins = load_brand_twins(stdb, brand)
    run_id = run_id or f"sim-{uuid.uuid4().hex[:12]}"
    stdb.call("create_sim_run", run_id, brand_user.user_id, draft, len(twins))
    try:
        scores = score_twins(client, twins, draft)
        scored = sum(s.reason != NO_PREDICTION for s in scores)
        if scored < len(scores) * (1 - MAX_UNSCORED):
            raise RuntimeError(f"Claude scored only {scored} of {len(scores)} twins; try again shortly")
        probs = [{"user_id": s.user_id, "p_engage": s.p_engage, "action": s.action, "reason": s.reason} for s in scores]
        for i in range(0, len(probs), PROB_CHUNK):
            stdb.call("set_sim_probs", run_id, probs[i:i + PROB_CHUNK])
        stdb.call("start_cascade", run_id, trials)
        run = _wait_for_cascade(stdb, run_id, poll_seconds, timeout, sleep)
    except Exception as exc:
        try:
            stdb.call("fail_sim_run", run_id, f"{type(exc).__name__}: {exc}"[:300])
        except StdbError:
            pass
        raise
    nodes = {n["user_id"]: n for n in stdb.sql(f"SELECT * FROM sim_node WHERE run_id = {sql_str(run_id)}")}
    labels = {n["slug"]: n["label"] for n in stdb.sql("SELECT * FROM niche")}
    score_by = {s.user_id: s for s in scores}

    niche_sum: dict[str, list[float]] = defaultdict(list)
    for t in twins:
        primary = t.niches[0][0] if t.niches else "other"
        niche_sum[primary].append(nodes.get(t.user_id, {}).get("engaged_share", 0.0))
    top_niches = sorted(
        (SimNiche(slug=k, label=labels.get(k, k), engaged_share=round(sum(v) / len(v), 3), people=len(v))
         for k, v in niche_sum.items()),
        key=lambda n: (-n.engaged_share * n.people, -n.people))[:TOP_NICHES]
    ranked = sorted(twins, key=lambda t: -nodes.get(t.user_id, {}).get("engaged_share", 0.0))[:TOP_RESPONDERS]
    top_responders = [SimResponder(
        user_id=t.user_id, handle=t.username, name=t.name, avatar=t.avatar, profile_url=profile_url(t.user_id, t.username),
        action=score_by[t.user_id].action, p_engage=score_by[t.user_id].p_engage,
        engaged_share=round(nodes.get(t.user_id, {}).get("engaged_share", 0.0), 3), reason=score_by[t.user_id].reason)
        for t in ranked]
    return SimSummary(run_id=run_id, brand=brand_user.username, draft=draft, people=len(twins), scored=scored,
                      reach_p10=run["reach_p_10"], reach_p50=run["reach_p_50"], reach_p90=run["reach_p_90"],
                      seen_p50=run["seen_p_50"], top_niches=top_niches, top_responders=top_responders,
                      dashboard_url=f"{dashboard_base}?brand={brand_user.username}&run={run_id}")


def compare_drafts(stdb, client, brand: str, drafts: list[str], **kw) -> tuple[list[SimSummary], int]:
    if not 2 <= len(drafts) <= 3:
        raise ValueError("compare 2 or 3 drafts")
    summaries = [run_simulation(stdb, client, brand, d, **kw) for d in drafts]
    winner = max(range(len(summaries)), key=lambda i: (summaries[i].reach_p50, -i))
    return summaries, winner
