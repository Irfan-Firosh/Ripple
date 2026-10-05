"""Creative agent contracts and routing, with no network or paid model calls."""
import asyncio
from types import SimpleNamespace

import pytest
from uagents_core.contrib.protocols.chat import EndSessionContent

from conftest import FakeStdb
from ripple_agents import agents, creative
from ripple_agents.asi1 import CampaignPlan
from ripple_agents.messages import AudienceRequest, AudienceResult, BriefRequest, BriefResult, CampaignRequest, CampaignResult, EditRequest, GenerateRequest, VariantsResult


class QueueStdb(FakeStdb):
    def call(self, reducer, *args):
        super().call(reducer, *args)
        if reducer == "request_creative":
            rows = self.tables.setdefault("creative_job", [])
            rows.append({"job_id": len(rows) + 1, "campaign_id": args[0], "kind": args[1],
                         "target_id": args[2], "status": "pending", "error": None})


def campaign_stdb():
    return QueueStdb({
        "campaign": [{"campaign_id": "campaign", "variants_per_brief": 3, "aspect_ratio": "1:1"}],
        "creative_job": [],
        "ad_variant": [{"variant_id": "existing", "campaign_id": "campaign", "job_id": 0,
                        "image_url": "https://files-cdn.x.ai/existing.jpg", "status": "ready"}],
    })


def test_director_preserves_explicit_segment_goal_and_flat_campaign_contract(monkeypatch):
    stdb = QueueStdb({"x_user": [{"user_id": "brand", "name": "Raycast", "description": "Developer tools"}]})
    selected = []
    monkeypatch.setattr(creative, "find_brand", lambda _db, brand: {"user_id": "brand", "username": "raycast.com"})
    def aggregate(_db, brand_id, segments, **kwargs):
        selected.append((brand_id, segments))
        return [SimpleNamespace(slug="dev_tools"), SimpleNamespace(slug="ai_agents_tools")]
    monkeypatch.setattr(creative, "aggregate_segments", aggregate)
    def complete(*args, **kwargs):
        stdb.tables["creative_brief"] = [
            {"campaign_id": "campaign", "brief_id": "campaign:dev_tools:1"},
            {"campaign_id": "campaign", "brief_id": "campaign:ai_agents_tools:1"},
        ]
    monkeypatch.setattr(creative, "_complete", complete)
    result = creative.create_briefs(stdb, BriefRequest(brand="@raycast.com", campaign_id="campaign", goal="Launch Raycast AI",
                                   offer="Try AI", segments=["dev_tools", "ai_agents_tools"], n=4, aspect_ratio="9:16"))
    assert selected == [("brand", ["dev_tools", "ai_agents_tools"])]
    assert stdb.reducers("create_campaign") == [("campaign", "brand", "Launch Raycast AI", "Launch Raycast AI",
             {"some": "Try AI"}, "bluesky", "9:16", ["dev_tools", "ai_agents_tools"], 4)]
    assert result.brief_ids == ["campaign:dev_tools:1", "campaign:ai_agents_tools:1"]
    assert not stdb.reducers("request_creative")


@pytest.mark.parametrize("n,ratio", [(2, "1:1"), (3, "9:16")])
def test_generation_setting_mismatch_never_enqueues_or_spends(monkeypatch, n, ratio):
    stdb = campaign_stdb()
    monkeypatch.setattr(creative, "_complete", lambda *_args, **_kwargs: pytest.fail("mismatched budget must not run worker"))
    with pytest.raises(ValueError, match="match the campaign"):
        creative.create_variants(stdb, GenerateRequest(campaign_id="campaign", brief_id="brief", n=n, aspect_ratio=ratio))
    assert not stdb.reducers("request_creative")


def test_generation_returns_only_new_ready_images_and_flat_request_contract(monkeypatch):
    stdb = campaign_stdb()
    def complete(*args, **kwargs):
        stdb.tables["creative_job"][0]["status"] = "done"
        stdb.tables["ad_variant"] += [
            {"campaign_id": "campaign", "job_id": 99, "variant_id": "unrelated", "status": "ready", "image_url": "https://files-cdn.x.ai/unrelated.jpg"},
            {"campaign_id": "campaign", "job_id": 1, "variant_id": "new", "status": "ready", "image_url": "https://files-cdn.x.ai/new.jpg"},
            {"campaign_id": "campaign", "job_id": 1, "variant_id": "filtered", "status": "filtered", "image_url": None},
        ]
        return stdb.tables["creative_job"]
    monkeypatch.setattr(creative, "_complete", complete)
    result = creative.create_variants(stdb, GenerateRequest(campaign_id="campaign", brief_id="brief", n=3))
    assert stdb.reducers("request_creative") == [("campaign", "generate", "brief", {"none": []}, {"none": []})]
    assert result.variant_ids == ["new"]
    assert result.image_urls == ["https://files-cdn.x.ai/new.jpg"]


def test_resize_passes_parent_ratio_without_replacing_campaign_budget(monkeypatch):
    stdb = campaign_stdb()
    def complete(*args, **kwargs):
        stdb.tables["creative_job"][0]["status"] = "done"
        stdb.tables["ad_variant"].append({"campaign_id": "campaign", "job_id": 1, "variant_id": "resized", "status": "ready", "image_url": "https://files-cdn.x.ai/resized.jpg"})
        return stdb.tables["creative_job"]
    monkeypatch.setattr(creative, "_complete", complete)
    creative.create_variants(stdb, EditRequest(campaign_id="campaign", parent_variant_id="existing", operation="resize", aspect_ratio="9:16"))
    assert stdb.reducers("request_creative") == [("campaign", "resize", "existing", {"none": []}, {"some": "9:16"})]
    with pytest.raises(ValueError, match="Unsupported creative operation"):
        creative.create_variants(stdb, EditRequest(campaign_id="campaign", parent_variant_id="existing", operation="delete"))
    assert len(stdb.reducers("request_creative")) == 1


class ChatContext:
    def __init__(self):
        self.messages = []
        self.logger = SimpleNamespace(info=lambda *_: None, warning=lambda *_: None)
    async def send(self, sender, message):
        self.messages.append((sender, message))


def chat_text(ctx):
    return "\n".join(content.text for _, message in ctx.messages for content in message.content if hasattr(content, "text"))


def test_create_route_calls_director_then_each_brief_and_surfaces_links(monkeypatch):
    plan = CampaignPlan(action="create", brand="raycast.com", goal="Launch AI", niches=["dev_tools"], n=4, aspect_ratio="9:16")
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "fake")
    monkeypatch.setattr(agents.asi1, "plan_campaign", lambda *_: plan)
    requests = []
    async def ask(ctx, address, request, reply_type, timeout):
        requests.append((address, request))
        if isinstance(request, AudienceRequest):
            return AudienceResult(brand=request.brand, personas=60), ""
        if isinstance(request, BriefRequest):
            return BriefResult(campaign_id=request.campaign_id, brief_ids=["b1", "b2"]), ""
        if isinstance(request, CampaignRequest):
            return CampaignResult(brand=request.brand, campaign_id=request.campaign_id, summary="Full posts and https://files-cdn.x.ai/b1.jpg https://files-cdn.x.ai/b2.jpg",
                                  drafts=["Real A", "Real B"], stage="concepts"), ""
        return VariantsResult(campaign_id=request.campaign_id, variant_ids=[request.brief_id],
                              image_urls=[f"https://files-cdn.x.ai/{request.brief_id}.jpg"]), ""
    monkeypatch.setattr(agents, "_ask", ask)
    ctx = ChatContext()
    monkeypatch.setattr(agents, "_stdb", lambda: FakeStdb())
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"create","brand":"raycast.com","goal":"Launch AI","niches":["dev_tools"],"n":4,"aspect_ratio":"9:16"}'))
    assert [address for address, _ in requests] == [agents.AUDIENCE.address, agents.CREATIVE_DIRECTOR.address, agents.IMAGE_GEN.address, agents.IMAGE_GEN.address, agents.CREATIVE_DIRECTOR.address]
    first = requests[1][1]
    assert (first.goal, first.segments, first.n, first.aspect_ratio) == ("Launch AI", ["dev_tools"], 4, "9:16")
    for _, request in requests[2:4]:
        assert request.campaign_id == first.campaign_id and request.n == 4 and request.aspect_ratio == "9:16"
    assert "https://files-cdn.x.ai/b1.jpg" in chat_text(ctx) and "https://files-cdn.x.ai/b2.jpg" in chat_text(ctx)
    assert any(item.type == "metadata" for item in ctx.messages[-1][1].content)
    assert not any(isinstance(item, EndSessionContent) for item in ctx.messages[-1][1].content)
    assert requests[-1][1].action == "prepare" and ctx._ripple_state["campaign_id"] == first.campaign_id


def test_director_failure_stops_image_generation_and_reports_error(monkeypatch):
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "fake")
    monkeypatch.setattr(agents.asi1, "plan_campaign", lambda *_: CampaignPlan(action="create", goal="Launch AI"))
    requests = []
    async def ask(ctx, address, request, reply_type, timeout):
        requests.append(request)
        if isinstance(request, AudienceRequest):
            return AudienceResult(brand=request.brand, personas=60), ""
        return BriefResult(campaign_id=request.campaign_id, error="No eligible audience"), "No eligible audience"
    monkeypatch.setattr(agents, "_ask", ask)
    ctx = ChatContext()
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"create","brand":"raycast.com","goal":"Launch AI"}'))
    assert len(requests) == 2 and isinstance(requests[1], BriefRequest)
    assert "No eligible audience" in chat_text(ctx)


class FakeAgent:
    def __init__(self, **kwargs):
        self.handlers = {}
    def on_message(self, model, **kwargs):
        def register(fn):
            self.handlers[model] = fn
            return fn
        return register


def test_image_specialist_does_not_run_for_untrusted_agent_sender(monkeypatch):
    monkeypatch.setattr(creative, "Agent", FakeAgent)
    monkeypatch.setattr(creative, "create_variants", lambda *_: pytest.fail("untrusted sender reached worker"))
    agent = creative.build_image_gen(lambda: pytest.fail("untrusted sender reached credentials"))
    ctx = ChatContext()
    request = GenerateRequest(campaign_id="c", brief_id="b")
    asyncio.run(agent.handlers[GenerateRequest](ctx, "unknown-agent", request))
    assert ctx.messages == []


def test_complete_waits_for_external_worker_when_atomic_claim_is_lost(monkeypatch):
    stdb = campaign_stdb()
    stdb.tables["creative_job"] = [{"campaign_id": "campaign", "job_id": 1, "status": "pending"}]
    monkeypatch.setattr(creative, "GrokClient", lambda: object())
    processed = []
    def process(_db, client, **kwargs):
        processed.append(kwargs)
        stdb.tables["creative_job"][0]["status"] = "running" if len(processed) == 1 else "done"
        return SimpleNamespace(claimed=0, failed=0, errors=[])
    monkeypatch.setattr(creative, "process_pending", process)
    sleeps = []
    monkeypatch.setattr(creative.time, "sleep", sleeps.append)
    result = creative._complete(stdb, "campaign", {1}, timeout=10, poll_seconds=.01)
    assert result[0]["status"] == "done"
    assert len(processed) == 2 and sleeps == [.01]
    assert all(call == {"campaign_id": "campaign"} for call in processed)


def test_complete_timeout_keeps_saved_job_and_reports_pending_progress(monkeypatch):
    stdb = campaign_stdb()
    stdb.tables["creative_job"] = [{"campaign_id": "campaign", "job_id": 1, "status": "running"}]
    monkeypatch.setattr(creative, "GrokClient", lambda: object())
    monkeypatch.setattr(creative, "process_pending", lambda *_args, **_kwargs: SimpleNamespace(claimed=0))
    times = iter([0, 1])
    monkeypatch.setattr(creative.time, "monotonic", lambda: next(times))
    with pytest.raises(TimeoutError, match="progress remains saved"):
        creative._complete(stdb, "campaign", {1}, timeout=.5)
    assert stdb.tables["creative_job"][0]["status"] == "running"


def test_partial_generation_retains_ready_assets_and_returns_warning(monkeypatch):
    stdb = campaign_stdb()
    def complete(*args, **kwargs):
        stdb.tables["creative_job"][0].update(status="failed", error="One take was filtered")
        stdb.tables["ad_variant"].append({"campaign_id": "campaign", "job_id": 1, "variant_id": "ready", "status": "ready", "image_url": "https://files-cdn.x.ai/ready.jpg"})
        return stdb.tables["creative_job"]
    monkeypatch.setattr(creative, "_complete", complete)
    result = creative.create_variants(stdb, GenerateRequest(campaign_id="campaign", brief_id="brief", n=3))
    assert result.variant_ids == ["ready"]
    assert result.warnings == ["One take was filtered"] and not result.error
