"""Campaign state, safe dispatch, and exact-draft testing across the current Fetch workflow."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from conftest import FakeStdb
from ripple_agents import agents, cards, workflow, simulation
from ripple_agents.asi1 import direct_request
from ripple_agents.messages import CampaignRequest, CampaignResult, LabRequest, LabResult, ReactResult, VariantResult
from test_fetchai_cards import Context, payload


class FlowDB(FakeStdb):
    def call(self, reducer, *args):
        super().call(reducer, *args)
        if reducer == "start_campaign_flow":
            cid, brand, source, a, b = args
            self.tables.setdefault("campaign_flow", []).append(dict(campaign_id=cid, brand=brand, source=source,
                draft_a=a, draft_b=b, stage="concepts", experiment_id=0, video_id="", winner_text=""))
        elif reducer == "update_campaign_flow":
            cid, stage, exp, vid, text = args
            row = next(r for r in self.tables["campaign_flow"] if r["campaign_id"] == cid)
            row.update(stage=stage, experiment_id=exp or row["experiment_id"], video_id=vid or row["video_id"], winner_text=text or row["winner_text"])
        elif reducer == "request_draft_copy":
            cid, draft, headline = args
            self.tables.setdefault("draft_copy", []).append(dict(campaign_id=cid, draft=draft, headline=headline,
                copy_id=f"{cid}:{draft}", status="queued", text=""))


def imported():
    db = FlowDB()
    workflow.execute(db, CampaignRequest(action="import", brand="linear", campaign_id="c", drafts=["Exact A", "Exact B"]))
    return db


def test_import_validate_and_snapshot_preserve_verbatim_posts():
    db = imported()
    result = workflow.snapshot(db, "linear", "c")
    assert result.drafts == ["Exact A", "Exact B"] and "id=c&view=1" in result.summary
    with pytest.raises(ValueError, match="two nonempty"):
        workflow.execute(db, CampaignRequest(action="import", brand="linear", campaign_id="bad", drafts=["A", "B" * 281]))
    assert len(db.reducers("start_campaign_flow")) == 1
    with pytest.raises(ValueError, match="this audience"):
        workflow.snapshot(db, "supermemory", "c")


def test_prepare_uses_current_brand_writer_and_only_this_campaign(monkeypatch):
    db = imported()
    db.tables["campaign_flow"][0]["source"] = "generate"
    db.tables["ad_variant"] = [dict(campaign_id="c", variant_id=v, job_id=1, headline=h, image_url="https://example.com/a.png", status="ready")
                               for v, h in [("v1", "Headline A"), ("v2", "Headline B")]]
    db.tables["draft_copy"] = [dict(campaign_id="unrelated", copy_id="u:A", draft="A", headline="Other", status="queued", text="")]
    from video import copywriter, pipeline
    monkeypatch.setattr(pipeline, "opus_client", lambda: object())
    seen = []
    monkeypatch.setattr(copywriter, "make_writer", lambda *_: "brand-writer")
    def run(stdb, *, write, campaign_id):
        seen.append((write, campaign_id))
        for row in stdb.tables["draft_copy"]:
            if row["campaign_id"] == campaign_id:
                row.update(status="done", text="Full post " + row["draft"])
    monkeypatch.setattr(copywriter, "run_pending_copy", run)
    result = workflow.prepare(db, "linear", "c")
    assert result.drafts == ["Full post A", "Full post B"]
    assert seen == [("brand-writer", "c")]
    assert db.tables["draft_copy"][0]["status"] == "queued"


def test_compare_rejects_different_copy_before_model_calls_and_saves_exact_experiment():
    db = imported()
    req = LabRequest(brand="linear", campaign_id="c", draft_a="Changed A", draft_b="Exact B")
    runner = lambda *_: pytest.fail("mismatched drafts ran simulation")
    with pytest.raises(ValueError, match="exact saved"):
        simulation.compare(db, req, client=object(), runner=runner)
    req.draft_a = "Exact A"
    row = dict(experiment_id=42, status="done", winner="B", lift=.3)
    result = simulation.compare(db, req, client=object(), runner=lambda *a: (row, None))
    assert result.experiment_id == "42"
    assert db.reducers("update_campaign_flow") == [("c", "testing", 42, "", "")]


def test_approve_requires_finished_test_and_uses_tested_copy_not_invented_winner():
    db = imported()
    req = CampaignRequest(action="approve", brand="linear", campaign_id="c", draft="B")
    with pytest.raises(ValueError, match="Finish testing"):
        workflow.execute(db, req)
    db.tables["campaign_flow"][0]["experiment_id"] = 42
    db.tables["lab_experiment"] = [dict(experiment_id=42, status="done", draft_a="Exact A", draft_b="Exact B")]
    result = workflow.execute(db, req)
    assert result.stage == "approved" and "Open X composer" in result.summary
    assert db.reducers("update_campaign_flow") == [("c", "approved", 0, "", "Exact B")]


def test_video_requests_and_edits_use_the_shared_web_reducers():
    db = imported()
    workflow.execute(db, CampaignRequest(action="video", brand="linear", campaign_id="c"))
    assert db.reducers("request_draft_video") == [("c", "A", "Exact A", "reach"), ("c", "B", "Exact B", "reach")]
    db.tables["campaign_draft_video"] = [dict(campaign_id="c", draft="A", video_id="va")]
    db.tables["campaign_video"] = [dict(video_id="va", status="done", video_url="/generated/videos/va/video.mp4")]
    result = workflow.execute(db, CampaignRequest(action="edit_video", brand="linear", campaign_id="c", draft="A", instruction="Shorter opening"))
    assert db.reducers("request_video_edit") == [("va", "Shorter opening", "")]
    assert result.video_urls["A"].endswith("/generated/videos/va/video.mp4")


def test_company_research_returns_sources_and_does_not_claim_backtest_accuracy(monkeypatch):
    db = FlowDB({"x_user": [dict(user_id="b", username="linear")],
        "brand_kit": [dict(brand_user_id="b", display_name="Linear", product_description="Plan software")],
        "brand_baseline": [dict(brand_user_id="b", posts=20)]})
    monkeypatch.setattr(workflow, "company_context", lambda *_: {"news": [dict(title="Release", url="https://linear.app/changelog", date="2026-10-04", summary="New feature")], "best_posts": []})
    result = workflow.discover(db, "linear")
    assert "https://linear.app/changelog" in result.summary and "not a held-out accuracy" in result.summary


@pytest.mark.parametrize("text,action", [("Research @linear", "discover"), ("Generate a campaign for @linear", "create"),
    ("Check campaign progress", "campaign_status"), ("Test both drafts", "test_campaign"),
    ("Make campaign videos", "video"), ("Approve B", "approve"), ("Edit video A: shorter", "edit_video")])
def test_new_standard_commands_do_not_need_planner(text, action):
    assert direct_request(text, "linear").action == action


def test_saved_campaign_test_uses_persisted_posts_then_offers_approval(monkeypatch):
    db = imported()
    ctx = Context()
    ctx._ripple_state = {"brand": "linear", "campaign_id": "c"}
    monkeypatch.setattr(agents, "SIMULATOR_ADDRESS", "simulator")
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "test")
    monkeypatch.setattr(agents.asi1, "takeaway", lambda *_: "B works better.")
    seen = []
    async def ask(_ctx, _address, req, *_):
        seen.append(req)
        if isinstance(req, CampaignRequest):
            return workflow.execute(db, req), ""
        if isinstance(req, LabRequest):
            db.call("update_campaign_flow", "c", "testing", 42, "", "")
            return LabResult(brand="linear", experiment_id="42", winner="B"), ""
        assert req.drafts == ["Exact A", "Exact B"]
        return ReactResult(brand="linear", personas=20), ""
    monkeypatch.setattr(agents, "_ask", ask)
    asyncio.run(agents._handle_request(ctx, "user", json.dumps(dict(action="test_campaign", brand="linear", campaign_id="c"))))
    assert next(r for r in seen if isinstance(r, LabRequest)).campaign_id == "c"
    assert "Approve B" in str(payload(ctx.sent[-1])) and "exp=42" in ctx.sent[-1].content[0].text


def test_interview_report_and_checkout_arrive_before_stream_closes_and_can_be_replayed(monkeypatch):
    ctx = Context()
    monkeypatch.setattr(agents, "SIMULATOR_ADDRESS", "")
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "test")
    monkeypatch.setattr(agents.asi1, "takeaway", lambda *_: "The concrete benefit resonates.")
    async def ask(*_):
        return ReactResult(brand="linear", personas=20, variants=[VariantResult(
            label="A", draft="Exact post", responses=20, failed=0, actions={"like": 12, "ignore": 8},
            engagement_rate=.6, avg_confidence=.8, segment_engagement={"Dev tools": .6},
            quotes=["@sample (like): The concrete benefit is useful."])]), ""
    monkeypatch.setattr(agents, "_ask", ask)
    asyncio.run(agents._handle_request(ctx, "user", 'Test @linear: "Exact post"'))
    # A client that stops consuming the response at end-stream must already
    # have the actual interview reasons, summary, and working checkout card.
    visible = []
    for message in ctx.sent:
        for content in message.content:
            if content.type == "end-stream":
                break
            visible.append(content)
        else:
            continue
        break
    text = "\n".join(c.text for c in visible if c.type == "text")
    assert "60%" in text and "The concrete benefit is useful" in text and "**Takeaway:**" in text
    checkout = next(c for c in visible if c.type == "metadata" and "buy_persona_upgrade" in str(c.metadata))
    assert [c.type for c in ctx.sent[-1].content][-2:] == ["end-stream", "end-session"]
    assert "Expand to 50" in str(checkout.metadata)
    monkeypatch.setattr(agents, "_ask", lambda *_: pytest.fail("replaying results reran interviews"))
    asyncio.run(agents._handle_request(ctx, "user", "Show interview results"))
    assert ctx.sent[-1].content[0].text == ctx._ripple_state["last_analysis"]["report"]
    assert "buy_persona_upgrade" in str(payload(ctx.sent[-1]))
    assert ctx.sent[-1].content[-1].type == "end-session"


def test_campaign_card_failure_does_not_hide_completed_interviews(monkeypatch):
    ctx = Context()
    ctx._ripple_state = {"brand": "linear", "campaign_id": "c"}
    monkeypatch.setattr(agents, "SIMULATOR_ADDRESS", "")
    monkeypatch.setattr(agents, "asi1_api_key", lambda: "test")
    monkeypatch.setattr(agents.asi1, "takeaway", lambda *_: "The benefit resonates.")
    interviewed = False
    async def ask(_ctx, _address, request, _reply, timeout):
        nonlocal interviewed
        if isinstance(request, CampaignRequest):
            if interviewed:
                assert timeout == 10
                raise TimeoutError("campaign snapshot unavailable")
            return CampaignResult(brand="linear", campaign_id="c", drafts=["A", "B"]), ""
        interviewed = True
        return ReactResult(brand="linear", personas=20), ""
    monkeypatch.setattr(agents, "_ask", ask)
    asyncio.run(agents._handle_request(ctx, "user", "Test both drafts"))
    assert "How @linear's audience reacts" in ctx.sent[-1].content[0].text
    assert "Expand to 50" in str(payload(ctx.sent[-1]))
    assert [c.type for c in ctx.sent[-1].content][-2:] == ["end-stream", "end-session"]


def test_other_campaign_id_cannot_take_over_session(monkeypatch):
    ctx = Context()
    ctx._ripple_state = {"brand": "linear", "campaign_id": "c"}
    monkeypatch.setattr(agents, "_ask", lambda *_: pytest.fail("foreign campaign dispatched"))
    asyncio.run(agents._handle_request(ctx, "user", '{"action":"approve","brand":"linear","campaign_id":"foreign","draft":"A"}'))
    assert "in this conversation first" in ctx.sent[-1].content[0].text


def test_video_finishing_after_approval_updates_only_the_approved_drafts_launch_media():
    from video.sync import _attach_to_lab
    db = imported()
    db.tables["campaign_flow"][0].update(stage="approved", experiment_id=42, winner_text="Exact A")
    db.tables["lab_experiment"] = [dict(experiment_id=42, draft_a="Exact A", draft_b="Exact B")]
    db.tables["campaign_draft_video"] = [dict(campaign_id="c", draft="A", video_id="va"), dict(campaign_id="c", draft="B", video_id="vb")]
    _attach_to_lab(db, "vb", "c")
    assert not db.reducers("update_campaign_flow")
    _attach_to_lab(db, "va", "c")
    assert db.reducers("update_campaign_flow") == [("c", "approved", 0, "va", "")]


def test_image_edit_keeps_drafts_stable_and_replaces_the_correct_preview():
    db = imported()
    db.tables["ad_variant"] = [dict(campaign_id="c", variant_id=vid, parent_variant_id=parent, job_id=job, status="ready", image_url=url)
        for vid, parent, job, url in [("a", None, 1, "/a.png"), ("b", None, 1, "/b.png"), ("a-edit", "a", 2, "/edited.png")]]
    result = workflow.snapshot(db, "linear", "c")
    assert result.variant_ids == ["a-edit", "b"] and result.image_urls[0].endswith("/edited.png")
    assert result.drafts == ["Exact A", "Exact B"]
