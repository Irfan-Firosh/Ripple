"""Creative specialists share the web worker's queue and persisted campaign state."""
import asyncio
import time
from pathlib import Path

from uagents import Agent, Context

from creative.grok import GrokClient
from creative.guardrails import clean_text
from creative.models import BrandKit
from creative.segments import aggregate_segments
from creative.worker import process_pending
from twins.stdb import opt, sql_str

from .audience import find_brand
from .config import AVATAR_URL, CREATIVE_DIRECTOR, IMAGE_GEN, ORCHESTRATOR
from .messages import BriefRequest, BriefResult, CampaignRequest, CampaignResult, EditRequest, GenerateRequest, VariantsResult

PROFILES = Path(__file__).with_name("profiles")


def ensure_brand_kit(stdb, brand, goal):
    """Keep saved branding; initialize new brands from their own public profile."""
    if stdb.sql(f"SELECT brand_user_id FROM brand_kit WHERE brand_user_id = {sql_str(brand['user_id'])}"):
        return
    profile = stdb.sql(f"SELECT name, description FROM x_user WHERE user_id = {sql_str(brand['user_id'])}")[0]
    name = clean_text(profile.get("name") or brand["username"], limit=100) or brand["username"]
    description = clean_text(profile.get("description") or "", limit=1000) or clean_text(goal, limit=1000)
    kit = BrandKit(brand_user_id=brand["user_id"], display_name=name,
                   product_description=description or f"Campaign for {name}",
                   value_props=[description] if description else [], palette=[],
                   visual_style="Clear, minimal composition; use the supplied campaign goal and brand description.",
                   banned_claims=["guaranteed", "fastest", "free forever"])
    stdb.call("upsert_brand_kit", kit.brand_user_id, kit.display_name, kit.product_description, kit.value_props,
              kit.palette, kit.visual_style, kit.banned_claims, kit.reference_image_urls)


def _complete(stdb, campaign_id, job_ids=None, *, timeout=600, poll_seconds=0.5):
    """Wait for persisted completion even if another worker wins the atomic claim."""
    client = GrokClient()
    deadline = time.monotonic() + timeout
    while True:
        process_pending(stdb, client, campaign_id=campaign_id)
        jobs = stdb.sql(f"SELECT * FROM creative_job WHERE campaign_id = {sql_str(campaign_id)}")
        wanted = [job for job in jobs if job_ids is None or job["job_id"] in job_ids]
        if wanted and all(job["status"] in {"done", "failed"} for job in wanted):
            return wanted
        if time.monotonic() >= deadline:
            raise TimeoutError("Campaign jobs did not finish in time; their progress remains saved")
        time.sleep(poll_seconds)


def create_briefs(stdb, request: BriefRequest) -> BriefResult:
    if not request.goal.strip():
        raise ValueError("Add a campaign goal")
    if not 2 <= request.n <= 4:
        raise ValueError("Choose two to four concepts per segment")
    brand = find_brand(stdb, request.brand)
    segments = aggregate_segments(stdb, brand["user_id"], request.segments or None, limit=1)
    if not segments:
        raise ValueError(f"@{request.brand} has no personas yet. Build its audience before generating a campaign.")
    ensure_brand_kit(stdb, brand, request.goal)
    stdb.call("create_campaign", request.campaign_id, brand["user_id"], request.goal[:100], request.goal,
              opt(request.offer or None), "bluesky" if "." in brand["username"] else "x",
              request.aspect_ratio, [segment.slug for segment in segments], request.n)
    stdb.call("start_campaign_flow", request.campaign_id, brand["username"], "generate", "", "")
    _complete(stdb, request.campaign_id)
    rows = stdb.sql(f"SELECT brief_id FROM creative_brief WHERE campaign_id = {sql_str(request.campaign_id)}")
    if not rows:
        raise RuntimeError("The creative director could not publish any briefs")
    return BriefResult(campaign_id=request.campaign_id, brief_ids=[row["brief_id"] for row in rows])


def create_variants(stdb, request: GenerateRequest | EditRequest) -> VariantsResult:
    campaign = sql_str(request.campaign_id)
    before = {row["job_id"] for row in stdb.sql(f"SELECT job_id FROM creative_job WHERE campaign_id = {campaign}")}
    if isinstance(request, GenerateRequest):
        # The campaign owns the concept count and ratio. Requests cannot quietly change its budget.
        rows = stdb.sql(f"SELECT variants_per_brief, aspect_ratio FROM campaign WHERE campaign_id = {campaign}")
        if not rows or rows[0]["variants_per_brief"] != request.n or rows[0]["aspect_ratio"] != request.aspect_ratio:
            raise ValueError("Generation settings must match the campaign")
        kind, target, instruction, ratio = "generate", request.brief_id, None, None
    else:
        if request.operation not in {"edit", "regenerate", "resize", "branch"}:
            raise ValueError("Unsupported creative operation")
        kind, target, instruction, ratio = request.operation, request.parent_variant_id, request.instruction or None, request.aspect_ratio or None
    stdb.call("request_creative", request.campaign_id, kind, target, opt(instruction), opt(ratio))
    jobs = stdb.sql(f"SELECT * FROM creative_job WHERE campaign_id = {campaign}")
    job_ids = {job["job_id"] for job in jobs if job["job_id"] not in before and job["kind"] == kind and job["target_id"] == target}
    if not job_ids:
        raise RuntimeError("The creative request was not queued")
    settled = _complete(stdb, request.campaign_id, job_ids)
    rows = stdb.sql(f"SELECT job_id, variant_id, image_url, status FROM ad_variant WHERE campaign_id = {campaign}")
    created = [row for row in rows if row["job_id"] in job_ids and row["status"] == "ready" and row["image_url"]]
    warnings = [job.get("error") or "One or more takes could not finish" for job in settled if job["status"] == "failed"]
    if not created:
        raise RuntimeError("; ".join(warnings) or "No ready creatives were returned")
    return VariantsResult(campaign_id=request.campaign_id, variant_ids=[row["variant_id"] for row in created],
                          image_urls=[row["image_url"] for row in created], warnings=warnings)


def build_creative_director(stdb_factory, *, local=False) -> Agent:
    agent = Agent(name=CREATIVE_DIRECTOR.name, seed=CREATIVE_DIRECTOR.seed, mailbox=not local, avatar_url=AVATAR_URL,
                  readme_path=str(PROFILES / "creative-director.md"), publish_agent_details=not local,
                  description="Turn your campaign goal into creative briefs shaped by what each audience group cares about.")

    @agent.on_message(BriefRequest, replies=BriefResult)
    async def on_brief(ctx: Context, sender: str, request: BriefRequest):
        if sender != ORCHESTRATOR.address:
            return
        try:
            result = await asyncio.to_thread(create_briefs, stdb_factory(), request)
        except Exception as exc:
            result = BriefResult(campaign_id=request.campaign_id, error=f"{type(exc).__name__}: {exc}")
        await ctx.send(sender, result)

    @agent.on_message(CampaignRequest, replies=CampaignResult)
    async def on_campaign(ctx: Context, sender: str, request: CampaignRequest):
        if sender != ORCHESTRATOR.address:
            return
        from .workflow import execute
        try:
            result = await asyncio.to_thread(execute, stdb_factory(), request)
        except Exception as exc:
            result = CampaignResult(brand=request.brand, campaign_id=request.campaign_id, error=str(exc)[:300])
        await ctx.send(sender, result)

    return agent


def build_image_gen(stdb_factory, *, local=False) -> Agent:
    agent = Agent(name=IMAGE_GEN.name, seed=IMAGE_GEN.seed, mailbox=not local, avatar_url=AVATAR_URL,
                  readme_path=str(PROFILES / "image-gen.md"), publish_agent_details=not local,
                  description="Make campaign image concepts from your briefs and save each take so you can choose what to test.")

    async def handle(ctx: Context, sender: str, request):
        if sender != ORCHESTRATOR.address:
            return
        try:
            result = await asyncio.to_thread(create_variants, stdb_factory(), request)
        except Exception as exc:
            result = VariantsResult(campaign_id=request.campaign_id, error=f"{type(exc).__name__}: {exc}")
        await ctx.send(sender, result)

    @agent.on_message(GenerateRequest, replies=VariantsResult)
    async def on_generate(ctx: Context, sender: str, request: GenerateRequest):
        await handle(ctx, sender, request)

    @agent.on_message(EditRequest, replies=VariantsResult)
    async def on_edit(ctx: Context, sender: str, request: EditRequest):
        await handle(ctx, sender, request)

    return agent
