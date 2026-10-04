import asyncio
import threading

from agents.contracts import AudienceRequest, CompareRequest, SimulateRequest, WhyRequest
from agents.handlers import Deps, handle_audience, handle_compare, handle_simulate, handle_why
from twins.simulate import SimSummary


class FakeCtx:
    def __init__(self):
        self.sent = []

    async def send(self, dest, msg):
        self.sent.append((dest, msg))


def summary(run_id="r1", p50=5):
    return SimSummary(run_id=run_id, brand="spacetimedb", draft="d", people=95, scored=95, reach_p10=1, reach_p50=p50, reach_p90=9,
                      seen_p50=30, top_niches=[], top_responders=[], dashboard_url="u")


def deps(**kw):
    base = dict(simulate=lambda b, d, t: summary(), compare=lambda b, ds: ([summary("a", 3), summary("b", 7)], 1),
                why=lambda b, h, d: {"handle": h, "name": "Alice", "avatar": "", "profile_url": "", "action": "reply",
                                     "confidence": 0.7, "answer": "I'd ask about latency"},
                audience=lambda b: {"brand": b, "people": 95, "niches": []})
    base.update(kw)
    return Deps(**base)


def run(coro):
    return asyncio.run(coro)


def test_handle_simulate_replies_with_summary_fields():
    ctx = FakeCtx()
    run(handle_simulate(ctx, "orch", SimulateRequest(request_id="q1", brand="spacetimedb", draft="d"), deps()))
    [(dest, res)] = ctx.sent
    assert dest == "orch" and res.ok and res.request_id == "q1" and res.reach_p50 == 5 and res.dashboard_url == "u"


def test_handle_simulate_runs_off_the_event_loop():
    loop_thread = {}

    def slow(b, d, t):
        loop_thread["worker"] = threading.get_ident()
        return summary()

    async def go():
        loop_thread["loop"] = threading.get_ident()
        await handle_simulate(FakeCtx(), "o", SimulateRequest(request_id="q", brand="spacetimedb", draft="d"), deps(simulate=slow))
    run(go())
    assert loop_thread["worker"] != loop_thread["loop"]


def test_failures_become_error_results_not_exceptions():
    def boom(*a):
        raise ValueError("@ghost is not in @spacetimedb's audience")
    ctx = FakeCtx()
    run(handle_why(ctx, "o", WhyRequest(request_id="q", brand="spacetimedb", handle="ghost", draft="d"), deps(why=boom)))
    res = ctx.sent[0][1]
    assert not res.ok and "not in @spacetimedb's audience" in res.error


def test_unknown_brand_is_rejected_before_any_work():
    ctx = FakeCtx()
    called = []
    run(handle_simulate(ctx, "o", SimulateRequest(request_id="q", brand="nike", draft="d"),
                        deps(simulate=lambda *a: called.append(a))))
    assert not ctx.sent[0][1].ok and "nike" in ctx.sent[0][1].error and called == []


def test_compare_and_audience():
    ctx = FakeCtx()
    run(handle_compare(ctx, "o", CompareRequest(request_id="q", brand="spacetimedb", drafts=["a", "b"]), deps()))
    res = ctx.sent[0][1]
    assert res.ok and res.winner_index == 1 and [r.run_id for r in res.results] == ["a", "b"]
    run(handle_audience(ctx, "o", AudienceRequest(request_id="q2", brand="spacetimedb"), deps()))
    assert ctx.sent[1][1].people == 95


def test_at_most_two_simulations_run_at_once():
    import time
    running, peak = [0], [0]
    lock = threading.Lock()

    def slow(b, d, t):
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        time.sleep(0.2)
        with lock:
            running[0] -= 1
        return summary()

    d = deps(simulate=slow)

    async def go():
        ctx = FakeCtx()
        await asyncio.gather(*(handle_simulate(ctx, "o", SimulateRequest(request_id=str(i), brand="spacetimedb", draft="d"), d)
                               for i in range(4)))
        return ctx
    ctx = run(go())
    assert peak[0] == 2 and len(ctx.sent) == 4 and all(r.ok for _, r in ctx.sent)


def test_only_allowed_senders_are_served_when_an_allowlist_is_set():
    called = []
    d = deps(simulate=lambda *a: called.append(a) or summary(), allowed_senders=frozenset({"orch"}))
    ctx = FakeCtx()
    run(handle_simulate(ctx, "stranger", SimulateRequest(request_id="q", brand="spacetimedb", draft="d"), d))
    run(handle_audience(ctx, "stranger", AudienceRequest(request_id="q2", brand="spacetimedb"), d))
    assert [r.ok for _, r in ctx.sent] == [False, False] and "not allowed" in ctx.sent[0][1].error and called == []
    run(handle_simulate(ctx, "orch", SimulateRequest(request_id="q3", brand="spacetimedb", draft="d"), d))
    assert ctx.sent[-1][1].ok


def full_summary():
    from twins.simulate import SimSignal
    sig = lambda n, p50: SimSignal(signal=n, p10=p50 - 1, p50=p50, p90=p50 + 2, mean=p50 + 0.4)
    return summary().model_copy(update={"brand": "raycast.com", "outside_share": 0.6,
                                        "signals": [sig("like", 42), sig("repost", 9), sig("reply", 3), sig("quote", 1)],
                                        "views": SimSignal(signal="view", p10=1800, p50=2400, p90=3100, mean=2450.2)})


def test_orchestrator_simulate_request_gets_reach_and_a_whole_number_summary():
    from ripple_agents.messages import SimulateRequest as OrchSimulate, SimulateResult as OrchResult
    from agents.handlers import handle_orchestrator_simulate
    seen = {}
    ctx = FakeCtx()

    def sim(brand, draft, trials):
        seen.update(brand=brand, draft=draft)
        return full_summary()

    run(handle_orchestrator_simulate(ctx, "orch", OrchSimulate(brand="@raycast.com", draft="Hi"), deps(simulate=sim)))
    [(dest, res)] = ctx.sent
    assert isinstance(res, OrchResult) and dest == "orch" and seen == {"brand": "raycast.com", "draft": "Hi"}
    assert (res.reach_low, res.reach_high, res.error) == (1800, 3100, "")
    assert "42 likes" in res.summary and "9 reposts" in res.summary and "60%" in res.summary and ".4" not in res.summary


def test_orchestrator_simulate_errors_travel_in_error():
    from ripple_agents.messages import SimulateRequest as OrchSimulate
    from agents.handlers import handle_orchestrator_simulate
    ctx = FakeCtx()
    run(handle_orchestrator_simulate(ctx, "orch", OrchSimulate(brand="nike", draft="Hi"), deps()))
    assert "nike" in ctx.sent[0][1].error and ctx.sent[0][1].reach_high == 0
