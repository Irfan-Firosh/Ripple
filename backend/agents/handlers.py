"""Pure async handlers for the Audience and Simulation agents. The uAgent files only wire these up."""
import asyncio
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable

from twins.ask import ask_twin
from twins.brand_twins import load_brand_twins
from twins.lab import run_experiment
from twins.config import STDB_DATABASE, STDB_URL, load_api_key, load_stdb_token
from twins.llm import make_client
from twins.simulate import compare_drafts, profile_url, run_simulation
from twins.stdb import StdbClient
from twins.sync import load_twin

from ripple_agents.messages import LabRequest as OrchLabRequest
from ripple_agents.messages import LabResult as OrchLabResult
from ripple_agents.messages import SimulateRequest as OrchSimulateRequest
from ripple_agents.messages import SimulateResult as OrchSimulateResult

from .settings import allowed_senders
from twins.source import USERNAME_RE
from .contracts import (AudienceRequest, AudienceResult, CompareRequest, CompareResult, NicheReach,
                        SimulateRequest, SimulateResult, WhyRequest, WhyResult)


SIMULATION_SLOTS = 2  # concurrent simulations per agent (each runs ~100 parallel Claude calls for 1,000 twins)


@dataclass(frozen=True)
class Deps:
    simulate: Callable
    compare: Callable
    why: Callable
    audience: Callable
    lab: Callable | None = None  # (brand, draft_a, draft_b) -> (lab_experiment row, LabOutcome | None)
    allowed_senders: frozenset[str] | None = None  # None = anyone (dev); set it to the Orchestrator's address
    slots: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(SIMULATION_SLOTS))


def _request_error(deps: Deps, sender: str, brand: str) -> str | None:
    if deps.allowed_senders is not None and sender not in deps.allowed_senders:
        return "This agent only serves the Ripple Orchestrator; sender not allowed."
    return None if USERNAME_RE.fullmatch(brand.strip().lstrip("@")) else "Enter a valid X or Bluesky handle."


def _to_result(request_id: str, summary) -> SimulateResult:
    return SimulateResult(request_id=request_id, ok=True, **summary.model_dump())


async def handle_simulate(ctx, sender: str, msg: SimulateRequest, deps: Deps) -> None:
    if err := _request_error(deps, sender, msg.brand):
        await ctx.send(sender, SimulateResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        async with deps.slots:
            summary = await asyncio.to_thread(deps.simulate, msg.brand, msg.draft, msg.trials)
        await ctx.send(sender, _to_result(msg.request_id, summary))
    except Exception as exc:
        await ctx.send(sender, SimulateResult(request_id=msg.request_id, ok=False, error=str(exc)[:300],
                                              brand=msg.brand, draft=msg.draft))


async def handle_compare(ctx, sender: str, msg: CompareRequest, deps: Deps) -> None:
    if err := _request_error(deps, sender, msg.brand):
        await ctx.send(sender, CompareResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        async with deps.slots:
            summaries, winner = await asyncio.to_thread(deps.compare, msg.brand, msg.drafts)
        await ctx.send(sender, CompareResult(request_id=msg.request_id, ok=True, winner_index=winner,
                                             results=[_to_result(msg.request_id, s) for s in summaries]))
    except Exception as exc:
        await ctx.send(sender, CompareResult(request_id=msg.request_id, ok=False, error=str(exc)[:300]))


async def handle_why(ctx, sender: str, msg: WhyRequest, deps: Deps) -> None:
    if err := _request_error(deps, sender, msg.brand):
        await ctx.send(sender, WhyResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        fields = await asyncio.to_thread(deps.why, msg.brand, msg.handle, msg.draft)
        await ctx.send(sender, WhyResult(request_id=msg.request_id, ok=True, **fields))
    except Exception as exc:
        await ctx.send(sender, WhyResult(request_id=msg.request_id, ok=False, error=str(exc)[:300], handle=msg.handle))


async def handle_audience(ctx, sender: str, msg: AudienceRequest, deps: Deps) -> None:
    if err := _request_error(deps, sender, msg.brand):
        await ctx.send(sender, AudienceResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        fields = await asyncio.to_thread(deps.audience, msg.brand)
        await ctx.send(sender, AudienceResult(request_id=msg.request_id, ok=True, **fields))
    except Exception as exc:
        await ctx.send(sender, AudienceResult(request_id=msg.request_id, ok=False, error=str(exc)[:300]))


def _reach_summary(summary) -> str:
    """One line for the teammate's orchestrator: whole-number p50 counts and where engagement came from."""
    counts = {x.signal: x.p50 for x in summary.signals}
    parts = [f"{counts.get(k, 0):,} {label}" for k, label in
             (("like", "likes"), ("repost", "reposts"), ("reply", "replies"), ("quote", "quotes"))]
    line = f"Likely ~{', '.join(parts)}."
    if summary.outside_share > 0:
        line += f" {round(summary.outside_share * 100)}% of engagement comes from reposts beyond @{summary.brand}'s followers."
    return line


async def handle_orchestrator_simulate(ctx, sender: str, msg: OrchSimulateRequest, deps: Deps) -> None:
    """The teammate's Orchestrator (backend/ripple_agents) speaks its own SimulateRequest/SimulateResult."""
    brand = msg.brand.strip().lstrip("@").lower()
    if err := _request_error(deps, sender, brand):
        await ctx.send(sender, OrchSimulateResult(brand=msg.brand, error=err))
        return
    try:
        async with deps.slots:
            summary = await asyncio.to_thread(deps.simulate, brand, msg.draft, 200)
        views = summary.views
        await ctx.send(sender, OrchSimulateResult(brand=brand, reach_low=views.p10 if views else 0,
                                                  reach_high=views.p90 if views else 0, summary=_reach_summary(summary)))
    except Exception as exc:
        await ctx.send(sender, OrchSimulateResult(brand=brand, error=str(exc)[:300]))


async def handle_orchestrator_lab(ctx, sender: str, msg: OrchLabRequest, deps: Deps) -> None:
    """A vs B for the Orchestrator: a real Lab experiment, so the chat answer links to the live replay."""
    brand = msg.brand.strip().lstrip("@").lower()
    if err := _request_error(deps, sender, brand) or (None if deps.lab else "Lab is not configured"):
        await ctx.send(sender, OrchLabResult(brand=brand, error=err))
        return
    try:
        async with deps.slots:
            row, outcome = await asyncio.to_thread(deps.lab, brand, msg.draft_a, msg.draft_b)
        if row["status"] != "done":
            raise RuntimeError(row.get("error") or "the Lab experiment failed")
        await ctx.send(sender, OrchLabResult(
            brand=brand, experiment_id=str(row["experiment_id"]), winner=row["winner"], lift=row["lift"],
            summary_a=_reach_summary(outcome.run_a) if outcome else "",
            summary_b=_reach_summary(outcome.run_b) if outcome else ""))
    except Exception as exc:
        await ctx.send(sender, OrchLabResult(brand=brand, error=str(exc)[:300]))


def default_deps() -> Deps:
    stdb = StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())
    client = make_client(load_api_key())

    def why(brand: str, handle: str, draft: str) -> dict:
        _, twins = load_brand_twins(stdb, brand)
        wanted = handle.strip().lstrip("@").lower()
        match = next((t for t in twins if t.username.lower() == wanted), None)
        if match is None:
            raise ValueError(f"@{wanted} is not in @{brand}'s audience")
        answer = ask_twin(client, load_twin(stdb, match.user_id), draft)
        return {"handle": match.username, "name": match.name, "avatar": match.avatar,
                "profile_url": profile_url(match.user_id, match.username), "action": answer.action,
                "confidence": answer.confidence, "answer": answer.answer}

    def audience(brand: str) -> dict:
        _, twins = load_brand_twins(stdb, brand)
        labels = {n["slug"]: n["label"] for n in stdb.sql("SELECT * FROM niche")}
        counts = Counter(t.niches[0][0] if t.niches else "other" for t in twins)
        niches = [NicheReach(slug=s, label=labels.get(s, s), engaged_share=round(c / len(twins), 3), people=c)
                  for s, c in counts.most_common(7)]
        return {"brand": brand, "people": len(twins), "niches": niches}

    return Deps(simulate=lambda b, d, t: run_simulation(stdb, client, b, d, trials=t),
                compare=lambda b, ds: compare_drafts(stdb, client, b, ds),
                why=why, audience=audience, allowed_senders=allowed_senders(),
                lab=lambda b, a, bb: run_experiment(stdb, client, b, a, bb))
