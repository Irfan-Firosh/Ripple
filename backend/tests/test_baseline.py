"""Anchoring the simulation to a brand's real recent engagement."""
from twins.baseline import real_medians, scales, typical_post


def post(i, likes, reposts=10, replies=5, quotes=2, views=10000, is_reply=False, text=None, day=None):
    return {"post_id": str(i), "text": text or f"post {i}", "is_reply": is_reply, "like_count": likes,
            "repost_count": reposts, "reply_count": replies, "quote_count": quotes, "impression_count": views,
            "created_at": f"2026-09-{day or (10 + i):02d}T10:00:00.000Z"}


def test_medians_use_recent_original_posts_only():
    posts = [post(1, 100), post(2, 300), post(3, 200), post(4, 9999, is_reply=True), post(5, 50, text="RT @x: hi")]
    m = real_medians(posts)
    assert m.posts == 3 and m.likes == 200 and m.views == 10000


def test_medians_skip_missing_metrics():
    m = real_medians([post(1, 100, views=None), post(2, 300, views=20000)])
    assert m.likes == 200 and m.views == 20000


def test_typical_post_is_the_one_closest_to_the_median():
    posts = [post(1, 100, text="low"), post(2, 210, text="typical"), post(3, 900, text="viral")]
    assert typical_post(posts, real_medians(posts)) == "typical"


def test_scales_turn_twin_counts_into_real_counts():
    m = real_medians([post(1, 1200, reposts=100, replies=60, quotes=40, views=200000)])
    s = scales(m, {"like": 12.0, "repost": 4.0, "reply": 3.0, "quote": 0.0, "view": 400.0})
    assert s["like"] == 100.0 and s["repost"] == 25.0 and s["reply"] == 20.0 and s["view"] == 500.0
    assert s["quote"] == 80.0  # a zero baseline counts as 0.5 so the scale stays finite
