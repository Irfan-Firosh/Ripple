from agents.contracts import (BRANDS, CompareResult, NicheReach, Responder, SimulateRequest, SimulateResult,
                              WhyRequest)


def test_simulate_result_round_trips_with_nested_models():
    r = SimulateResult(request_id="q1", ok=True, run_id="r1", brand="raycast.com", draft="hi", people=1000,
                       reach_p10=12, reach_p50=20, reach_p90=31, seen_p50=300,
                       top_niches=[NicheReach(slug="dev_tools", label="Developer tools", engaged_share=0.4, people=180)],
                       top_responders=[Responder(user_id="did:plc:a", handle="a.bsky.social", name="A", avatar="",
                                                 profile_url="https://bsky.app/profile/a.bsky.social", action="repost",
                                                 p_engage=0.8, engaged_share=0.31, reason="loves launchers")])
    back = SimulateResult.parse_raw(r.json())
    assert back == r and back.top_responders[0].handle == "a.bsky.social"


def test_failure_results_need_only_id_and_error():
    assert SimulateResult(request_id="q", ok=False, error="boom").top_niches == []
    assert CompareResult(request_id="q", ok=False, error="boom").winner_index == -1


def test_requests_and_brands():
    assert SimulateRequest(request_id="q", brand="spacetimedb", draft="x").trials == 200
    assert WhyRequest(request_id="q", brand="spacetimedb", handle="alice", draft="x").handle == "alice"
    assert BRANDS == ("spacetimedb", "raycast.com")
