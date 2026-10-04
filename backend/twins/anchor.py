"""Provisional calibration: scale each signal so simulated means match the brand's real follower engagement.

Cheap (N posts x ~100 Claude calls) and honest about being provisional; the backtest plan replaces it with a fit
on a train split and an evaluation on a held-out test split.
"""
from datetime import datetime, timedelta, timezone

from .bsky import fetch_brand_posts, fetch_engagers
from .simulate import run_simulation
from .stdb import sql_str

SIGNALS = ("like", "repost", "reply", "quote")
FLOOR, CEIL = 0.01, 10.0


def _current(stdb, scope: str) -> dict:
    rows = stdb.sql(f"SELECT * FROM sim_calibration WHERE scope = {sql_str(scope)}") or \
        stdb.sql("SELECT * FROM sim_calibration WHERE scope = 'default'")
    r = rows[0] if rows else {}
    return {"feed_reach": r.get("feed_reach", 0.35), "share_reach": r.get("share_reach", 0.6),
            **{f"{s}_scale": r.get(f"{s}_scale", 1.0) for s in SIGNALS}}


def anchor(stdb, client, brand: str, *, posts: int = 5, settle_days: int = 2, simulate=run_simulation,
           fetch_posts=fetch_brand_posts, fetch_people=fetch_engagers) -> dict:
    handle = brand.lstrip("@")
    brand_row = next(u for u in stdb.sql("SELECT user_id, username FROM x_user") if u["username"].lower() == handle.lower())
    followers = {r["user_id"] for r in stdb.sql("SELECT brand_user_id, user_id FROM twin_audience")
                 if r["brand_user_id"] == brand_row["user_id"]}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=settle_days)).isoformat()
    sample = [p for p in fetch_posts(handle) if p.created_at <= cutoff][:posts]
    if not sample:
        raise ValueError(f"no settled posts for @{handle}")
    predicted = {s: 0.0 for s in SIGNALS}
    observed = {s: 0.0 for s in SIGNALS}
    for p in sample:
        result = simulate(stdb, client, handle, p.text)
        for sig in result.signals:
            predicted[sig.signal] += sig.mean / len(sample)
        people = fetch_people(p.uri)
        for s in SIGNALS:
            observed[s] += len(people[s] & followers) / len(sample)
    cal = _current(stdb, brand_row["user_id"])
    for s in SIGNALS:
        if predicted[s] > 0:
            cal[f"{s}_scale"] = round(min(CEIL, max(FLOOR, cal[f"{s}_scale"] * observed[s] / predicted[s])), 4)
    note = f"anchor on {len(sample)} posts: observed {observed} vs predicted {predicted}"[:300]
    for scope in (brand_row["user_id"], "default"):
        stdb.call("set_sim_calibration", scope, cal["feed_reach"], cal["share_reach"], cal["like_scale"],
                  cal["repost_scale"], cal["reply_scale"], cal["quote_scale"], "anchor", note)
    return cal
