from conftest import FakeClient
from test_simulate import sim_db
from twins.simulate import SimSignal, SimSummary, decide, expected_engagements, run_lab


def two(uid, a, b):
    return {"user_id": uid, "drafts": [{"p_like": a, "p_repost": 0, "p_reply": 0, "p_quote": 0, "reason": "ra"},
                                       {"p_like": b, "p_repost": 0, "p_reply": 0, "p_quote": 0, "reason": "rb"}]}


def summ(likes):
    return SimSummary(run_id="r", brand="b", draft="d", people=2, scored=2, reach_p10=0, reach_p50=0, reach_p90=0,
                      seen_p50=0, top_niches=[], top_responders=[], dashboard_url="u",
                      signals=[SimSignal(signal="like", p10=0, p50=int(likes), p90=int(likes), mean=likes)])


def test_decide_winner_and_lift():
    assert decide(summ(2), summ(3)) == ("B", 0.5)
    assert decide(summ(4), summ(2)) == ("A", -0.5)
    assert decide(summ(2), summ(2.05))[0] == "tie"
    assert decide(summ(0), summ(1)) == ("B", 2.0)             # A floored at 0.5
    assert expected_engagements(summ(3)) == 3


def test_run_lab_scores_both_drafts_in_one_pass_and_attaches_runs_early():
    db = sim_db()
    attached = []
    out = run_lab(db, FakeClient([{"scores": [two("1", 0.2, 0.6), two("2", 0.01, 0.02)]}]), "spacetimedb",
                  "draft A", "draft B", on_runs=lambda a, b: attached.append((a, b)), sleep=lambda _: None)
    created = [args[0] for args in db.reducers("create_sim_run")]
    assert attached == [tuple(created)] and len(created) == 2
    order = [r for r, _ in db.calls]
    assert order.index("create_sim_run") < order.index("set_sim_signal_probs")    # runs visible while scoring
    b_probs = db.reducers("set_sim_signal_probs")[1][1]
    assert {p["user_id"]: p["p_like"] for p in b_probs} == {"1": 0.6, "2": 0.02}
    assert out.winner in ("A", "B", "tie") and out.run_a.draft == "draft A" and out.run_b.draft == "draft B"


def test_run_lab_gives_scoring_the_longer_lab_deadline(monkeypatch):
    import twins.simulate as sim
    seen = {}
    real = sim.score_signals

    def spy(client, twins, drafts, **kw):
        seen.update(kw)
        return real(client, twins, drafts, **kw)

    monkeypatch.setattr(sim, "score_signals", spy)
    run_lab(sim_db(), FakeClient([{"scores": [two("1", 0.2, 0.6), two("2", 0.01, 0.02)]}]), "spacetimedb", "a", "b",
            sleep=lambda _: None)
    assert seen["deadline"] == sim.LAB_DEADLINE == 300


def sig(uid, like, reason="r"):
    from twins.policy import SignalScore
    return SignalScore(user_id=uid, p_like=like, p_repost=0, p_reply=0, p_quote=0, reason=reason)


CAL = {"feed_reach": 0.5, "share_reach": 0.6, "like_scale": 1.0, "repost_scale": 1.0, "reply_scale": 1.0, "quote_scale": 1.0}


def test_identical_drafts_always_tie():
    from twins.simulate import decide_scores
    a = [sig(str(i), 0.03) for i in range(999)]
    assert decide_scores(a, list(a), CAL) == ("tie", 0.0)


def test_decide_scores_uses_exact_expected_engagements():
    from twins.simulate import decide_scores
    a = [sig(str(i), 0.10) for i in range(20)]          # expected 20 x 0.10 x 0.5 = 1.0
    b = [sig(str(i), 0.11) for i in range(20)]          # 1.1
    assert decide_scores(a, b, CAL) == ("B", 0.1)


def test_twins_missing_either_draft_are_dropped_from_both():
    from twins.policy import NO_PREDICTION
    from twins.simulate import align_drafts
    a = [sig("1", 0.2), sig("2", 0.3)]
    b = [sig("1", 0.4), sig("2", 0, reason=NO_PREDICTION)]
    a2, b2 = align_drafts(a, b)
    assert a2[1].reason == NO_PREDICTION and a2[1].p_like == 0 and a2[0].p_like == 0.2 and b2[0].p_like == 0.4
