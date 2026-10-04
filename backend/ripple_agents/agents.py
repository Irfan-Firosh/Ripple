"""The uAgents. Only the orchestrator faces ASI:One; specialists only take typed requests from it."""
import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    MetadataContent,
    chat_protocol_spec,
)

from twins.config import STDB_DATABASE, STDB_URL, load_api_key, load_stdb_token
from twins.llm import make_client
from twins.stdb import StdbClient, sql_str

from . import asi1, cards
from .loading import Loading
from .audience import audience_profile, brand_twins, render_audience
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
from .onboard import needs_onboarding, onboarding_state, render_onboarding
from .reactions import react, render_report

README = Path(__file__).with_name("README.md")
REACT_TIMEOUT_S = 600
AUDIENCE_TIMEOUT_S = 60
SIMULATE_TIMEOUT_S = 300
LAB_TIMEOUT_S = 600

HELP = "Choose an audience, explore its followers, create campaign content, or simulate a post before publishing."
STARTER_PROMPTS = [
    "Open the Ripple menu",
    "Build an audience from an X handle",
    "I want to simulate a post",
    "I want to compare two posts",
    "Create campaign images",
]


def _named_brand(text):
    # Mentions inside quoted post copy are not the audience handle.
    header = re.split(r'["“]', text, maxsplit=1)[0]
    for match in re.finditer(r"(?<!\w)@([A-Za-z0-9_][A-Za-z0-9_.-]*)", header):
        handle = match.group(1).rstrip(".")
        if _audience_handle(handle):
            return handle
    return ""


def _audience_handle(value):
    handle = value.strip().lstrip("@").rstrip(".") if isinstance(value, str) else ""
    if handle.lower() in {"ripple", (HANDLE or "ripple").lower()} or re.match(r"(?:test-)?agent1|fetch1", handle, re.I):
        return ""
    return handle if re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,252}", handle) and ("." in handle or len(handle) <= 15) else ""


def _help(brand):
    if brand:
        return (f"Current audience: **@{brand}**.\n\nTo simulate, send:\n"
                f"Simulate @{brand} on X: \"paste your post here\"\n\n"
                "Or choose Test a post / compare two below.")
    return HELP + "\n\nEnter an X handle to get started."


def _stdb() -> StdbClient:
    return StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(text: str, end_session: bool = False, card: MetadataContent | None = None) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if card:
        content.append(card)
    if end_session and not card:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=content)


def _state(ctx, sender):
    key = f"ripple-chat:{sender}:{getattr(ctx, 'session', 'local')}"
    storage = getattr(ctx, "storage", None)
    state = (storage.get(key) if storage else getattr(ctx, "_ripple_state", None)) or {}
    state["brand"] = _audience_handle(state.get("brand")) or _audience_handle(state.get("last_valid_brand"))
    return key, state


def _save_state(ctx, key, state):
    state["brand"] = _audience_handle(state.get("brand"))
    if state["brand"]:
        state["last_valid_brand"] = state["brand"]
    storage = getattr(ctx, "storage", None)
    if storage:
        storage.set(key, state)
    else:
        ctx._ripple_state = state


async def _onboarding(ctx, sender, brand, *, start=False, retry=False):
    row = await asyncio.to_thread(onboarding_state, _stdb(), brand, start=start, retry=retry)
    _, state = _state(ctx, sender)
    pending = state.get("pending") or {}
    await ctx.send(sender, _text(render_onboarding(row), card=cards.onboarding(
        row, can_resume=pending.get("brand", "").lower() == brand.lower())))
    return row


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
        try:
            db = _stdb()
            total = await asyncio.to_thread(lambda: len(brand_twins(db, req.brand)))
            sample = min(total, 20, req.sample_size if req.sample_size > 0 else 20)
            ctx.logger.info(f"interviewing {sample}/{total} @{req.brand} personas; cascade simulation uses all built personas")
            out = await asyncio.to_thread(react, db, make_client(load_api_key()), req.brand, req.drafts,
                                          req.niches, sample, req.question)
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
    state_key, state = _state(ctx, sender)
    awaiting, previous_brand = state.get("awaiting"), state.get("brand")
    selection = cards.selection(text)
    action = selection.get("action") if isinstance(selection, dict) else None
    if not isinstance(action, str):
        action = None
    named = _audience_handle(selection.get("brand")) if isinstance(selection, dict) else _named_brand(text)
    if named:
        if named.lower() != state.get("brand", "").lower():
            for field in ("awaiting", "last_action", "pending"):
                state.pop(field, None)
        state["brand"] = named.strip().lstrip("@")
        _save_state(ctx, state_key, state)
    command = re.sub(r"@(?:ripple|(?:test-)?agent1[a-z0-9]+)\b", "", text, flags=re.I).strip()
    short = command.lower().strip(" .!\n")
    labels = {"build an x audience": "onboard_form", "test a post / compare two": "test_form",
              "test another post": "test_form", "test a post": "test_form", "simulate": "test_form",
              "simulate it": "test_form", "run simulation": "test_form", "i want to simulate a post": "test_form",
              "i want to compare two posts": "test_form", "explore an audience": "audience_form",
              "create campaign images": "campaign_form", "explore this audience": "audience",
              "back to menu": "menu", "check progress": "status", "continue my request": "resume",
              "retry build": "retry", "test another post / compare two": "test_form"}
    action = action or labels.get(short)
    if not action:
        # ASI may deliver a button click as prose rather than its JSON selection.
        for label in ("create campaign images", "test a post / compare two", "explore an audience", "build an x audience"):
            if label in short and (re.search(r"\b(?:selected|clicked|selection|campaign_form|test_form)\b", short)
                                   or short.strip('"\'') == label):
                action = labels[label]
                break
    if action == "menu" or short in {"menu", "help", "hi", "hello", "start", "open the ripple menu"}:
        state.pop("awaiting", None)
        _save_state(ctx, state_key, state)
        await ctx.send(sender, _text(_help(state.get("brand")), card=cards.menu(state.get("brand"))))
        return
    forms = {"onboard_form": "onboard", "test_form": "react", "audience_form": "audience", "campaign_form": "create"}
    if action in forms:
        state["awaiting"] = forms[action]
        _save_state(ctx, state_key, state)
        brand = "" if action == "onboard_form" else state.get("brand", "")
        ctx.logger.info(f"form: {forms[action]} @{brand or '(unset)'}")
        body = (f"Using **@{brand}**. " if brand else "Enter your audience handle. ")
        body += "Paste Post A (and optionally Post B) to simulate." if forms[action] == "react" else "Complete the form below."
        await ctx.send(sender, _text(body, card=cards.form(forms[action], brand)))
        return
    if action == "resume":
        pending = state.get("pending")
        if not pending or pending["brand"].lower() != (named or state.get("brand", "")).lower():
            await ctx.send(sender, _text("No saved request for this audience. Choose what to do next.", card=cards.menu()))
            return
        row = await asyncio.to_thread(onboarding_state, _stdb(), pending["brand"])
        if row["status"] != "ready":
            await _onboarding(ctx, sender, pending["brand"])
            return
        plan = asi1.CampaignPlan.model_validate(state.pop("pending"))
        _save_state(ctx, state_key, state)
    else:
        plan = cards.submission(text) if selection else None
        if plan is None and action in {"audience", "status", "retry"}:
            plan = asi1.CampaignPlan(action=action, brand=state.get("brand", ""))
    if plan is None and awaiting and _audience_handle(command) and (not previous_brand or awaiting == "onboard" or command.startswith("@")):
        plan = asi1.CampaignPlan(action=awaiting, brand=_audience_handle(command))
    if plan is None:
        plan = asi1.direct_request(command, state.get("brand", ""), awaiting=state.get("awaiting", ""))
    key = asi1_api_key()
    try:
        if plan is None:
            request = text + (f"\nSaved audience handle for follow-ups: {state['brand']}" if state.get("brand") else "")
            if (state.get("awaiting") == "react" and state.get("brand") and not named
                    and not re.match(r"(?:how|help|menu|create|generate|make|build|status|retry|check)\b", short)):
                plan = asi1.CampaignPlan(action="react", brand=state["brand"], variants=[text])
            elif ((state.get("last_action") == "audience" or state.get("awaiting") == "audience") and state.get("brand") and len(text.split()) <= 6
                  and not named and not re.match(r"(?:simulate|test|compare|create|generate|make|build|onboard|status|retry|menu|help|check|analy[sz]e|explore)\b", short)):
                plan = asi1.CampaignPlan(action="audience", brand=state["brand"], niches=asi1.topic_niches(text))
            if plan is None:
                plan = await asyncio.to_thread(asi1.plan_campaign, key, request)
    except asi1.Asi1Error as exc:
        ctx.logger.warning(f"request planner unavailable: {exc}")
        await ctx.send(sender, _text("The request parser is temporarily unavailable. Choose an action below to continue.",
                                     card=cards.menu(state.get("brand"))))
        return
    plan.brand = _audience_handle(plan.brand)
    if named:
        plan.brand = state["brand"]
    elif state.get("brand") and (not plan.brand or not re.search(r"(?<!\w)" + re.escape(plan.brand) + r"(?!\w)", text, re.I)):
        plan.brand = state["brand"]
    elif plan.brand and not re.search(r"(?<!\w)" + re.escape(plan.brand) + r"(?!\w)", text, re.I):
        plan.brand = ""
    if plan.action == "help":
        await ctx.send(sender, _text(_help(state.get("brand")), card=cards.menu(state.get("brand"))))
        return
    if not plan.brand:
        next_action = plan.action if plan.action in {"react", "audience", "create", "onboard"} else "onboard"
        await ctx.send(sender, _text("Which X audience should I use? Enter its handle below.", card=cards.form(next_action)))
        return
    ctx.logger.info(f"plan: {plan.action} @{plan.brand} niches={plan.niches} drafts={len(plan.variants)}")
    state.update(brand=plan.brand, last_action=plan.action)
    state.pop("awaiting", None)
    _save_state(ctx, state_key, state)
    if plan.action in {"onboard", "status", "retry"}:
        await _onboarding(ctx, sender, plan.brand, start=plan.action == "onboard", retry=plan.action == "retry")
        return

    async def onboard_if_needed(error):
        if not needs_onboarding(error):
            return False
        state["pending"] = plan.model_dump()
        _save_state(ctx, state_key, state)
        await _onboarding(ctx, sender, plan.brand, start=True)
        return True

    if plan.action == "audience":
        result, error = await _ask(ctx, AUDIENCE.address, AudienceRequest(brand=plan.brand, niches=plan.niches),
                                   AudienceResult, AUDIENCE_TIMEOUT_S)
        if error and await onboard_if_needed(error):
            return
        reply = f"Couldn't read @{plan.brand}'s audience: {error}" if error else render_audience(result, plan.niches)
        await ctx.send(sender, _text(reply, card=cards.next_steps(plan.brand)))
        return
    if plan.action == "create":
        if not plan.goal.strip():
            state["awaiting"] = "create"
            _save_state(ctx, state_key, state)
            await ctx.send(sender, _text(f"What would you like to promote for @{plan.brand}?", card=cards.form("create", plan.brand)))
            return
        _, error = await _ask(ctx, AUDIENCE.address, AudienceRequest(brand=plan.brand), AudienceResult, AUDIENCE_TIMEOUT_S)
        if error:
            if await onboard_if_needed(error):
                return
            await ctx.send(sender, _text(f"Couldn't read this audience: {error}", card=cards.menu()))
            return
        campaign_id = str(uuid4())
        await ctx.send(sender, _text(f"The creative director is briefing @{plan.brand}'s audience. Then Grok Imagine will create {plan.n} distinct ads per segment…"))
        briefs, error = await _ask(ctx, CREATIVE_DIRECTOR.address,
                                  BriefRequest(brand=plan.brand, campaign_id=campaign_id, goal=plan.goal,
                                               segments=plan.niches, offer=plan.offer, n=plan.n, aspect_ratio=plan.aspect_ratio),
                                  BriefResult, REACT_TIMEOUT_S)
        if error:
            if await onboard_if_needed(error):
                return
            await ctx.send(sender, _text(f"Couldn't create campaign briefs: {error}", card=cards.menu()))
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
        reply += "\n\nChoose a concept to test its generated post copy. Images stay attached for review; predictions model the post copy."
        if errors:
            reply += "\n\nSome segments could not finish: " + "; ".join(errors)
        reply += f"\n\n[Open campaign studio]({APP_URL}/campaigns?brand={plan.brand}&campaign={campaign_id})"
        result_card = cards.next_steps(plan.brand)
        if links:
            try:
                rows = await asyncio.to_thread(lambda: _stdb().sql(
                    f"SELECT variant_id, headline, cta, image_url FROM ad_variant WHERE campaign_id = {sql_str(campaign_id)}"))
                rows = [r for r in rows if r.get("image_url") in links]
                if rows:
                    result_card = cards.creatives(plan.brand, rows)
            except Exception as exc:
                ctx.logger.warning(f"creative cards skipped: {type(exc).__name__}")
        await ctx.send(sender, _text(reply, card=result_card))
        return
    if plan.action != "react" or not plan.variants:
        await ctx.send(sender, _text("Paste a post or two to compare." if plan.action == "react" else HELP,
                                     card=cards.form("react", plan.brand) if plan.action == "react" else cards.menu(plan.brand)))
        if plan.action == "react":
            state["awaiting"] = "react"
            _save_state(ctx, state_key, state)
        return

    progress = Loading(ctx, sender, plan.brand)
    await progress.update(0, f"Interviewing up to {min(20, plan.sample_size or 20)} most relevant personas…")
    try:
        result, error = await _ask(ctx, AUDIENCE.address,
                                   ReactRequest(brand=plan.brand, drafts=plan.variants, niches=plan.niches,
                                                sample_size=min(20, plan.sample_size or 20), question=plan.question),
                                   ReactResult, REACT_TIMEOUT_S)
        if error:
            if await onboard_if_needed(error):
                return
            await ctx.send(sender, _text(f"Couldn't get reactions from @{plan.brand}'s audience: {error}", card=cards.menu(plan.brand)))
            return
        await progress.update(1, f"Interviewed {result.personas} personas. Simulating the full built audience…")
        report = render_report(result) + "\n".join(await _reach_lines(ctx, plan.brand, plan.variants))
        await progress.update(2, "Preparing your results…")
        try:
            report += "\n\n**Takeaway:** " + await asyncio.to_thread(asi1.takeaway, key, report)
        except asi1.Asi1Error as exc:
            ctx.logger.warning(f"takeaway skipped: {exc}")
        await progress.update(3, "Finished")
    finally:
        await progress.finish()
    report += f"\n\n[See @{plan.brand}'s audience]({dashboard_url(plan.brand)})"
    await ctx.send(sender, _text(report, card=cards.next_steps(plan.brand)))
    ctx.logger.info(f"analysis finished @{plan.brand}")


def build_orchestrator() -> Agent:
    agent = Agent(name=ORCHESTRATOR.name, seed=ORCHESTRATOR.seed, mailbox=True, readme_path=str(README),
                  handle=HANDLE or None, avatar_url=AVATAR_URL, handle_messages_concurrently=True, publish_agent_details=True,
                  description="Predict how a brand's real social audience would react to a post before you publish it.")
    chat = Protocol(spec=chat_protocol_spec)

    @chat.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
        ctx.logger.info(f"chat message from {sender}")
        await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))
        seen_key = f"ripple-seen:{sender}:{ctx.session}"
        seen = ctx.storage.get(seen_key) or []
        if str(msg.msg_id) in seen:
            return
        ctx.storage.set(seen_key, (seen + [str(msg.msg_id)])[-100:])
        if any(isinstance(c, StartSessionContent) for c in msg.content):
            state_key, _ = _state(ctx, sender)
            _save_state(ctx, state_key, {})
        text = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
        for c in msg.content:
            if isinstance(c, MetadataContent):
                raw = c.metadata.get("selection") or c.metadata.get("card_selection")
                if raw:
                    text = raw
                    break
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
