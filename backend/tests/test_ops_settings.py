from types import SimpleNamespace

from conftest import FakeClient, FakeStdb, post_row, user_row
from twins.filler import fill_replies
from twins.settings import DEFAULTS, cap_twins, load_settings
from twins.topup import run_pending_topups


def settings_row(**kw):
    return {"key": "global", "twins_per_brand": 80, "followers_scraped": 500, "sim_twins": 10,
            "scale_mode": "linear", "fill_replies": 5, **kw}


def test_settings_default_when_no_row():
    assert load_settings(FakeStdb()) == DEFAULTS
    assert DEFAULTS.twins_per_brand == 60 and DEFAULTS.followers_scraped == 300 and DEFAULTS.sim_twins == 0


def test_settings_read_from_the_global_row():
    s = load_settings(FakeStdb({"sim_settings": [settings_row()]}))
    assert (s.twins_per_brand, s.followers_scraped, s.sim_twins, s.scale_mode, s.fill_replies) == (80, 500, 10, "linear", 5)


def test_cap_twins_keeps_the_best_evidenced_and_zero_means_all():
    twins = [SimpleNamespace(user_id=str(i), post_count=i) for i in range(6)]
    assert [t.user_id for t in cap_twins(twins, 3)] == ["5", "4", "3"]
    assert cap_twins(twins, 0) == twins
    assert cap_twins(twins, 99) == twins


def filler_db(reply_p50=12, comments=1):
    users = [user_row("b", "brand"), user_row("t1", "twin1"), user_row("f1", "fan1", description="rust dev"),
             user_row("f2", "fan2")]
    return FakeStdb({
        "sim_run": [{"run_id": "r1", "brand_user_id": "b", "replay_max_tick": 20}],
        "sim_signal": [{"run_id": "r1", "signal": "reply", "p_50": reply_p50, "mean": float(reply_p50)}],
        "sim_comment": [{"run_id": "r1", "user_id": "t1", "kind": "reply"}] * comments,
        "audience_membership": [{"brand_user_id": "b", "follower_user_id": u} for u in ("t1", "f1", "f2")],
        "x_user": users,
        "x_post": [post_row("p1", "f1", "shipping a new crate today")],
    })


def test_fill_replies_writes_extra_replies_from_real_non_twin_followers():
    db = filler_db()
    client = FakeClient([{"comments": [{"user_id": "f1", "text": "nice"}, {"user_id": "f2", "text": "cool"},
                                       {"user_id": "t1", "text": "twin must not appear"}]}])
    assert fill_replies(db, client, "r1", "draft", twin_ids={"t1"}, limit=5) == 2
    (run_id, rows), = db.reducers("add_sim_comments")
    assert run_id == "r1" and {r["user_id"] for r in rows} == {"f1", "f2"}
    assert all(r["kind"] == "reply" and 0 <= r["tick"] <= 20 for r in rows)
    assert "rust dev" in client.calls[0]["messages"][0]["content"]


def test_fill_replies_follows_the_drafts_expected_replies_so_drafts_differ():
    db = filler_db(reply_p50=1, comments=0)  # this draft expects ~1 reply: it gets 1 comment, not the full 5
    client = FakeClient([{"comments": [{"user_id": "f1", "text": "nice"}, {"user_id": "f2", "text": "cool"}]}])
    assert fill_replies(db, client, "r1", "draft", twin_ids={"t1"}, limit=5) == 1


def test_fill_replies_tops_up_to_the_limit_and_stops_there():
    db = filler_db(comments=5)
    assert fill_replies(db, FakeClient([]), "r1", "draft", twin_ids={"t1"}, limit=5) == 0
    assert not db.reducers("add_sim_comments")


def test_topups_build_more_twins_then_regraph():
    db = FakeStdb({"twin_topup": [{"topup_id": 3, "brand": "raycast", "count": 25, "status": "queued"},
                                  {"topup_id": 4, "brand": "linear", "count": 5, "status": "done"}]})
    seen = []
    n = run_pending_topups(db, None, build=lambda stdb, client, brand, **kw: seen.append(("build", brand, kw)),
                           edges=lambda stdb, brand: seen.append(("edges", brand)))
    assert n == 1
    assert seen[0] == ("build", "raycast", {"limit": 25, "skip_existing": True, "richest_first": True,
                                            "run_id": "topup-3-raycast"})
    assert seen[1] == ("edges", "raycast")
    assert [a[1] for a in db.reducers("set_twin_topup")] == ["running", "done"]
    assert all(a[-1] == 2 for a in db.reducers("set_twin_topup"))  # worker version


def test_failed_topup_is_recorded():
    db = FakeStdb({"twin_topup": [{"topup_id": 3, "brand": "raycast", "count": 25, "status": "queued"}]})

    def boom(*a, **kw):
        raise RuntimeError("no audience")
    run_pending_topups(db, None, build=boom, edges=lambda *a: None)
    assert db.reducers("set_twin_topup")[-1][1:] == ("failed", "RuntimeError: no audience", 2)


def test_onboarding_uses_the_ops_settings():
    from twins.onboarding import run_pending_onboardings
    db = FakeStdb({"onboarding": [dict(onboarding_id=1, handle="raycast", status="queued")],
                   "sim_settings": [settings_row(twins_per_brand=20, followers_scraped=150)]})
    seen = {}
    run_pending_onboardings(db, None, ingest=lambda h, **kw: seen.update(ingest=kw) or {"brand_user_id": "1", "pending": 0},
                            build=lambda s, c, h, **kw: seen.update(build=kw), edges=lambda s, h: None)
    assert seen["ingest"]["followers"] == 150 and seen["build"]["limit"] == 20


def test_projected_replies_only_in_linear_mode(monkeypatch):
    import twins.simulate as sim
    from twins.settings import SimSettings
    calls = []
    monkeypatch.setattr(sim, "fill_replies", lambda *a, **kw: calls.append(kw))
    twins = [SimpleNamespace(user_id="t1")]
    sim._project_replies(None, None, SimSettings(scale_mode="anchored", fill_replies=5), "r", "d", twins)
    sim._project_replies(None, None, SimSettings(scale_mode="linear", fill_replies=0), "r", "d", twins)
    assert not calls
    sim._project_replies(None, None, SimSettings(scale_mode="linear", fill_replies=5), "r", "d", twins)
    assert calls == [{"twin_ids": {"t1"}, "limit": 5}]


def test_ops_admin_cli_validates_and_adds_identity():
    from twins.cli import main
    db = FakeStdb()
    assert main(["ops-admin", "nothex"], stdb=db, client=object()) == 1
    assert main(["ops-admin", "0x" + "ab" * 32], stdb=db, client=object()) == 0
    assert db.reducers("add_ops_admin") == [({"__identity__": "0x" + "ab" * 32}, "ops page")]


def test_onboarding_builds_every_twin_the_ops_page_asks_for_in_one_pass():
    from twins.onboarding import run_pending_onboardings
    db = FakeStdb({"onboarding": [dict(onboarding_id=1, handle="trycua", status="queued")],
                   "sim_settings": [settings_row(twins_per_brand=120)]})
    seen = {}
    run_pending_onboardings(db, None, ingest=lambda h, **kw: seen.update(ingest=kw) or {"brand_user_id": "1", "pending": 0},
                            build=lambda s, c, h, **kw: seen.update(build=kw), edges=lambda s, h: None)
    assert seen["build"]["limit"] == 120  # not capped at 60
    assert seen["ingest"]["max_new_timelines"] >= 120  # a twin needs its timeline


def test_onboarding_creates_the_brand_kit_before_ready():
    from twins.onboarding import run_pending_onboardings
    db = FakeStdb({"onboarding": [dict(onboarding_id=1, handle="trycua", status="queued")],
                   "x_user": [user_row("1", "trycua", description="Computer-use agents. Open source sandboxes for AI.")]})
    run_pending_onboardings(db, None, ingest=lambda h, **kw: {"brand_user_id": "1", "pending": 0},
                            build=lambda *a, **kw: None, edges=lambda s, h: None)
    (kit,) = db.reducers("upsert_brand_kit")
    assert kit[0] == "1" and kit[1] == "Trycua"
    names = [c[0] for c in db.calls]
    assert names.index("upsert_brand_kit") < max(i for i, c in enumerate(db.calls) if c[0] == "set_onboarding_progress" and c[1][1] == "ready")


def test_fill_replies_falls_back_to_quiet_twins_when_every_follower_is_a_twin():
    db = filler_db(comments=0)
    db.tables["audience_membership"] = [{"brand_user_id": "b", "follower_user_id": "t1"}]
    client = FakeClient([{"comments": [{"user_id": "t1", "text": "same here"}]}])
    assert fill_replies(db, client, "r1", "draft", twin_ids={"t1"}, limit=5) == 1
