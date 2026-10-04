"""Fetch.ai adapter for the current shared Lab and audience simulation pipeline."""
import asyncio
from pathlib import Path

from uagents import Agent, Context
from twins.config import load_api_key
from twins.lab import run_experiment
from twins.llm import make_client
from twins.simulate import run_simulation

from .config import AVATAR_URL, ORCHESTRATOR, simulation_seed
from .messages import LabRequest, LabResult, SimulateRequest, SimulateResult
from .workflow import snapshot


def summary_line(summary):
    counts = {s.signal: s.p50 for s in summary.signals}
    return "Modeled ~" + ", ".join(f"{counts.get(s, 0):,} {label}" for s, label in
                                   (("like", "likes"), ("repost", "reposts"), ("reply", "replies"), ("quote", "quotes"))) + "."


def compare(stdb, request, *, client=None, runner=run_experiment):
    if request.campaign_id:
        current = snapshot(stdb, request.brand, request.campaign_id)
        if current.drafts != [request.draft_a, request.draft_b]:
            raise ValueError("Test the exact saved campaign drafts")
    row, outcome = runner(stdb, client or make_client(load_api_key()), request.brand, request.draft_a, request.draft_b)
    if row["status"] != "done":
        raise RuntimeError(row.get("error") or "The Lab experiment failed")
    if request.campaign_id:
        stdb.call("update_campaign_flow", request.campaign_id, "testing", row["experiment_id"], "", "")
        # Already completed videos attach now; the video worker attaches later completions.
        for link in stdb.sql("SELECT * FROM campaign_draft_video"):
            if link["campaign_id"] != request.campaign_id:
                continue
            from twins.stdb import sql_str
            videos = stdb.sql(f"SELECT * FROM campaign_video WHERE video_id = {sql_str(link['video_id'])}")
            if videos and videos[0]["status"] == "done":
                stdb.call("attach_lab_draft_media", row["experiment_id"], link["draft"], link["video_id"])
    return LabResult(brand=request.brand, experiment_id=str(row["experiment_id"]), winner=row["winner"], lift=row["lift"],
                     summary_a=summary_line(outcome.run_a) if outcome else "",
                     summary_b=summary_line(outcome.run_b) if outcome else "")


def build_simulator(stdb_factory, *, local=False):
    agent = Agent(name="ripple-simulation", seed=simulation_seed(), mailbox=not local, avatar_url=AVATAR_URL,
                  readme_path=str(Path(__file__).with_name("profiles") / "simulation.md"),
                  publish_agent_details=not local, description="Stress-test two campaign drafts on the same audience and explain the modeled reach.")
    slots = asyncio.Semaphore(2)

    @agent.on_message(LabRequest, replies=LabResult)
    async def on_lab(ctx: Context, sender: str, request: LabRequest):
        if sender != ORCHESTRATOR.address:
            return
        try:
            async with slots:
                result = await asyncio.to_thread(compare, stdb_factory(), request)
        except Exception as exc:
            result = LabResult(brand=request.brand, error=str(exc)[:300])
        await ctx.send(sender, result)

    @agent.on_message(SimulateRequest, replies=SimulateResult)
    async def on_simulate(ctx: Context, sender: str, request: SimulateRequest):
        if sender != ORCHESTRATOR.address:
            return
        try:
            async with slots:
                out = await asyncio.to_thread(run_simulation, stdb_factory(), make_client(load_api_key()), request.brand, request.draft)
            result = SimulateResult(brand=request.brand, reach_low=out.views.p10 if out.views else 0,
                                    reach_high=out.views.p90 if out.views else 0, summary=summary_line(out))
        except Exception as exc:
            result = SimulateResult(brand=request.brand, error=str(exc)[:300])
        await ctx.send(sender, result)
    return agent
