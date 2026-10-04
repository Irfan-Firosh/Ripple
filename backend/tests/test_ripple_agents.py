from types import SimpleNamespace

import pytest

from conftest import FakeStdb, user_row
from ripple_agents import asi1
from ripple_agents.audience import audience_profile, brand_twins, relevant_twin_ids, render_audience
from ripple_agents.messages import ReactResult
from ripple_agents.reactions import _aggregate, render_report
from test_ask import TWIN
from twins.models import TwinAnswer


class FakeSession:
    def __init__(self, replies, status=200):
        self.replies, self.status, self.calls = list(replies), status, []

    def post(self, url, **kw):
        self.calls.append(kw)
        content = self.replies.pop(0)
        return SimpleNamespace(status_code=self.status, text="nope",
                               json=lambda: {"choices": [{"message": {"content": content}}]})


def _stdb():
    return FakeStdb({
        "x_user": [user_row("100", "SpacetimeDB"), user_row("999", "raycast.com")],
        "twin": [{"user_id": u, "username": n, "brand_user_id": "100"} for u, n in [("1", "ann"), ("2", "bo"), ("3", "cy")]]
                + [{"user_id": "9", "username": "zed", "brand_user_id": "999"}],
        "twin_niche": [{"user_id": "1", "niche": "game_dev", "affinity": 0.9},
                       {"user_id": "2", "niche": "game_dev", "affinity": 0.3},
                       {"user_id": "2", "niche": "backend_infra", "affinity": 0.8},
                       {"user_id": "9", "niche": "game_dev", "affinity": 1.0}],
    })


def test_plan_parses_fenced_json_retries_and_cleans_fields():
    s = FakeSession(['{"action": "dance"}',
                     '```json\n{"action": "react", "brand": "@Raycast", "variants": ["A post", "B post"], '
                     '"niches": ["game_dev", "made_up", "game_dev"]}\n```'])
    plan = asi1.plan_campaign("k", "test A and B on @raycast", session=s)
    assert (plan.action, plan.brand, plan.variants, plan.niches, plan.sample_size) == \
        ("react", "Raycast", ["A post", "B post"], ["game_dev"], 20)
    assert len(s.calls) == 2


def test_plan_defaults_brand_and_reports_errors():
    plan = asi1.plan_campaign("k", "x", session=FakeSession(['{"action": "audience", "brand": null}']))
    assert plan.brand == asi1.DEFAULT_BRAND
    with pytest.raises(asi1.Asi1Error, match="could not plan"):
        asi1.plan_campaign("k", "x", session=FakeSession(["no json", "still none"]))
    with pytest.raises(asi1.Asi1Error, match="HTTP 401"):
        asi1.chat("k", "s", "u", session=FakeSession([""], status=401))


def test_brand_twins_is_case_insensitive_and_scoped_to_brand():
    assert brand_twins(_stdb(), "@spacetimedb") == {"1": "ann", "2": "bo", "3": "cy"}
    assert brand_twins(_stdb(), "@raycast") == brand_twins(_stdb(), "raycast.com") == {"9": "zed"}
    with pytest.raises(LookupError):
        brand_twins(_stdb(), "nobody")
    with pytest.raises(ValueError):
        brand_twins(_stdb(), "x'; DROP")


def test_relevant_twins_rank_by_niche_affinity():
    assert relevant_twin_ids(_stdb(), "spacetimedb", ["game_dev"], 2) == ["1", "2"]
    assert relevant_twin_ids(_stdb(), "spacetimedb", ["backend_infra"], 1) == ["2"]
    assert sorted(relevant_twin_ids(_stdb(), "spacetimedb", [], 5)) == ["1", "2", "3"]


def test_audience_profile_counts_strong_affinity_only():
    r = audience_profile(_stdb(), "spacetimedb", ["game_dev"])
    assert (r.personas, r.matched) == (3, 1)
    assert r.top_people == {"Game development": ["@ann"]}
    assert r.niche_share == {"Game development": pytest.approx(1 / 3), "Backend, databases & cloud": pytest.approx(1 / 3)}
    assert "1 of 3" in render_audience(r, ["game_dev"])


def test_aggregate_counts_actions_segments_and_failures():
    other = TWIN.model_copy(update={"username": "bob"})
    answers = [TwinAnswer(action="reply", confidence=0.8, answer="nice", cited_post_ids=[]),
               TwinAnswer(action="ignore", confidence=0.4, answer="meh", cited_post_ids=[]), None]
    v = _aggregate("A", "draft", [TWIN, other, TWIN], answers)
    assert (v.responses, v.failed, v.actions["reply"], v.actions["ignore"]) == (2, 1, 1, 1)
    assert v.engagement_rate == 0.5 and v.avg_confidence == pytest.approx(0.6)
    assert v.segment_engagement == {"Backend, databases & cloud": 0.5}
    assert v.quotes == ["@alice (reply): nice"]
    report = render_report(ReactResult(brand="spacetimedb", personas=3, variants=[v]))
    assert "| A | 50% | 1 |" in report and "1 persona(s) failed" in report


def test_lab_lines_render_winner_counts_and_live_link():
    from ripple_agents.agents import render_lab
    from ripple_agents.messages import LabResult
    lines = render_lab("raycast.com", LabResult(brand="raycast.com", experiment_id="9", winner="B", lift=0.58,
                                                summary_a="Likely ~26 likes.", summary_b="Likely ~40 likes."))
    text = "\n".join(lines)
    assert "B wins" in text and "+58%" in text and "- A: Likely ~26 likes." in text
    assert "/lab?brand=raycast.com&exp=9" in text


def test_lab_lines_tie():
    from ripple_agents.agents import render_lab
    from ripple_agents.messages import LabResult
    assert "tied" in "\n".join(render_lab("raycast.com", LabResult(brand="raycast.com", experiment_id="2", winner="tie")))


def test_unknown_x_brand_starts_onboarding_once_and_links_to_it():
    from ripple_agents.onboard import onboarding_reply
    db = FakeStdb()
    text = onboarding_reply(db, "linear")
    assert db.reducers("request_onboarding") == [("linear",)]
    assert "@linear" in text and "/onboarding" in text


def test_onboarding_already_running_still_answers():
    from ripple_agents.onboard import onboarding_reply
    db = FakeStdb()
    db.fail_on.add("request_onboarding")
    assert "@linear" in onboarding_reply(db, "linear")


def test_bluesky_brand_is_not_onboarded():
    from ripple_agents.onboard import needs_onboarding, onboarding_reply
    db = FakeStdb()
    assert needs_onboarding("@x.com has no personas yet") and not needs_onboarding("timeout")
    assert needs_onboarding("LookupError: @linear has not been ingested yet")
    assert "X" in onboarding_reply(db, "bsky.app") and db.reducers("request_onboarding") == []


def test_plan_tolerates_create_fields_left_empty_for_other_actions():
    # ASI:One fills unused create fields with 0 / "" / null; that must not sink an audience or react request.
    plan = asi1.CampaignPlan.model_validate({"action": "audience", "brand": "raycast.com", "goal": None, "offer": None,
                                             "n": 0, "aspect_ratio": "", "sample_size": 20, "question": ""})
    assert (plan.n, plan.aspect_ratio, plan.goal, plan.offer) == (3, "1:1", "", "")


def test_plan_clamps_ad_count_and_keeps_valid_aspect():
    plan = asi1.CampaignPlan.model_validate({"action": "create", "goal": "launch", "n": 9, "aspect_ratio": "9:16"})
    assert (plan.n, plan.aspect_ratio) == (4, "9:16")
