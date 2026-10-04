import asyncio
import json
from types import SimpleNamespace

from conftest import FakeStdb
from ripple_agents import agents, cards
from ripple_agents.messages import AudienceResult, ReactResult
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


def test_menu_and_forms_accept_any_handle_without_planner(monkeypatch):
    monkeypatch.setattr(agents, "asi1_api_key", lambda: (_ for _ in ()).throw(AssertionError("menu called planner")))
    ctx = Context()
    asyncio.run(agents._handle_request(ctx, "user", "Open the Ripple menu"))
    assert "Build an X audience" in str(payload(ctx.sent[-1]))
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"test_form"}'))
    assert payload(ctx.sent[-1])["fields"][0]["kind"] == "text"
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


def test_two_post_card_uses_main_lab_workflow(monkeypatch):
    ctx = Context()
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "test")
    monkeypatch.setattr(agents.asi1, "takeaway", lambda *a: "B works better.")
    seen = []

    async def ask(ctx, address, request, reply_type, timeout):
        seen.append(request)
        from ripple_agents.messages import LabRequest, LabResult
        if isinstance(request, LabRequest):
            return LabResult(brand="linear", experiment_id="42", winner="B", lift=0.5), ""
        return ReactResult(brand="linear", personas=60, variants=[]), ""

    monkeypatch.setattr(agents, "_ask", ask)
    monkeypatch.setattr(agents, "SIMULATOR_ADDRESS", "simulator")
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"react","brand":"linear","draft_a":"A","draft_b":"B"}'))
    assert seen[-1].draft_a == "A" and seen[-1].draft_b == "B"
    assert "exp=42" in ctx.sent[-1].content[0].text and "B wins" in ctx.sent[-1].content[0].text
