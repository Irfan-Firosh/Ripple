"""The uAgents. Only the orchestrator faces ASI:One; specialists only take typed requests from it."""
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from twins.config import STDB_DATABASE, STDB_URL, load_api_key, load_stdb_token
from twins.llm import make_client
from twins.stdb import StdbClient

from . import asi1
from .audience import audience_profile, render_audience
from .config import (APP_URL, AUDIENCE, AVATAR_URL, CREATIVE_DIRECTOR, HANDLE, IMAGE_GEN, ORCHESTRATOR, SIMULATOR_ADDRESS,
                     asi1_api_key, dashboard_url, lab_url)
from .messages import (
    AudienceRequest,
    AudienceResult,
    BriefRequest,
    BriefResult,
    GenerateRequest,
    LabRequest,
    LabResult,
    VariantsResult,
    ReactRequest,
    ReactResult,
    SimulateRequest,
    SimulateResult,
)
from .onboard import needs_onboarding, onboarding_reply
from .reactions import react, render_report

README = Path(__file__).with_name("README.md")
REACT_TIMEOUT_S = 600
AUDIENCE_TIMEOUT_S = 60
SIMULATE_TIMEOUT_S = 300
LAB_TIMEOUT_S = 600

HELP = (
    "I'm Ripple: I predict how a brand's real social audience would react to a post before you publish it, using "
    "synthetic personas built from their followers' public posts.\n\n"
    "Try:\n"
    "- *How would @raycast.com's audience react to: \"Raycast AI now runs your extensions for you. Just ask.\"*\n"
    "- *Which is better for @raycast.com? A: \"…\" B: \"…\"*\n"
    "- *Who in @raycast.com's audience cares about developer tools?*"
    "\n- *Make 3 ads for @raycast.com's developer-tools audience about Raycast AI.*"
)
STARTER_PROMPTS = [
    "How would @raycast.com's audience react to: \"Raycast AI now runs your extensions for you. Just ask.\"",
    "Who in @raycast.com's audience cares about developer tools?",
    "Which post is better for @raycast.com? A: \"Raycast for Windows is here.\" B: \"Stop alt-tabbing. Raycast now on Windows.\"",
    "Make 3 ads for @raycast.com's developer-tools audience about Raycast AI.",
]


def _stdb() -> StdbClient:
    return StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(text: str, end_session: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end_session:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=content)


def build_audience_agent() -> Agent:
    agent = Agent(name=AUDIENCE.name, seed=AUDIENCE.seed, mailbox=True, avatar_url=AVATAR_URL,
                  description="Finds who in a brand's audience cares about a topic and asks their twins about drafts")

    @agent.on_message(AudienceRequest, replies=AudienceResult)
    async def on_audience(ctx: Context, sender: str, req: AudienceRequest):
        if sender != ORCHESTRATOR.address:
            return
        try:
            out = await asyncio.to_thread(audience_profile, _stdb(), req.brand, req.niches)
        except Exception as exc:
            out = AudienceResult(brand=req.brand, error=f"{type(exc).__name__}: {exc}")
        await ctx.send(sender, out)

    @agent.on_message(ReactRequest, replies=ReactResult)
    async def on_react(ctx: Context, sender: str, req: ReactRequest):
        if sender != ORCHESTRATOR.address:
            return
        ctx.logger.info(f"asking {req.sample_size} @{req.brand} twins about {len(req.drafts)} draft(s)")
        try:
            out = await asyncio.to_thread(react, _stdb(), make_client(load_api_key()), req.brand, req.drafts,
                                          req.niches, req.sample_size, req.question)
        except Exception as exc:
            out = ReactResult(brand=req.brand, error=f"{type(exc).__name__}: {exc}")
        await ctx.send(sender, out)

    return agent


async def _ask(ctx: Context, address: str, request, reply_type, timeout: int):
    """send_and_receive that turns silence and agent-side errors into a single error string."""
    result, status = await ctx.send_and_receive(address, request, reply_type, timeout=timeout)
    if not isinstance(result, reply_type):
        return None, f"no reply ({status.detail if status else 'unknown'})"
    return result, result.error


def render_lab(brand: str, lab: LabResult) -> list[str]:
    head = "A and B are tied" if lab.winner == "tie" else f"{lab.winner} wins, {lab.lift:+.0%} expected engagement"
    lines = ["", f"**Lab: every follower sees both** (Simulation agent): {head}"]
    lines += [f"- {label}: {text}" for label, text in (("A", lab.summary_a), ("B", lab.summary_b)) if text]
    lines.append(f"[Watch A vs B play out live]({lab_url(brand, lab.experiment_id)})")
    return lines


async def _reach_lines(ctx: Context, brand: str, drafts: list[str]) -> list[str]:
    if not SIMULATOR_ADDRESS:
        return []
    if len(drafts) == 2:  # A vs B: one joint Lab experiment the web Lab replays live
        lab, error = await _ask(ctx, SIMULATOR_ADDRESS, LabRequest(brand=brand, draft_a=drafts[0], draft_b=drafts[1]),
                                LabResult, LAB_TIMEOUT_S)
        return ["", f"**Lab** (Simulation agent): unavailable ({error})"] if error else render_lab(brand, lab)
    lines = ["", "**Projected reach** (Simulation agent):"]
    for i, draft in enumerate(drafts):
        sim, error = await _ask(ctx, SIMULATOR_ADDRESS, SimulateRequest(brand=brand, draft=draft),
                                SimulateResult, SIMULATE_TIMEOUT_S)
        label = chr(ord("A") + i)
        lines.append(f"- {label}: unavailable ({error})" if error else
                     f"- {label}: {sim.reach_low:,}–{sim.reach_high:,} accounts. {sim.summary}".rstrip())
    return lines


async def _handle_request(ctx: Context, sender: str, text: str) -> None:
    key = asi1_api_key()
    try:
        plan = await asyncio.to_thread(asi1.plan_campaign, key, text)
    except asi1.Asi1Error as exc:
        await ctx.send(sender, _text(f"Sorry, I couldn't parse that ({exc}).\n\n{HELP}", end_session=True))
        return
    ctx.logger.info(f"plan: {plan.action} @{plan.brand} niches={plan.niches} drafts={len(plan.variants)}")

    if plan.action == "audience":
        result, error = await _ask(ctx, AUDIENCE.address, AudienceRequest(brand=plan.brand, niches=plan.niches),
                                   AudienceResult, AUDIENCE_TIMEOUT_S)
        if error and needs_onboarding(error):
            reply = await asyncio.to_thread(onboarding_reply, _stdb(), plan.brand)
        else:
            reply = f"Couldn't read @{plan.brand}'s audience: {error}" if error else render_audience(result, plan.niches)
        await ctx.send(sender, _text(reply, end_session=True))
        return
    if plan.action == "create":
        if not plan.goal.strip():
            await ctx.send(sender, _text("Add a goal for the campaign, such as introducing Raycast AI to tool builders.", end_session=True))
            return
        campaign_id = str(uuid4())
        await ctx.send(sender, _text(f"The creative director is briefing @{plan.brand}'s audience. Then Grok Imagine will create {plan.n} distinct ads per segment…"))
        briefs, error = await _ask(ctx, CREATIVE_DIRECTOR.address,
                                  BriefRequest(brand=plan.brand, campaign_id=campaign_id, goal=plan.goal,
                                               segments=plan.niches, offer=plan.offer, n=plan.n, aspect_ratio=plan.aspect_ratio),
                                  BriefResult, REACT_TIMEOUT_S)
        if error:
            reply = (await asyncio.to_thread(onboarding_reply, _stdb(), plan.brand) if needs_onboarding(error)
                     else f"Couldn't create campaign briefs: {error}")
            await ctx.send(sender, _text(reply, end_session=True))
            return
        links = []
        errors = []
        for brief_id in briefs.brief_ids:
            variants, error = await _ask(ctx, IMAGE_GEN.address,
                                        GenerateRequest(campaign_id=campaign_id, brief_id=brief_id,
                                                        n=plan.n, aspect_ratio=plan.aspect_ratio),
                                        VariantsResult, REACT_TIMEOUT_S)
            if error:
                errors.append(error)
            else:
                links.extend(variants.image_urls)
                errors.extend(variants.warnings)
        reply = f"**Campaign for @{plan.brand}** · {len(links)} AI-generated creatives\n\n" + "\n".join(
            f"- [Take {index + 1}]({url})" for index, url in enumerate(links))
        reply += "\n\nSynthetic audience personas. These image links are for review. Use the campaign studio to create, refine and approve a campaign in your browser before simulation."
        if errors:
            reply += "\n\nSome segments could not finish: " + "; ".join(errors)
        reply += f"\n\n[Open campaign studio]({APP_URL}/campaigns)"
        await ctx.send(sender, _text(reply, end_session=True))
        return
    if plan.action != "react" or not plan.variants:
        await ctx.send(sender, _text(HELP, end_session=True))
        return

    await ctx.send(sender, _text(f"Asking the {plan.sample_size} most relevant personas in @{plan.brand}'s audience "
                                 f"about {len(plan.variants)} draft(s). This takes about a minute…"))
    result, error = await _ask(ctx, AUDIENCE.address,
                               ReactRequest(brand=plan.brand, drafts=plan.variants, niches=plan.niches,
                                            sample_size=plan.sample_size, question=plan.question),
                               ReactResult, REACT_TIMEOUT_S)
    if error:
        reply = (await asyncio.to_thread(onboarding_reply, _stdb(), plan.brand) if needs_onboarding(error)
                 else f"Couldn't get reactions from @{plan.brand}'s audience: {error}")
        await ctx.send(sender, _text(reply, end_session=True))
        return
    report = render_report(result) + "\n".join(await _reach_lines(ctx, plan.brand, plan.variants))
    try:
        report += "\n\n**Takeaway:** " + await asyncio.to_thread(asi1.takeaway, key, report)
    except asi1.Asi1Error as exc:
        ctx.logger.warning(f"takeaway skipped: {exc}")
    report += f"\n\n[See @{plan.brand}'s audience]({dashboard_url(plan.brand)})"
    await ctx.send(sender, _text(report, end_session=True))


def build_orchestrator() -> Agent:
    agent = Agent(name=ORCHESTRATOR.name, seed=ORCHESTRATOR.seed, mailbox=True, readme_path=str(README),
                  handle=HANDLE or None, avatar_url=AVATAR_URL, handle_messages_concurrently=True, publish_agent_details=True,
                  description="Predict how a brand's real social audience would react to a post before you publish it.")
    chat = Protocol(spec=chat_protocol_spec)

    @chat.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
        ctx.logger.info(f"chat message from {sender}")
        await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))
        text = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
        if not text:
            return
        try:
            await _handle_request(ctx, sender, text)
        except Exception as exc:  # the user must always get an answer
            ctx.logger.exception("request failed")
            await ctx.send(sender, _text(f"Something went wrong: {type(exc).__name__}: {exc}", end_session=True))

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(chat, publish_manifest=True)
    return agent
