import asyncio
import json
from types import SimpleNamespace

import pytest
from uagents_core.contrib.protocols.chat.cards import validate_card_payload_json

from conftest import FakeStdb
from ripple_agents import agents, cards
from ripple_agents.messages import AudienceResult, ReactResult, CampaignRequest, CampaignResult, LabRequest
from ripple_agents.onboard import onboarding_state


class Context:
    def __init__(self):
        self.sent = []
        self.logger = SimpleNamespace(info=lambda *a: None, warning=lambda *a: None)

    async def send(self, sender, message):
        self.sent.append(message)


def payload(message):
    metadata = next(c for c in message.content if c.type == "metadata").metadata
    assert metadata["card_protocol_version"] == "1"
    return json.loads(metadata["card_payload"])


def form_selection(form_payload):
    return form_payload["root"]["children"][-1]["items"][0]["action"]["selection"]


def test_menu_and_forms_accept_any_handle_without_planner(monkeypatch):
    monkeypatch.setattr(agents, "asi1_api_key", lambda: (_ for _ in ()).throw(AssertionError("menu called planner")))
    ctx = Context()
    asyncio.run(agents._handle_request(ctx, "user", "Open the Ripple menu"))
    assert "Build an X audience" in str(payload(ctx.sent[-1]))
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"test_form"}'))
    assert payload(ctx.sent[-1])["root"]["children"][0]["kind"] == "text"
    plan = cards.submission('{"action":"react","brand":"@linear","draft_a":"Exact A","draft_b":"Exact B"}')
    assert plan.brand == "linear" and plan.variants == ["Exact A", "Exact B"]
    assert cards.submission('{"action":"react","brand":"@raycast","draft_a":"X post"}').brand == "raycast"


def test_onboarding_reuses_active_build_and_reports_queue_failure():
    db = FakeStdb({"onboarding": [{"onboarding_id": 4, "handle": "linear", "status": "twins"}]})
    assert onboarding_state(db, "@linear", start=True)["status"] == "twins"
    assert not db.calls
    db = FakeStdb()
    db.fail_on.add("request_onboarding")
    row = onboarding_state(db, "newbrand", start=True)
    assert row["status"] == "failed" and "Couldn't queue" in row["error"]
    assert onboarding_state(db, "bad.handle", start=True)["status"] == "failed"
    assert len(db.calls) == 1


def test_retry_targets_failed_build_only():
    db = FakeStdb({"onboarding": [{"onboarding_id": 4, "handle": "linear", "status": "failed"}]})
    assert onboarding_state(db, "linear", retry=True)["status"] == "queued"
    assert db.reducers("retry_onboarding") == [(4,)]
    db.tables["onboarding"][0]["status"] = "scraping"
    assert onboarding_state(db, "linear", retry=True)["status"] == "scraping"
    assert len(db.calls) == 1


def test_refresh_requeues_completed_audience_but_reuses_active_build():
    db = FakeStdb({"onboarding": [{"onboarding_id": 4, "handle": "elorianai", "status": "ready"}]})
    assert onboarding_state(db, "ElorianAI", refresh=True)["status"] == "queued"
    assert db.reducers("request_onboarding") == [("elorianai",)]
    db.tables["onboarding"][0]["status"] = "scraping"
    assert onboarding_state(db, "ElorianAI", refresh=True)["status"] == "scraping"
    assert len(db.calls) == 1
    plan = agents.asi1.direct_request("Refresh @ElorianAI's X audience from scratch.", "ElorianAI")
    assert plan.action == "onboard" and plan.refresh


def test_unknown_audience_saves_request_then_resumes_after_ready(monkeypatch):
    db = FakeStdb()
    ctx = Context()
    calls = []
    monkeypatch.setattr(agents, "_stdb", lambda: db)
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "test")

    async def ask(*args):
        calls.append(args[2])
        if not db.tables.get("onboarding"):
            return AudienceResult(brand="linear", error="@linear has not been ingested yet"), "@linear has not been ingested yet"
        return AudienceResult(brand="linear", personas=60), ""

    monkeypatch.setattr(agents, "_ask", ask)
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"audience","brand":"linear"}'))
    assert db.reducers("request_onboarding") == [("linear",)]
    assert ctx._ripple_state["pending"]["brand"] == "linear"
    assert "Check progress" in str(payload(ctx.sent[-1]))
    db.tables["onboarding"] = [{"onboarding_id": 1, "handle": "linear", "status": "twins"}]
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"resume","brand":"linear"}'))
    assert len(calls) == 1  # resuming early must not dispatch work
    db.tables["onboarding"][0]["status"] = "ready"
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"status","brand":"linear"}'))
    assert "Continue my request" in str(payload(ctx.sent[-1]))
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"resume","brand":"linear"}'))
    assert len(calls) == 2 and "pending" not in ctx._ripple_state
    assert "60 personas" in ctx.sent[-1].content[0].text


@pytest.mark.parametrize("prefix", ["", "@ripple ", "@ripple\n", "@agent1abc "])
def test_two_post_card_uses_main_lab_workflow(monkeypatch, prefix):
    ctx = Context()
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "test")
    monkeypatch.setattr(agents.asi1, "takeaway", lambda *a: "B works better.")
    seen = []

    async def ask(ctx, address, request, reply_type, timeout):
        seen.append(request)
        from ripple_agents.messages import LabRequest, LabResult
        if isinstance(request, LabRequest):
            return LabResult(brand="linear", experiment_id="42", winner="B", lift=0.5), ""
        if isinstance(request, CampaignRequest):
            return CampaignResult(brand="linear", campaign_id=request.campaign_id, drafts=["A", "B"], stage="testing"), ""
        return ReactResult(brand="linear", personas=60, variants=[]), ""

    monkeypatch.setattr(agents, "_ask", ask)
    monkeypatch.setattr(agents, "SIMULATOR_ADDRESS", "simulator")
    asyncio.run(agents._handle_request(ctx, "user", prefix + '{"action":"react","brand":"linear","draft_a":"A","draft_b":"B"}'))
    lab = next(r for r in seen if isinstance(r, LabRequest))
    assert lab.draft_a == "A" and lab.draft_b == "B" and lab.campaign_id.startswith("import-")
    assert "exp=42" in ctx.sent[-1].content[0].text and "B wins" in ctx.sent[-1].content[0].text


def test_mentioned_test_button_opens_form_without_planner(monkeypatch):
    monkeypatch.setattr(agents, "asi1_api_key", lambda: (_ for _ in ()).throw(AssertionError("button called planner")))
    ctx = Context()
    ctx._ripple_state = {"brand": "oakhcft"}
    asyncio.run(agents._handle_request(ctx, "user", '@ripple {"action":"test_form","brand":"oakhcft"}'))
    assert payload(ctx.sent[-1])["root"]["title"] == "Test your post"
    assert ctx._ripple_state["awaiting"] == "react"


def test_form_values_override_selection_and_blank_keeps_explicit_audience():
    submit = form_selection(payload(agents._text("", card=cards.form("react", "supermemory"))))
    # ASI merges static selection values last; do not override the brand input.
    assert "brand" not in submit and submit["audience"] == "supermemory"
    plan = cards.submission(json.dumps({"selection": submit, "brand": "linear", "draft_a": "Exact A", "draft_b": "Exact B"}))
    assert plan.brand == "linear" and plan.variants == ["Exact A", "Exact B"]
    plan = cards.submission(json.dumps({"selection": submit, "brand": "", "draft_a": "Exact A"}))
    assert plan.brand == "supermemory"
    build = payload(agents._text("", card=cards.form("onboard", "supermemory")))
    assert build["root"]["children"][0]["required"] and form_selection(build)["audience"] == ""


@pytest.mark.parametrize("content", [
    cards.menu("supermemory"),
    *[cards.form(action, "supermemory") for action in ("onboard", "react", "audience", "create", "discover", "edit_video", "edit_image")],
    cards.campaign(CampaignResult(brand="supermemory", campaign_id="c", drafts=["A", "B"], stage="testing",
                                 image_urls=["https://example.com/a.png"], variant_ids=["v"], video_urls={"A": "https://example.com/a.mp4"})),
    *[cards.onboarding({"handle": "supermemory", "status": status}, can_resume=True)
      for status in ("queued", "failed", "ready")],
    cards.next_steps("supermemory"),
    cards.creatives("supermemory", [{"headline": "Persistent memory", "cta": "Explore Supermemory",
                                    "image_url": "https://example.com/concept.png"}]),
    cards.loading("supermemory", "Reading audience", 1),
])
def test_image_action_cards_fit_the_official_schema_and_payload_limit(content):
    metadata = content.metadata
    validate_card_payload_json(metadata["card_kind"], metadata["card_payload"])
    assert len(metadata["card_payload"].encode()) <= 64 * 1024


def test_fresh_session_does_not_inherit_other_chats_audience(monkeypatch):
    class Storage:
        def __init__(self): self.values = {}
        def get(self, key): return self.values.get(key)
        def set(self, key, value): self.values[key] = value.copy()
    ctx = Context()
    ctx.storage, ctx.session = Storage(), "first"
    key, state = agents._state(ctx, "user")
    state.update(brand="supermemory", awaiting="create", last_action="create")
    agents._save_state(ctx, key, state)
    ctx.session = "second"
    asyncio.run(agents._handle_request(ctx, "user", "Open the Ripple menu"))
    assert "Current audience" not in ctx.sent[-1].content[0].text
    ctx.session = "first"
    assert agents._state(ctx, "user")[1]["brand"] == "supermemory"


def test_switching_company_clears_unfinished_goal_and_saved_request(monkeypatch):
    ctx = Context()
    ctx._ripple_state = {"brand": "supermemory", "awaiting": "create", "last_action": "create", "pending": {"brand": "supermemory"}}
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "test")
    requests = []
    async def ask(ctx, address, request, reply_type, timeout):
        requests.append(request)
        return AudienceResult(brand=request.brand, personas=60), ""
    monkeypatch.setattr(agents, "_ask", ask)
    asyncio.run(agents._handle_request(ctx, "user", "What are the main interests in @linear’s audience?"))
    assert len(requests) == 1 and requests[0].brand == "linear"
    assert "pending" not in ctx._ripple_state and "awaiting" not in ctx._ripple_state
