import pytest

from conftest import FakeClient, FakeStdb, user_row
from test_brand_twins import twin_row
from twins.simulate import compare_drafts, profile_url, run_simulation


def sim_db():
    db = FakeStdb({
        "x_user": [user_row("B", "spacetimedb"), user_row("1", "alice", profile_image_url="https://pbs/a.jpg"),
                   user_row("2", "bob")],
        "twin": [twin_row("1", "alice"), twin_row("2", "bob")],
        "twin_audience": [{"brand_user_id": "B", "user_id": "1"}, {"brand_user_id": "B", "user_id": "2"}],
        "twin_niche": [{"user_id": "1", "niche": "game_dev", "affinity": 0.9}, {"user_id": "2", "niche": "ai_llms", "affinity": 0.7}],
        "niche": [{"slug": "game_dev", "label": "Game development", "description": ""},
                  {"slug": "ai_llms", "label": "AI models & LLMs", "description": ""}],
        "x_post": [], "x_post_entity": [],
    })
    original = db.call

    def call(reducer, *args):  # emulate the module: start_cascade fills sim_run + sim_node
        original(reducer, *args)
        if reducer == "create_sim_run":
            db.tables.setdefault("sim_run", []).append({"run_id": args[0], "status": "scoring"})
        if reducer == "start_cascade":
            run = next(r for r in db.tables["sim_run"] if r["run_id"] == args[0])
            run.update(status="replaying", reach_p_10=0, reach_p_50=1, reach_p_90=2, seen_p_50=1)
            db.tables["sim_node"] = [{"run_id": args[0], "user_id": "1", "engaged_share": 0.7, "seen_share": 0.9},
                                     {"run_id": args[0], "user_id": "2", "engaged_share": 0.1, "seen_share": 0.4}]
            db.tables.setdefault("sim_signal", []).extend(
                {"run_id": args[0], "signal": s, "p_10": 0, "p_50": k, "p_90": k + 1, "mean": float(k)}
                for s, k in (("like", 3), ("repost", 1), ("reply", 0), ("quote", 0), ("view", 40)))
            db.tables.setdefault("sim_signal_source", []).extend(
                {"run_id": args[0], "signal": s, "source": src, "mean": m}
                for s, src, m in (("like", "followers", 2.0), ("like", "outside", 1.0), ("repost", "followers", 1.0),
                                  ("repost", "outside", 0.0), ("view", "followers", 2.0), ("view", "outside", 38.0)))
    db.call = call
    return db


SCORES = {"scores": [
    {"user_id": "1", "drafts": [{"p_like": 0.8, "p_repost": 0.3, "p_reply": 0, "p_quote": 0, "reason": "builds games"}]},
    {"user_id": "2", "drafts": [{"p_like": 0.01, "p_repost": 0, "p_reply": 0, "p_quote": 0, "reason": "not AI"}]}]}


def test_run_simulation_writes_probs_starts_cascade_and_summarises():
    db = sim_db()
    s = run_simulation(db, FakeClient([SCORES]), "spacetimedb", "We shipped multiplayer", run_id="r1",
                       dashboard_base="https://ripple.app/dashboard", sleep=lambda _: None)
    assert [r for r, _ in db.calls][:5] == ["replace_audience_edges", "create_sim_run", "set_sim_probs", "set_sim_signal_probs", "start_cascade"]
    probs = db.reducers("set_sim_probs")[0][1]
    assert {p["user_id"]: round(p["p_engage"], 4) for p in probs} == {"1": 0.86, "2": 0.01}
    assert [x.signal for x in s.signals] == ["like", "repost", "reply", "quote"] and s.signals[0].p50 == 3
    assert s.views.p50 == 40 and s.outside_share == 0.25          # 1 of 4 expected engagements came from outside
    assert (s.run_id, s.people, s.reach_p50, s.reach_p90) == ("r1", 2, 1, 2)
    assert s.top_responders[0].handle == "alice" and s.top_responders[0].reason == "builds games"
    assert s.top_responders[0].avatar == "https://pbs/a.jpg" and s.top_responders[0].profile_url == "https://x.com/alice"
    assert s.top_niches[0].label == "Game development" and s.top_niches[0].engaged_share == 0.7
    assert s.dashboard_url == "https://ripple.app/dashboard?brand=spacetimedb&run=r1"


def test_scoring_failure_marks_run_failed():
    db = sim_db()
    with pytest.raises(Exception):
        run_simulation(db, FakeClient([None, None]), "spacetimedb", "x", run_id="r2", sleep=lambda _: None)
    assert db.reducers("fail_sim_run")[0][0] == "r2"


def test_compare_picks_highest_median_reach():
    db = sim_db()
    summaries, winner = compare_drafts(db, FakeClient([SCORES, SCORES]), "spacetimedb", ["A", "B"], sleep=lambda _: None)
    assert len(summaries) == 2 and winner == 0


def test_profile_urls():
    assert profile_url("did:plc:x", "a.bsky.social") == "https://bsky.app/profile/a.bsky.social"
    assert profile_url("123", "alice") == "https://x.com/alice"


def test_mostly_unscored_audience_fails_instead_of_underreporting_reach():
    db = sim_db()
    only_alice = {"scores": [SCORES["scores"][0]]}  # bob (half the audience) gets no prediction
    with pytest.raises(RuntimeError, match="scored"):
        run_simulation(db, FakeClient([only_alice]), "spacetimedb", "x", run_id="r3", sleep=lambda _: None)
    assert db.reducers("fail_sim_run")[0][0] == "r3"


def test_summary_reports_how_many_twins_were_scored():
    s = run_simulation(sim_db(), FakeClient([SCORES]), "spacetimedb", "x", run_id="r4", sleep=lambda _: None)
    assert s.scored == 2
