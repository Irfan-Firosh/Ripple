"""Opt-in reducer integration against a seeded local SpacetimeDB instance; no paid API calls."""
import json
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

from creative.brief import fallback_brief
from creative.grok import ImageResult
from creative.models import BrandKit, Concepts, CreativeBrief
from creative.segments import aggregate_segments
from creative.worker import process_pending
from twins.config import load_stdb_token
from twins.stdb import StdbClient, StdbError, opt, sql_str

URL = os.environ.get("CREATIVE_STDB_TEST_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="Set CREATIVE_STDB_TEST_URL for local reducer integration")
BRAND = "did:plc:w2wcqqbevx536r4vau7f2pae"


@pytest.fixture
def database():
    assert URL.startswith(("http://127.0.0.1:", "http://localhost:")), "Integration writes are local only"
    name = os.environ.get("CREATIVE_STDB_TEST_DATABASE", "ripple-campaign-test")
    return StdbClient(URL, name, load_stdb_token()), StdbClient(URL, name)


class LocalProvider:
    """Exercise worker/reducer contracts without spending; never used by the browser."""
    def __init__(self, kit):
        self.kit = kit
    def chat_json(self, _system, user, model):
        payload = json.loads(user)
        if model is CreativeBrief:
            signals = payload["signals"]
            return fallback_brief(SimpleNamespace(slug=signals["segment"], signals=signals), self.kit)
        return Concepts(concepts=[dict(concept_name=f"Composition {i}", image_prompt=f"A clean keyboard composition {i}",
                                      headline="Room for your next idea", cta="Explore") for i in range(payload["count"])])
    def generate(self, _prompt, variant_id, _aspect):
        return ImageResult(f"https://files-cdn.x.ai/reducer-test/{variant_id}.jpg", None, 0)
    def edit(self, _prompt, variant_id, _sources, _aspect):
        return self.generate(_prompt, variant_id, _aspect)


def campaign(stdb, *, count=4):
    segment = aggregate_segments(stdb, BRAND)[0]
    cid = str(uuid4())
    stdb.call("create_campaign", cid, BRAND, "Reducer integration", "Test a keyboard workflow", opt(None),
              "bluesky", "1:1", [segment.slug], count)
    kit = BrandKit.model_validate(stdb.sql(f"SELECT * FROM brand_kit WHERE brand_user_id = {sql_str(BRAND)}")[0])
    client = LocalProvider(kit)
    stats = process_pending(stdb, client, campaign_id=cid)
    assert stats.failed == 0, stats.errors
    bid = f"{cid}:{segment.slug}:1"
    return cid, bid, client


def test_ownership_review_and_job_contracts(database):
    stdb, outsider = database
    cid, bid, client = campaign(stdb)
    with pytest.raises(StdbError, match="approve"):
        stdb.call("handoff_campaign", cid)
    stdb.call("request_creative", cid, "generate", bid, opt(None), opt(None))
    pending = stdb.sql(f"SELECT * FROM creative_job WHERE campaign_id = {sql_str(cid)} AND status = 'pending'")[0]
    stdb.call("claim_creative_job", pending["job_id"])
    with pytest.raises(StdbError):
        stdb.call("claim_creative_job", pending["job_id"])
    with pytest.raises(StdbError, match="terminal"):
        stdb.call("finish_creative_job", pending["job_id"])
    # Execute the already-claimed job through its real contract.
    from creative.worker import process_job
    cost, errors = process_job(stdb, client, pending)
    assert cost == 0 and not errors
    stdb.call("finish_creative_job", pending["job_id"])
    row = stdb.sql(f"SELECT * FROM ad_variant WHERE campaign_id = {sql_str(cid)}")[0]
    for reducer, args in [("set_variant_copy", [row["variant_id"], "Changed", "Explore"]),
                          ("approve_variant", [row["variant_id"], True]),
                          ("request_creative", [cid, "edit", row["variant_id"], opt("warmer"), opt(None)]),
                          ("handoff_campaign", [cid])]:
        with pytest.raises(StdbError, match="another identity"):
            outsider.call(reducer, *args)
    stdb.call("approve_variant", row["variant_id"], True)
    with pytest.raises(StdbError, match="claim to avoid"):
        stdb.call("set_variant_copy", row["variant_id"], "Guaranteed results", "Explore")
    with pytest.raises(StdbError, match="identifiers"):
        stdb.call("set_variant_copy", row["variant_id"], "Built for @some-follower", "Explore")
    stdb.call("set_variant_copy", row["variant_id"], "Changed copy", "Explore")
    updated = stdb.sql(f"SELECT approved FROM ad_variant WHERE variant_id = {sql_str(row['variant_id'])}")[0]
    assert not updated["approved"]
    stdb.call("approve_variant", row["variant_id"], True)
    stdb.call("handoff_campaign", cid)
    with pytest.raises(StdbError, match="handed off"):
        stdb.call("set_variant_copy", row["variant_id"], "Again", "Explore")


def test_reserved_budget_and_sender_limit(database):
    stdb, _ = database
    cid, bid, client = campaign(stdb)
    for _ in range(3):
        stdb.call("request_creative", cid, "generate", bid, opt(None), opt(None))
    with pytest.raises(StdbError, match="3"):
        stdb.call("request_creative", cid, "generate", bid, opt(None), opt(None))
    stats = process_pending(stdb, client, campaign_id=cid)
    assert stats.done == 3 and not stats.failed, stats.errors
    for _ in range(12):
        stdb.call("request_creative", cid, "generate", bid, opt(None), opt(None))
        stats = process_pending(stdb, client, campaign_id=cid)
        assert not stats.failed, stats.errors
    assert len(stdb.sql(f"SELECT variant_id FROM ad_variant WHERE campaign_id = {sql_str(cid)}")) == 60
    with pytest.raises(StdbError, match="60"):
        stdb.call("request_creative", cid, "generate", bid, opt(None), opt(None))


def test_excluded_targeting_rejected(database):
    stdb, _ = database
    for segment in ("politics_society", "other", "not_a_niche"):
        with pytest.raises(StdbError):
            stdb.call("create_campaign", str(uuid4()), BRAND, "Invalid segment", "Test", opt(None),
                      "bluesky", "1:1", [segment], 2)
