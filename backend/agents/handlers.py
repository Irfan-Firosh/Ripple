"""Pure async handlers for the Audience and Simulation agents. The uAgent files only wire these up."""
import asyncio
from collections import Counter
from dataclasses import dataclass
from typing import Callable

from twins.ask import ask_twin
from twins.brand_twins import load_brand_twins
from twins.config import STDB_DATABASE, STDB_URL, load_api_key, load_stdb_token
from twins.llm import make_client
from twins.simulate import compare_drafts, profile_url, run_simulation
from twins.stdb import StdbClient
from twins.sync import load_twin

from .contracts import (BRANDS, AudienceRequest, AudienceResult, CompareRequest, CompareResult, NicheReach,
                        SimulateRequest, SimulateResult, WhyRequest, WhyResult)


@dataclass(frozen=True)
class Deps:
    simulate: Callable
    compare: Callable
    why: Callable
    audience: Callable


def _brand_error(brand: str) -> str | None:
    return None if brand in BRANDS else f"Unknown brand '{brand}'. Available: {', '.join(BRANDS)}"


def _to_result(request_id: str, summary) -> SimulateResult:
    return SimulateResult(request_id=request_id, ok=True, **summary.model_dump())


async def handle_simulate(ctx, sender: str, msg: SimulateRequest, deps: Deps) -> None:
    if err := _brand_error(msg.brand):
        await ctx.send(sender, SimulateResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        summary = await asyncio.to_thread(deps.simulate, msg.brand, msg.draft, msg.trials)
        await ctx.send(sender, _to_result(msg.request_id, summary))
    except Exception as exc:
        await ctx.send(sender, SimulateResult(request_id=msg.request_id, ok=False, error=str(exc)[:300],
                                              brand=msg.brand, draft=msg.draft))


async def handle_compare(ctx, sender: str, msg: CompareRequest, deps: Deps) -> None:
    if err := _brand_error(msg.brand):
        await ctx.send(sender, CompareResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        summaries, winner = await asyncio.to_thread(deps.compare, msg.brand, msg.drafts)
        await ctx.send(sender, CompareResult(request_id=msg.request_id, ok=True, winner_index=winner,
                                             results=[_to_result(msg.request_id, s) for s in summaries]))
    except Exception as exc:
        await ctx.send(sender, CompareResult(request_id=msg.request_id, ok=False, error=str(exc)[:300]))


async def handle_why(ctx, sender: str, msg: WhyRequest, deps: Deps) -> None:
    if err := _brand_error(msg.brand):
        await ctx.send(sender, WhyResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        fields = await asyncio.to_thread(deps.why, msg.brand, msg.handle, msg.draft)
        await ctx.send(sender, WhyResult(request_id=msg.request_id, ok=True, **fields))
    except Exception as exc:
        await ctx.send(sender, WhyResult(request_id=msg.request_id, ok=False, error=str(exc)[:300], handle=msg.handle))


async def handle_audience(ctx, sender: str, msg: AudienceRequest, deps: Deps) -> None:
    if err := _brand_error(msg.brand):
        await ctx.send(sender, AudienceResult(request_id=msg.request_id, ok=False, error=err))
        return
    try:
        fields = await asyncio.to_thread(deps.audience, msg.brand)
        await ctx.send(sender, AudienceResult(request_id=msg.request_id, ok=True, **fields))
    except Exception as exc:
        await ctx.send(sender, AudienceResult(request_id=msg.request_id, ok=False, error=str(exc)[:300]))


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
                why=why, audience=audience)
