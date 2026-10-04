from types import SimpleNamespace

from conftest import FakeStdb
from twins.anchor import anchor
from twins.bsky import BrandPost


def test_anchor_scales_each_signal_to_observed_follower_means():
    db = FakeStdb({"x_user": [{"user_id": "B", "username": "raycast.com"}],
                   "twin_audience": [{"brand_user_id": "B", "user_id": u} for u in ("a", "b", "c")],
                   "sim_calibration": []})
    posts = [BrandPost(uri=f"p{i}", cid="c", text=f"post {i}", created_at="2026-09-01T00:00:00Z", like_count=9,
                       repost_count=1, reply_count=0, quote_count=0) for i in range(2)]
    people = {"like": {"a", "b", "zzz"}, "repost": {"c"}, "reply": set(), "quote": set()}   # zzz is not a twin
    sim = lambda *a, **k: SimpleNamespace(signals=[SimpleNamespace(signal="like", mean=20.0),
                                                   SimpleNamespace(signal="repost", mean=4.0),
                                                   SimpleNamespace(signal="reply", mean=2.0),
                                                   SimpleNamespace(signal="quote", mean=0.0)])
    cal = anchor(db, None, "raycast.com", posts=2, simulate=sim,
                 fetch_posts=lambda *a, **k: posts, fetch_people=lambda uri, **k: people)
    assert cal["like_scale"] == 0.1 and cal["repost_scale"] == 0.25      # 2/20 and 1/4
    assert cal["reply_scale"] == 0.01                                     # 0 observed → floor, never 0
    assert cal["quote_scale"] == 1.0                                      # nothing predicted → unchanged
    scopes = [args[0] for args in db.reducers("set_sim_calibration")]
    assert scopes == ["B", "default"]
