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
