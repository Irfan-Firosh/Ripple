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
    CampaignRequest,
    CampaignResult,
    EditRequest,
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
PROFILES = Path(__file__).with_name("profiles")
REACT_TIMEOUT_S = 600
AUDIENCE_TIMEOUT_S = 60
SIMULATE_TIMEOUT_S = 300
LAB_TIMEOUT_S = 600

HELP = "Build your audience → research the company → generate or import two drafts → test → approve for launch."
STARTER_PROMPTS = [
    "Open the Ripple menu",
    "Build an audience from an X handle",
    "I want to simulate a post",
    "I want to compare two posts",
    "Research my company and generate a campaign",
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
    if end_session:
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


async def _onboarding(ctx, sender, brand, *, start=False, retry=False, refresh=False):
    row = await asyncio.to_thread(onboarding_state, _stdb(), brand, start=start, retry=retry, refresh=refresh)
    _, state = _state(ctx, sender)
    pending = state.get("pending") or {}
    await ctx.send(sender, _text(render_onboarding(row), card=cards.onboarding(
        row, can_resume=pending.get("brand", "").lower() == brand.lower())))
    return row


def build_audience_agent(*, local=False) -> Agent:
    agent = Agent(name=AUDIENCE.name, seed=AUDIENCE.seed, mailbox=not local, avatar_url=AVATAR_URL,
                  readme_path=str(PROFILES / "audience.md"), publish_agent_details=not local,
                  description="Find people who care about your topic and hear how a modeled audience might respond to your post.")

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
    head = "A and B are tied" if lab.winner == "tie" else f"{lab.winner} wins · B vs A: {lab.lift:+.0%} modeled engagement"
    lines = ["", f"**Lab: every follower sees both** (Simulation agent): {head}"]
    lines += [f"- {label}: {text}" for label, text in (("A", lab.summary_a), ("B", lab.summary_b)) if text]
    lines.append(f"[Watch A vs B play out live]({lab_url(brand, lab.experiment_id)})")
    return lines


async def _reach_lines(ctx: Context, brand: str, drafts: list[str], campaign_id="") -> list[str]:
    if not SIMULATOR_ADDRESS:
        return []
    if len(drafts) == 2:  # A vs B: one joint Lab experiment the web Lab replays live
        lab, error = await _ask(ctx, SIMULATOR_ADDRESS, LabRequest(brand=brand, draft_a=drafts[0], draft_b=drafts[1], campaign_id=campaign_id),
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


async def _handle_request(ctx: Context, sender: str, text: str, payment_gate=None) -> None:
    state_key, state = _state(ctx, sender)
    awaiting, previous_brand = state.get("awaiting"), state.get("brand")
    selection = cards.selection(text)
    from .payments import handle as handle_payment
    if await handle_payment(ctx, sender, state_key, state, selection, text, payment_gate):
        return
    action = selection.get("action") if isinstance(selection, dict) else None
    if not isinstance(action, str):
        action = None
    named = _audience_handle(selection.get("brand")) if isinstance(selection, dict) else _named_brand(text)
    if named:
        if named.lower() != state.get("brand", "").lower():
            for field in ("awaiting", "last_action", "pending", "campaign_id", "variant_id", "persona_upgrade", "last_analysis"):
                state.pop(field, None)
        state["brand"] = named.strip().lstrip("@")
        _save_state(ctx, state_key, state)
    command = re.sub(r"@(?:ripple|(?:test-)?agent1[a-z0-9]+)\b", "", text, flags=re.I).strip()
    short = command.lower().strip(" .!\n")
    if short in {"show results", "show my results", "show interview results", "show the interview results", "interview results"}:
        saved = state.get("last_analysis")
        if saved:
            delivery = await ctx.send(sender, _text(saved["report"], end_session=True,
                card=MetadataContent(type="metadata", metadata=saved["card"])))
            ctx.logger.info(f"interview results replayed: {len(saved['report'])} characters; delivery={delivery}")
        else:
            await ctx.send(sender, _text("No saved interview results in this conversation yet. Test a post or both drafts first.",
                                         card=cards.menu(state.get("brand"))))
        return
    labels = {"build an x audience": "onboard_form", "test a post / compare two": "test_form",
              "test another post": "test_form", "test a post": "test_form", "simulate": "test_form",
              "simulate it": "test_form", "run simulation": "test_form", "i want to simulate a post": "test_form",
              "i want to compare two posts": "test_form", "explore an audience": "audience_form",
              "create campaign images": "campaign_form", "explore this audience": "audience",
              "generate campaign": "campaign_form", "research company": "discover_form",
              "test both drafts": "test_campaign", "make campaign videos": "video",
              "check campaign progress": "campaign_status", "edit a video": "edit_video_form",
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
    forms = {"onboard_form": "onboard", "test_form": "react", "audience_form": "audience", "campaign_form": "create",
             "discover_form": "discover", "edit_video_form": "edit_video", "edit_image_form": "edit_image"}
    if action in forms:
        if forms[action] in {"edit_video", "edit_image"}:
            if not state.get("campaign_id") or selection.get("campaign_id") != state["campaign_id"]:
                raise ValueError("Select a campaign in this conversation first")
            state["variant_id"] = selection.get("variant_id", "")
        state["awaiting"] = forms[action]
        _save_state(ctx, state_key, state)
        brand = "" if action == "onboard_form" else state.get("brand", "")
        ctx.logger.info(f"form: {forms[action]} @{brand or '(unset)'}")
        body = (f"Using **@{brand}**. " if brand else "Enter your audience handle. ")
        body += "Paste Post A (and optionally Post B) to simulate." if forms[action] == "react" else "Complete the form below."
        extra = {"campaign_id": state["campaign_id"]} if forms[action] in {"edit_video", "edit_image"} else {}
        await ctx.send(sender, _text(body, card=cards.form(forms[action], brand, **extra)))
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
                plan = await asyncio.to_thread(asi1.plan_campaign, asi1_api_key(), request)
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
        next_action = plan.action if plan.action in {"react", "audience", "create", "discover", "onboard"} else "onboard"
        await ctx.send(sender, _text("Which X audience should I use? Enter its handle below.", card=cards.form(next_action)))
        return
    ctx.logger.info(f"plan: {plan.action} @{plan.brand} niches={plan.niches} drafts={len(plan.variants)}")
    state.update(brand=plan.brand, last_action=plan.action)
    state.pop("awaiting", None)
    _save_state(ctx, state_key, state)
    if plan.action in {"onboard", "status", "retry"}:
        await _onboarding(ctx, sender, plan.brand, start=plan.action == "onboard", retry=plan.action == "retry", refresh=plan.refresh)
        return

    async def onboard_if_needed(error):
        if not needs_onboarding(error):
            return False
        state["pending"] = plan.model_dump()
        _save_state(ctx, state_key, state)
        await _onboarding(ctx, sender, plan.brand, start=True)
        return True

    async def campaign_request(action, *, timeout=REACT_TIMEOUT_S, **kwargs):
        return await _ask(ctx, CREATIVE_DIRECTOR.address,
                          CampaignRequest(action=action, brand=plan.brand, **kwargs), CampaignResult, timeout)

    if plan.action == "discover":
        await ctx.send(sender, _text(f"Researching @{plan.brand}'s recent launches and company posts…"))
        result, error = await campaign_request("discover")
        if error and await onboard_if_needed(error):
            return
        await ctx.send(sender, _text(f"Company research could not finish: {error}" if error else result.summary,
                                     card=cards.next_steps(plan.brand)))
        return
    if plan.action in {"campaign_status", "test_campaign", "video", "edit_video", "approve", "edit_image"}:
        cid = state.get("campaign_id", "")
        if not cid or (plan.campaign_id and plan.campaign_id != cid):
            await ctx.send(sender, _text("Generate a campaign or import two drafts in this conversation first.", card=cards.menu(plan.brand)))
            return
        if plan.action == "edit_image":
            vid = state.get("variant_id", "")
            if not vid or not plan.instruction.strip():
                await ctx.send(sender, _text("Choose Edit image on a campaign concept and describe the change.", card=cards.menu(plan.brand)))
                return
            result, error = await _ask(ctx, IMAGE_GEN.address,
                EditRequest(campaign_id=cid, parent_variant_id=vid, operation="edit", instruction=plan.instruction),
                VariantsResult, REACT_TIMEOUT_S)
            text = f"Image edit failed: {error}" if error else "Edited image: " + " ".join(result.image_urls)
            current, _ = await campaign_request("status", campaign_id=cid)
            await ctx.send(sender, _text(text, card=cards.campaign(current) if current else cards.next_steps(plan.brand)))
            return
        result, error = await campaign_request("status" if plan.action == "test_campaign" else
                                              "status" if plan.action == "campaign_status" else plan.action,
                                              campaign_id=cid, draft=plan.draft, instruction=plan.instruction)
        if error:
            await ctx.send(sender, _text(f"Couldn't continue the campaign: {error}", card=cards.next_steps(plan.brand)))
            return
        if plan.action != "test_campaign":
            await ctx.send(sender, _text(result.summary, card=cards.campaign(result)))
            return
        if len(result.drafts) != 2 or not all(result.drafts):
            await ctx.send(sender, _text("Both posts need to finish before testing.", card=cards.campaign(result)))
            return
        plan.action, plan.variants = "react", result.drafts
        plan.campaign_id = cid

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
        await ctx.send(sender, _text(f"Reading @{plan.brand}'s company news and audience, then creating {plan.n} image concepts and two posts in its voice…"))
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
        state["campaign_id"] = campaign_id
        state.pop("variant_id", None)
        _save_state(ctx, state_key, state)
        from .workflow import campaign_url
        current, error = await campaign_request("prepare", campaign_id=campaign_id)
        if error:
            reply = f"Campaign saved, but post writing could not finish: {error}."
            reply += "\n\n" + "\n".join(f"[Concept {i + 1}]({url})" for i, url in enumerate(links))
            reply += f"\n\n[Open campaign]({campaign_url(plan.brand, campaign_id)})"
            current, _ = await campaign_request("status", campaign_id=campaign_id)
        else:
            reply = current.summary + "\n\nTest both drafts, make videos, then approve the post you want to launch."
        if errors:
            reply += "\n\n" + "; ".join(errors)
        await ctx.send(sender, _text(reply, card=cards.campaign(current) if current else cards.next_steps(plan.brand)))
        return
    if plan.action != "react" or not plan.variants:
        await ctx.send(sender, _text("Paste a post or two to compare." if plan.action == "react" else HELP,
                                     card=cards.form("react", plan.brand) if plan.action == "react" else cards.menu(plan.brand)))
        if plan.action == "react":
            state["awaiting"] = "react"
            _save_state(ctx, state_key, state)
        return

    if len(plan.variants) == 2 and not plan.campaign_id:
        cid = "import-" + str(uuid4())
        current, error = await campaign_request("import", campaign_id=cid, drafts=plan.variants)
        if error:
            await ctx.send(sender, _text(f"Couldn't import the drafts: {error}", card=cards.form("react", plan.brand)))
            return
        plan.campaign_id = state["campaign_id"] = cid
        _save_state(ctx, state_key, state)

    progress = Loading(ctx, sender, plan.brand)
    await progress.update(0, f"Interviewing up to {min(20, plan.sample_size or 20)} most relevant personas…")
    final_report, final_card = "", None
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
        report = render_report(result) + "\n".join(await _reach_lines(ctx, plan.brand, plan.variants, plan.campaign_id))
        await progress.update(2, "Preparing your results…")
        try:
            report += "\n\n**Takeaway:** " + await asyncio.to_thread(asi1.takeaway, asi1_api_key(), report)
        except asi1.Asi1Error as exc:
            ctx.logger.warning(f"takeaway skipped: {exc}")
        report += f"\n\n[See @{plan.brand}'s audience]({dashboard_url(plan.brand)})"
        report += "\n\nSynthetic audience stress test; these results are estimates of how messaging may land."
        current = None
        if plan.campaign_id:
            try:
                current, _ = await campaign_request("status", campaign_id=plan.campaign_id, timeout=10)
            except Exception as exc:
                ctx.logger.warning(f"campaign actions unavailable: {type(exc).__name__}")
        from .payments import offer
        next_card = cards.campaign(current) if current else cards.next_steps(plan.brand)
        final_card = offer(ctx, sender, state_key, state, result.personas, next_card)
        state["last_analysis"] = {"report": report, "card": final_card.metadata}
        _save_state(ctx, state_key, state)
        final_report = report
        await progress.update(3, "Finished")
    finally:
        # ASI:One can finalize the response at EndStreamContent. Deliver results
        # and the checkout card before that marker, in the same terminal message.
        await progress.finish(final_report, final_card)
    ctx.logger.info(f"analysis finished @{plan.brand}")


def build_orchestrator(*, local=False) -> Agent:
    agent = Agent(name=ORCHESTRATOR.name, seed=ORCHESTRATOR.seed, mailbox=not local, readme_path=str(README),
                  handle=HANDLE or None, avatar_url=AVATAR_URL, handle_messages_concurrently=True, publish_agent_details=not local,
                  description="Tell me what you're thinking of posting. I'll explore your audience and test the idea with you in chat.")
    chat = Protocol(spec=chat_protocol_spec)
    from .payments import PersonaUpgradeGate
    payment_gate = PersonaUpgradeGate(str(agent.wallet.address()))

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
            await _handle_request(ctx, sender, text, payment_gate)
        except Exception as exc:  # the user must always get an answer
            ctx.logger.exception("request failed")
            await ctx.send(sender, _text(f"Something went wrong: {type(exc).__name__}: {exc}", end_session=True))

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(chat, publish_manifest=not local)
    agent.include(payment_gate.protocol, publish_manifest=not local)
    return agent
