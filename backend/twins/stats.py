"""Deterministic behaviour numbers. No LLM involved."""
from collections import Counter
from datetime import datetime, timezone

from .models import Account, AccountStats

TOP_MENTIONS = 5
TOP_TOPICS = 8


def _hour_utc(created_at: str) -> int | None:
    try:
        return datetime.fromisoformat(created_at.replace("Z", "+00:00")).astimezone(timezone.utc).hour
    except ValueError:
        return None


def _mean(values: list[int | None]) -> float:
    present = [v for v in values if v is not None]
    return round(sum(present) / len(present), 2) if present else 0.0


def _engagement_rate(account: Account, interactions_seen: int, impressions: int) -> float:
    if impressions:
        return round(interactions_seen / impressions, 4)
    # No impression counts (Bluesky): average interactions per post, relative to follower count.
    total = sum((p.like_count or 0) + (p.reply_count or 0) + (p.quote_count or 0) + (p.repost_count or 0)
                for p in account.posts)
    return round(total / len(account.posts) / max(account.user.followers_count or 0, 1), 4)


def compute_stats(account: Account) -> AccountStats:
    posts = account.posts
    n = len(posts)
    if n == 0:  # profile-only account: everything behavioural is zero
        return AccountStats(post_count=0, reply_share=0.0, quote_share=0.0, mention_rate=0.0, avg_likes=0.0,
                            avg_impressions=0.0, engagement_rate=0.0, active_hours_utc=[], top_mentions=[], x_topics=[])
    seen = [p for p in posts if p.impression_count]
    interactions = sum((p.like_count or 0) + (p.reply_count or 0) + (p.quote_count or 0) + (p.repost_count or 0)
                       for p in seen)
    impressions = sum(p.impression_count for p in seen)
    mention_counts = Counter(m.lstrip("@").lower() for ms in account.mentions.values() for m in ms)
    topic_counts = Counter(t for ts in account.annotations.values() for t in ts)
    return AccountStats(
        post_count=n,
        reply_share=round(sum(p.is_reply for p in posts) / n, 3),
        quote_share=round(sum(p.is_quote for p in posts) / n, 3),
        mention_rate=round(sum(1 for p in posts if account.mentions.get(p.post_id)) / n, 3),
        avg_likes=_mean([p.like_count for p in posts]),
        avg_impressions=_mean([p.impression_count for p in posts]),
        engagement_rate=_engagement_rate(account, interactions, impressions),
        active_hours_utc=sorted({h for p in posts if (h := _hour_utc(p.created_at)) is not None}),
        top_mentions=[m for m, _ in mention_counts.most_common(TOP_MENTIONS)],
        x_topics=[t for t, _ in topic_counts.most_common(TOP_TOPICS)],
    )
