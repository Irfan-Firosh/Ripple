import pytest

from conftest import post_row, user_row
from twins.models import Account, XPost, XUser
from twins.stats import compute_stats


def account(posts, mentions=None, annotations=None):
    return Account(user=XUser.model_validate(user_row("1", "alice")),
                   posts=[XPost.model_validate(p) for p in posts],
                   mentions=mentions or {}, annotations=annotations or {})


def test_stats_basic():
    acc = account(
        [post_row("a", "1", is_reply=True, like_count=10, impression_count=100, reply_count=0, quote_count=0, repost_count=0,
                  created_at="2026-10-01T15:21:48.000Z"),
         post_row("b", "1", is_quote=True, like_count=None, impression_count=None, created_at="2026-10-01T03:00:00.000Z"),
         post_row("c", "1", like_count=20, impression_count=300, reply_count=5, quote_count=0, repost_count=5,
                  created_at="garbage"),
         post_row("d", "1", like_count=0, impression_count=0)],
        mentions={"a": ["@Bob", "@bob"], "c": ["@carol"]},
        annotations={"a": ["Databases"], "c": ["Databases", "Gaming"]})
    s = compute_stats(acc)
    assert s.post_count == 4
    assert s.reply_share == 0.25 and s.quote_share == 0.25
    assert s.mention_rate == 0.5
    assert s.avg_likes == 10.0              # (10 + 20 + 0) / 3, null ignored
    assert s.avg_impressions == 133.33      # (100 + 300 + 0) / 3
    assert s.engagement_rate == 0.1         # (10 + 30) / 400 over posts with impressions > 0
    assert s.active_hours_utc == [3, 15]
    assert s.top_mentions == ["bob", "carol"]
    assert s.x_topics == ["Databases", "Gaming"]


def test_stats_all_null_metrics():
    s = compute_stats(account([post_row("a", "1", like_count=None, impression_count=None, reply_count=None,
                                        quote_count=None, repost_count=None)]))
    assert s.avg_likes == 0.0 and s.avg_impressions == 0.0 and s.engagement_rate == 0.0


def test_stats_no_posts_are_all_zero():
    s = compute_stats(account([]))
    assert s.post_count == 0 and s.reply_share == 0.0 and s.engagement_rate == 0.0 and s.active_hours_utc == []


def test_engagement_falls_back_to_interactions_per_post_over_followers_without_impressions():
    # Bluesky has no impression counts: use average interactions per post relative to follower count.
    acc = Account(user=XUser.model_validate(user_row("1", "alice.bsky.social", followers_count=200)),
                  posts=[XPost.model_validate(post_row("a", "1", impression_count=None, like_count=6, reply_count=2,
                                                       quote_count=0, repost_count=2)),
                         XPost.model_validate(post_row("b", "1", impression_count=None, like_count=0, reply_count=0,
                                                       quote_count=0, repost_count=0))])
    assert compute_stats(acc).engagement_rate == 0.025  # (10 / 2 posts) / 200 followers
