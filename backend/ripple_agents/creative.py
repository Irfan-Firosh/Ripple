"""Creative specialists share the web worker's queue and persisted campaign state."""
import asyncio
import time

from uagents import Agent, Context

from creative.grok import GrokClient
from creative.segments import aggregate_segments
from creative.worker import process_pending
from twins.stdb import opt, sql_str

from .audience import find_brand
from .config import AVATAR_URL, CREATIVE_DIRECTOR, IMAGE_GEN, ORCHESTRATOR
from .messages import BriefRequest, BriefResult, EditRequest, GenerateRequest, VariantsResult


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
    segments = aggregate_segments(stdb, brand["user_id"], request.segments or None, limit=3)
    if not segments:
        raise ValueError("No eligible audience segments with at least 15 personas")
    stdb.call("create_campaign", request.campaign_id, brand["user_id"], request.goal[:100], request.goal,
              opt(request.offer or None), "bluesky" if "." in brand["username"] else "x",
              request.aspect_ratio, [segment.slug for segment in segments], request.n)
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


def build_creative_director(stdb_factory) -> Agent:
    agent = Agent(name=CREATIVE_DIRECTOR.name, seed=CREATIVE_DIRECTOR.seed, mailbox=True, avatar_url=AVATAR_URL,
                  description="Turns aggregated audience preferences into evidence-backed creative briefs")

    @agent.on_message(BriefRequest, replies=BriefResult)
    async def on_brief(ctx: Context, sender: str, request: BriefRequest):
        if sender != ORCHESTRATOR.address:
            return
        try:
            result = await asyncio.to_thread(create_briefs, stdb_factory(), request)
        except Exception as exc:
            result = BriefResult(campaign_id=request.campaign_id, error=f"{type(exc).__name__}: {exc}")
        await ctx.send(sender, result)

    return agent


def build_image_gen(stdb_factory) -> Agent:
    agent = Agent(name=IMAGE_GEN.name, seed=IMAGE_GEN.seed, mailbox=True, avatar_url=AVATAR_URL,
                  description="Creates and refines campaign ads with Grok Imagine; saves every take in SpacetimeDB")

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
