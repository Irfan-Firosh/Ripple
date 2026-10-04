"""Anchor the simulation to the brand's real engagement: the twins are a sample of the audience, so their counts are
scaled until the brand's own typical post comes out at the brand's real median likes / reposts / replies / quotes / views.
"""
import logging
from dataclasses import dataclass
from statistics import median

from .stdb import sql_str

log = logging.getLogger(__name__)
RECENT = 30          # newest original posts used for the medians
MIN_BASE = 0.5       # a zero baseline count still gives a finite scale
SIGNAL_FIELDS = {"like": "like_count", "repost": "repost_count", "reply": "reply_count", "quote": "quote_count",
                 "view": "impression_count"}


@dataclass(frozen=True)
class Medians:
    posts: int
    likes: float
    reposts: float
    replies: float
    quotes: float
    views: float

    def of(self, signal: str) -> float:
        return {"like": self.likes, "repost": self.reposts, "reply": self.replies, "quote": self.quotes,
                "view": self.views}[signal]


def _originals(posts: list[dict]) -> list[dict]:
    keep = [p for p in posts if not p.get("is_reply") and not (p.get("text") or "").startswith("RT @")]
    return sorted(keep, key=lambda p: p.get("created_at") or "", reverse=True)[:RECENT]


def _median(posts: list[dict], field: str) -> float:
    values = [float(p[field]) for p in posts if p.get(field) is not None]
    return float(median(values)) if values else 0.0


def real_medians(posts: list[dict]) -> Medians:
    own = _originals(posts)
    return Medians(len(own), *(_median(own, SIGNAL_FIELDS[s]) for s in ("like", "repost", "reply", "quote", "view")))


def typical_post(posts: list[dict], m: Medians) -> str:
    """The recent original whose likes are closest to the median: what an ordinary post from this brand looks like."""
    own = [p for p in _originals(posts) if p.get("like_count") is not None]
    return min(own, key=lambda p: abs(float(p["like_count"]) - m.likes))["text"] if own else ""


def scales(m: Medians, baseline: dict[str, float]) -> dict[str, float]:
    return {s: round(m.of(s) / max(baseline.get(s, 0.0), MIN_BASE), 4) for s in SIGNAL_FIELDS}


def brand_posts(stdb, brand_user_id: str) -> list[dict]:
    return stdb.sql(f"SELECT * FROM x_post WHERE author_user_id = {sql_str(brand_user_id)}")


def calibrate(stdb, client, brand: str, *, simulate) -> dict:
    """Simulate the brand's typical post on its twins (unscaled), then store the scales that map it onto reality."""
    from .brand_twins import load_brand_twins
    brand_user, _ = load_brand_twins(stdb, brand)
    posts = brand_posts(stdb, brand_user.user_id)
    m = real_medians(posts)
    text = typical_post(posts, m)
    if m.posts < 3 or not text:
        raise ValueError(f"@{brand} needs at least 3 recent original posts scraped to anchor the simulation")
    stdb.call("clear_brand_baseline", brand_user.user_id)  # the baseline run itself must be unscaled
    summary = simulate(brand, text)
    base = {x.signal: x.mean for x in summary.signals}
    base["view"] = summary.views.mean if summary.views else 0.0
    sc = scales(m, base)
    stdb.call("set_brand_baseline", brand_user.user_id, m.posts, m.likes, m.reposts, m.replies, m.quotes, m.views,
              sc["like"], sc["repost"], sc["reply"], sc["quote"], sc["view"], summary.run_id,
              f"medians of @{brand}'s last {m.posts} original posts; typical post simulated on its twins")
    log.info("@%s anchored: %s", brand, sc)
    return {"medians": m, "baseline": base, "scales": sc}
