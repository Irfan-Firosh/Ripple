import base64
import json
import threading
from types import SimpleNamespace

import pytest

from conftest import FakeStdb
from creative.brand_kits import SEEDS
from creative.brief import fallback_brief, sanitize_brief, synthesize_brief
from creative.cli import main
from creative.grok import GrokClient, GrokError, ImageResult
from creative.models import BrandKit, Concepts, CreativeBrief, Theme
from creative.prompts import GLOBAL_AVOID, concepts_for_brief, edit_prompt, safe_image_prompt, validate_tweak_prompt
from creative.segments import aggregate_segments
from creative.worker import VARIANT_FIELDS, process_pending, run_worker
from twins.stdb import StdbError


def tables():
    twins = [{"user_id": f"did:plc:secret-{i}", "hot_buttons": ["Honest tool comparisons", "AI tools", "religious voters"],
              "ignores": ["Generic hype", "Politics"], "format_prefs": ["Screenshots"], "tone": "Practical @secret",
              "username": "secret-user", "persona_summary": "15-year-old secret name", "location": "private"} for i in range(30)]
    return {"twin": twins, "twin_audience": [{"user_id": t["user_id"], "brand_user_id": "brand"} for t in twins],
            "twin_niche": [{"user_id": t["user_id"], "niche": "dev_tools" if i < 15 else "ai_agents_tools", "affinity": .7} for i, t in enumerate(twins)] +
                          [{"user_id": t["user_id"], "niche": "design_creative", "affinity": .2} for t in twins],
            "x_post": [{"post_id": "post", "author_user_id": twins[0]["user_id"]}],
            "x_post_entity": [{"post_id": "post", "entity_type": "hashtag", "value": "BuildTools"}, {"post_id": "post", "entity_type": "mention", "value": "@private"}],
            "x_post_media": [{"post_id": "post", "type": "photo"}],
            "brand_kit": [{"brand_user_id": "brand", **SEEDS["raycast.com"]}],
            "campaign": [{"campaign_id": "c", "brand_user_id": "brand", "aspect_ratio": "1:1", "variants_per_brief": 4, "goal": "Launch", "offer": None}],
            "x_user": [{"user_id": "brand", "username": "raycast.com"}]}


def kit():
    return BrandKit(brand_user_id="brand", **SEEDS["raycast.com"])


def test_membership_main_niche_minimum_and_private_allowlist():
    data = tables()
    # A twin belonging to another audience must not enter any pools even if twin.brand_user_id matches.
    data["twin"].append({**data["twin"][0], "user_id": "intruder", "hot_buttons": ["intruder"]})
    data["twin_niche"].append({"user_id": "intruder", "niche": "dev_tools", "affinity": 1})
    stdb = FakeStdb(data)
    segments = aggregate_segments(stdb, "brand")
    assert [s.slug for s in segments] == ["ai_agents_tools", "dev_tools"]
    assert all(s.twin_count == 15 and s.share == .5 for s in segments)
    assert segments[1].signals["media_mix"] == {"photo": 1}
    assert segments[1].signals["top_hashtags"] == ["BuildTools"]
    serialized = json.dumps([s.signals for s in segments])
    for secret in ("did:plc", "secret", "15-year", "private", "religious", "Politics", "intruder", "persona_summary", "username", "location"):
        assert secret not in serialized
    assert "p0001" in serialized
    assert not any("persona_summary" in query for query in stdb.queries)
    with pytest.raises(ValueError):
        aggregate_segments(stdb, "brand", ["design_creative"])
    with pytest.raises(ValueError):
        aggregate_segments(stdb, "brand", ["politics_society"])


def test_argmax_ties_are_deterministic_and_exclusions_do_not_reassign():
    data = tables()
    data["twin_niche"] += [{"user_id": t["user_id"], "niche": "politics_society", "affinity": .9} for t in data["twin"]]
    assert aggregate_segments(FakeStdb(data), "brand") == []
    data = tables()
    data["twin_niche"] += [{"user_id": t["user_id"], "niche": "ai_agents_tools", "affinity": .7} for t in data["twin"]]
    first = aggregate_segments(FakeStdb(data), "brand")
    data["twin_niche"].reverse()
    second = aggregate_segments(FakeStdb(data), "brand")
    assert first == second
    assert first[0].slug == "ai_agents_tools" and first[0].twin_count == 30


def test_support_uses_distinct_valid_source_citations_and_drops_low_sensitive_themes():
    segment = aggregate_segments(FakeStdb(tables()), "brand", ["dev_tools"])[0]
    raw = fallback_brief(segment, kit())
    raw.key_interests = [Theme.model_validate(t) for t in [
        {"text": "Comparisons", "twin_ids": ["p0001", "p0001", "p0002", "unknown"], "support": 1},
        {"text": "Low support", "twin_ids": ["p0003"], "support": 1},
        {"text": "Religious preferences", "twin_ids": list(segment.evidence_ids), "support": 1}]]
    raw.headline_options = ["Guaranteed fastest tools", "Better workflow"]
    clean = sanitize_brief(raw, segment, kit())
    assert len(clean.key_interests) == 1
    assert clean.key_interests[0].support == 2 / 15
    assert len(clean.key_interests[0].twin_ids) == 2
    assert "Guaranteed" not in clean.headline_options[0]
    assert "fastest" not in clean.headline_options[0]


def test_invalid_brief_retries_once_then_deterministic_supported_fallback():
    segment = aggregate_segments(FakeStdb(tables()), "brand", ["dev_tools"])[0]
    class Invalid:
        def __init__(self): self.calls = []
        def chat_json(self, system, user, model):
            self.calls.append(json.loads(user))
            raise GrokError("text model returned an invalid structured response")
    client = Invalid()
    brief = synthesize_brief(client, segment, kit())
    assert len(client.calls) == 2
    assert brief.key_interests[0].support == 1
    assert "did:plc" not in json.dumps(client.calls)
    assert "brand_user_id" not in json.dumps(client.calls)


def test_concepts_strip_evidence_and_sensitive_output_and_always_anchor():
    segment = aggregate_segments(FakeStdb(tables()), "brand", ["dev_tools"])[0]
    brief = sanitize_brief(fallback_brief(segment, kit()), segment, kit())
    class TextClient:
        def chat_json(self, system, user, model):
            assert model is Concepts
            assert "did:plc" not in user and "twin_ids" not in user
            return Concepts(concepts=[dict(concept_name="Desk", image_prompt="A religious voting scene", headline="fastest workspace", cta="Explore")])
    result = concepts_for_brief(TextClient(), brief, kit(), 1, "1:1")[0]
    assert "religious voting scene" not in result.image_prompt
    assert GLOBAL_AVOID in result.image_prompt
    assert "#FF6363" in result.image_prompt
    assert "fastest" not in result.headline
    with pytest.raises(ValueError):
        edit_prompt("target wealthy teens", kit(), "1:1")


def test_visible_prompt_tweak_preserves_harmless_concept_and_reappends_guardrails():
    original = safe_image_prompt("A keyboard on a clean desk with soft red lighting", kit(), "1:1")
    edited = original.replace("soft red lighting", "warm red lighting")
    concept = validate_tweak_prompt(edited, kit())
    assert "warm red lighting" in concept and "Brand:" not in concept
    final = safe_image_prompt(concept, kit(), "9:16")
    assert "keyboard on a clean desk" in final and "warm red lighting" in final
    assert final.endswith(GLOBAL_AVOID) and final.count(GLOBAL_AVOID) == 1
    assert "9:16 social ad" in final and "1:1 social ad" not in final
    assert safe_image_prompt(final, kit(), "9:16") == final
    with pytest.raises(ValueError):
        validate_tweak_prompt(edited.replace("keyboard", "religious voters"), kit())
    with pytest.raises(ValueError):
        validate_tweak_prompt(edited.replace("no political", "target political"), kit())
    long_prompt = safe_image_prompt("clean desk " * 350, kit(), "1:1")
    assert len(long_prompt) <= 4000
    assert validate_tweak_prompt(long_prompt, kit())


class Response:
    def __init__(self, status=200, data=None):
        self.status_code, self.data = status, data or {}
    def json(self): return self.data


class Session:
    def __init__(self, responses): self.responses, self.calls = list(responses), []
    def post(self, url, **kw):
        self.calls.append((url, kw))
        return self.responses.pop(0)


def image_response(url="https://files-cdn.x.ai/test/image.jpg", cost=400000000, **item):
    return Response(data={"data": [{"file_output": {"public_url": url, "file_id": "file123"}, **item}], "usage": {"cost_in_usd_ticks": cost}})


def test_imagine_model_pin_edit_json_and_backoff(tmp_path):
    session = Session([Response(429), Response(503), image_response(), image_response(cost=500000000)])
    sleeps = []
    grok = GrokClient("secret-key", session=session, sleep=sleeps.append, generated_dir=tmp_path)
    generated = grok.generate("desk", "v", "1:1")
    edited = grok.edit("warmer", "e", [generated.image_url, "https://brand.test/product.jpg"], "9:16")
    assert generated.cost_usd_ticks == 400000000 and edited.cost_usd_ticks == 500000000
    assert sleeps == [1.5, 2.5]
    body = session.calls[-1][1]["json"]
    assert body["model"] == "grok-imagine-image-2.0"
    assert body["quality"] == "low" and body["resolution"] == "1k" and body["n"] == 1
    assert body["storage_options"] == {"filename": "ripple-e.jpg", "public_url": True}
    assert body["response_format"] == "b64_json"
    assert len(body["images"]) == 2 and "image" not in body
    assert session.calls[-1][0].endswith("/images/edits")


def test_storage_failure_saves_same_response_and_never_fetches_temp(tmp_path):
    raw = b"\xff\xd8image-bytes"
    session = Session([image_response(url=None, url_unused="https://imgen.x.ai/temp", b64_json=base64.b64encode(raw).decode())])
    result = GrokClient("key", session=session, generated_dir=tmp_path).generate("desk", "fallback")
    assert result.image_url == "/generated/fallback.jpg"
    assert (tmp_path / "fallback.jpg").read_bytes() == raw
    assert len(session.calls) == 1
    with pytest.raises(ValueError):
        GrokClient("key", session=Session([]), generated_dir=tmp_path).generate("desk", "../../bad")


@pytest.mark.parametrize("response", [Response(400, {"error": {"code": "content_policy_violation"}}), Response(data={"respect_moderation": False, "usage": {"cost_in_usd_ticks": 7}}), Response(data={"data": [{"respect_moderation": False}]})])
def test_moderation_is_filtered_without_retry(response):
    session = Session([response])
    with pytest.raises(GrokError) as error:
        GrokClient("key", session=session).generate("desk", "v")
    assert error.value.filtered and len(session.calls) == 1


def test_bad_request_not_retried_and_error_does_not_echo_provider_secrets():
    session = Session([Response(400, {"error": {"code": "invalid_argument", "message": "secret-key @private"}})])
    with pytest.raises(GrokError) as error:
        GrokClient("secret-key", session=session).generate("desk", "v")
    assert len(session.calls) == 1 and "secret-key" not in str(error.value) and "@private" not in str(error.value)


class MemoryStdb(FakeStdb):
    def call(self, reducer, *args):
        super().call(reducer, *args)
        if reducer == "claim_creative_job":
            job = next(j for j in self.tables["creative_job"] if j["job_id"] == args[0])
            if job["status"] != "pending": raise StdbError("claim lost")
            job["status"] = "running"
        if reducer == "upsert_variant":
            def decode(v): return None if isinstance(v, dict) and "none" in v else v.get("some") if isinstance(v, dict) and "some" in v else v
            row = dict(zip(VARIANT_FIELDS, map(decode, args)))
            rows = self.tables.setdefault("ad_variant", [])
            rows[:] = [r for r in rows if r["variant_id"] != row["variant_id"]] + [row]
        if reducer in {"finish_creative_job", "fail_creative_job"}:
            job = next(j for j in self.tables["creative_job"] if j["job_id"] == args[0])
            job["status"] = "done" if reducer == "finish_creative_job" else "failed"


def brief_row(stdb):
    segment = aggregate_segments(stdb, "brand", ["dev_tools"])[0]
    return {**sanitize_brief(fallback_brief(segment, kit()), segment, kit()).model_dump(),
            "brief_id": "c:dev_tools:1", "campaign_id": "c", "share": .5, "twin_count": 15, "version": 1}


class WorkerClient:
    def __init__(self, stdb, fail_index=None):
        self.stdb, self.fail_index = stdb, fail_index
        self.image_calls, self.chat_calls = [], []
        self.lock = threading.Lock()
    def chat_json(self, system, user, model):
        self.chat_calls.append((system, user))
        if model is CreativeBrief:
            payload = json.loads(user)
            return fallback_brief(SimpleNamespace(slug=payload["signals"]["segment"], signals=payload["signals"]), kit())
        return Concepts(concepts=[dict(concept_name=f"Scene {i}", image_prompt=f"Clean desk concept {i}", headline="Practical workflow", cta="Explore") for i in range(json.loads(user)["count"])])
    def generate(self, prompt, vid, aspect):
        with self.lock:
            self.image_calls.append(("generate", prompt, vid, aspect))
        # All 4 generating rows must be visible before any paid request.
        assert len(self.stdb.tables["ad_variant"]) >= 4
        if vid.endswith(str(self.fail_index)):
            raise GrokError("This take was filtered by xAI", filtered=True, cost_usd_ticks=9)
        return ImageResult("https://files-cdn.x.ai/test.jpg", "f" + vid, 40)
    def edit(self, prompt, vid, sources, aspect):
        self.image_calls.append(("edit", prompt, vid, sources, aspect))
        return ImageResult("https://files-cdn.x.ai/edited.jpg", "edited", 50)


def job(kind, target, job_id=1, **kw):
    return {"job_id": job_id, "campaign_id": "c", "kind": kind, "target_id": target, "instruction": None, "aspect_ratio": None,
            "reserved_variants": 4 if kind == "generate" else 0 if kind == "brief" else 1, "status": "pending", **kw}


def test_brief_job_is_text_only_and_uses_reducer_contract():
    data = tables()
    data["creative_job"] = [job("brief", "c:dev_tools:1")]
    stdb = MemoryStdb(data)
    client = WorkerClient(stdb)
    stats = process_pending(stdb, client, campaign_id="c")
    assert stats.done == 1 and stats.cost_usd_ticks == 0
    assert not client.image_calls
    published = stdb.reducers("publish_brief")[0]
    assert published[:6] == (1, "c:dev_tools:1", "c", "dev_tools", 1, "dev tools")
    assert published[8][0]["support"] == 1
    assert set(published[8][0]) == {"text", "support", "twin_ids"}
    assert published[8][0]["twin_ids"] == aggregate_segments(stdb, "brand", ["dev_tools"])[0].twin_ids


def test_long_raw_phrases_produce_valid_supported_fallback_themes():
    segment = aggregate_segments(FakeStdb(tables()), "brand", ["dev_tools"])[0]
    phrase = "Specific keyboard-first workflow comparisons with detailed real-world examples " * 5
    segment.signals["hot_button_pool"] = [{"text": phrase, "twin_id": alias} for alias in segment.evidence_ids]
    brief = sanitize_brief(fallback_brief(segment, kit()), segment, kit())
    assert len(brief.key_interests) == 1
    assert 0 < len(brief.key_interests[0].text) <= 80
    assert brief.key_interests[0].support == 1


def test_concurrent_images_settle_incrementally_cost_and_filtered_no_replay():
    stdb = MemoryStdb(tables())
    stdb.tables["creative_brief"] = [brief_row(stdb)]
    stdb.tables["creative_job"] = [job("generate", "c:dev_tools:1")]
    client = WorkerClient(stdb, fail_index=2)
    stats = process_pending(stdb, client)
    assert stats.failed == 1 and stats.cost_usd_ticks == 129
    assert len(client.image_calls) == 4
    assert len(stdb.reducers("upsert_variant")) == 8
    assert sum(r["status"] == "ready" for r in stdb.tables["ad_variant"]) == 3
    assert stdb.tables["ad_variant"][2]["status"] in {"ready", "filtered"}
    stdb.tables["creative_job"][0]["status"] = "pending"
    process_pending(stdb, client)
    assert len(client.image_calls) == 4 and len(client.chat_calls) == 1


def test_lineage_edits_resize_and_exact_regenerate():
    stdb = MemoryStdb(tables())
    parent = dict(job_id=99, variant_id="parent", campaign_id="c", brief_id="b", parent_variant_id=None, root_variant_id="parent", depth=0,
                  operation="generate", instruction=None, image_prompt="exact prompt", headline="Overlay", cta="Explore", aspect_ratio="1:1", model="grok-imagine-image-2.0",
                  quality="low", status="ready", image_url="https://files-cdn.x.ai/parent.jpg", xai_file_id="file-parent", cost_usd_ticks=40, error=None)
    stdb.tables["ad_variant"] = [parent]
    stdb.tables["creative_job"] = [job("edit", "parent", instruction="make it warmer"), job("resize", "parent", 2, aspect_ratio="9:16"), job("regenerate", "parent", 3)]
    client = WorkerClient(stdb)
    # Regenerate creates only one row, so remove the test double's 4-card assertion.
    client.generate = lambda prompt, vid, aspect: (client.image_calls.append(("generate", prompt, vid, aspect)) or ImageResult("https://files-cdn.x.ai/new.jpg", "new", 40))
    stats = process_pending(stdb, client)
    assert stats.done == 3 and stats.cost_usd_ticks == 140
    children = [r for r in stdb.tables["ad_variant"] if r["variant_id"] != "parent"]
    assert all(r["root_variant_id"] == "parent" and r["parent_variant_id"] == "parent" and r["depth"] == 1 for r in children)
    assert GLOBAL_AVOID in children[0]["image_prompt"] and children[1]["aspect_ratio"] == "9:16"
    assert children[2]["image_prompt"] == "exact prompt"
    assert client.image_calls[0][3] == [{"file_id": "file-parent"}]


def test_regenerate_of_regenerate_keeps_original_edit_endpoint_and_sources():
    stdb = MemoryStdb(tables())
    root = dict(job_id=99, variant_id="root", campaign_id="c", brief_id="b", parent_variant_id=None,
                root_variant_id="root", depth=0, operation="generate", instruction=None, image_prompt="root prompt",
                headline="Overlay", cta="Explore", aspect_ratio="1:1", model="grok-imagine-image-2.0", quality="low",
                status="ready", image_url="https://files-cdn.x.ai/root.jpg", xai_file_id="file-root", cost_usd_ticks=40, error=None)
    edited = {**root, "variant_id": "edited", "parent_variant_id": "root", "operation": "edit", "depth": 1,
              "image_prompt": "exact edit prompt", "xai_file_id": "file-edited"}
    prior_take = {**edited, "variant_id": "prior-take", "parent_variant_id": "edited", "operation": "regenerate", "depth": 2, "xai_file_id": "file-take"}
    stdb.tables["ad_variant"] = [root, edited, prior_take]
    stdb.tables["creative_job"] = [job("regenerate", "prior-take")]
    client = WorkerClient(stdb)
    assert process_pending(stdb, client).done == 1
    assert client.image_calls[0][0] == "edit"
    assert client.image_calls[0][1] == "exact edit prompt"
    assert client.image_calls[0][3] == [{"file_id": "file-root"}]
    child = stdb.tables["ad_variant"][-1]
    assert child["parent_variant_id"] == "prior-take" and child["depth"] == 3


def test_claim_loss_campaign_scope_and_crash_recovery_do_not_bill_again():
    stdb = MemoryStdb(tables())
    stdb.tables["creative_brief"] = [brief_row(stdb)]
    stdb.tables["creative_job"] = [job("generate", "c:dev_tools:1"), job("brief", "other:dev_tools:1", 2, campaign_id="other")]
    client = WorkerClient(stdb)
    stdb.fail_on.add("claim_creative_job")
    assert process_pending(stdb, client, campaign_id="c").claimed == 0
    assert not client.chat_calls
    stdb.fail_on.clear()
    run_worker(stdb, client, once=True, campaign_id="c")
    assert stdb.tables["creative_job"][1]["status"] == "pending"
    stdb.tables["creative_job"][0]["status"] = "pending"
    stdb.tables["ad_variant"][0]["status"] = "generating"
    stats = process_pending(stdb, client, campaign_id="c")
    assert stats.failed == 1
    assert len(client.image_calls) == 4
    assert any("unknown" in (row["error"] or "") for row in stdb.tables["ad_variant"])


def test_seed_cli_does_not_require_xai_key(capsys):
    stdb = FakeStdb(tables())
    assert main(["seed-brand-kits", "--brand", "raycast.com"], stdb=stdb) == 0
    assert stdb.reducers("upsert_brand_kit")[0][0] == "brand"
    assert "seeded 1" in capsys.readouterr().out
