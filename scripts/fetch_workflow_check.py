"""Rehearse current Fetch workflow with real providers, before publishing to Agentverse.

PYTHONPATH=backend backend/.venv/bin/python scripts/fetch_workflow_check.py
Add --mailbox after deployment to verify the same workflow through Agentverse.
Add --videos for two real rendered videos and a video edit (takes several minutes).
Evidence: /tmp/ripple-fetch-workflow.json. This creates real campaigns and makes paid provider calls.
"""
import argparse
import asyncio
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from uagents import Agent, Bureau, Model, Protocol
from uagents.communication import send_exchange_envelope
from uagents_core.config import AgentverseConfig
from uagents_core.envelope import Envelope
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, MetadataContent, StartSessionContent, TextContent, chat_protocol_spec
from uagents_core.contrib.protocols.chat.cards import validate_card_payload_json

from ripple_agents.__main__ import LocalRegistration
from ripple_agents.agents import _stdb, build_audience_agent, build_orchestrator
from ripple_agents.config import ORCHESTRATOR
from ripple_agents.creative import build_creative_director, build_image_gen
from ripple_agents.simulation import build_simulator
from fetch_demo_check import selections


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mailbox", action="store_true")
    ap.add_argument("--videos", action="store_true")
    ap.add_argument("--brand", default="supermemory")
    ap.add_argument("--resume", help="Resume a saved local rehearsal campaign after fixing a later stage")
    args = ap.parse_args()
    if args.resume and args.mailbox:
        ap.error("--resume is only for isolated local rehearsals")
    brand = args.brand.lstrip("@").lower()
    port = 8191 if args.mailbox else 8190
    endpoint = f"http://127.0.0.1:{port}/submit"
    artifact = Path("/tmp/ripple-fetch-workflow-mailbox.json" if args.mailbox else "/tmp/ripple-fetch-workflow.json")
    probe = Agent(name="ripple-workflow-check", seed=ORCHESTRATOR.seed + ":workflow-check:" + str(uuid4()),
                  port=port, endpoint=[endpoint], enable_agent_inspector=False, publish_agent_details=False)
    chat = Protocol(spec=chat_protocol_spec)
    session, step, started = uuid4(), 0, time.monotonic()
    events = [e for e in json.loads(artifact.read_text()) if e["kind"] != "complete"] if args.resume and artifact.exists() else []
    replies, seen = [], set()
    saved_cid, saved_buttons, winning, video_task = args.resume or "", {}, "A", None

    def record(kind, **data):
        events.append(dict(kind=kind, step=step, seconds=round(time.monotonic() - started, 1), **data))
        artifact.write_text(json.dumps(events, indent=2, default=str))
        print(json.dumps(dict(kind=kind, step=step, **{k: v for k, v in data.items() if k != "content"}), default=str), flush=True)

    def done(ok, reason):
        record("complete", passed=ok, reason=reason)
        os._exit(0 if ok else 1)

    async def send(request, *, fresh=False):
        nonlocal replies, session
        replies = []
        if fresh:
            session = uuid4()
        content = [StartSessionContent(type="start-session")] if fresh else []
        if isinstance(request, dict):
            content += [TextContent(type="text", text="Continue"), MetadataContent(type="metadata", metadata={"card_selection": json.dumps(request)})]
        else:
            content += [TextContent(type="text", text=request)]
        msg = ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content)
        env = Envelope(version=1, sender=probe.address, target=ORCHESTRATOR.address, session=session,
                       schema_digest=Model.build_schema_digest(ChatMessage), expires=int(time.time()) + 1800)
        env.encode_payload(msg.model_dump_json())
        env.sign(probe._identity)
        record("request", request=request)
        status = await send_exchange_envelope(env, [AgentverseConfig().mailbox_endpoint if args.mailbox else endpoint])
        if "DELIVERED" not in str(status.status):
            done(False, f"ACP delivery failed: {status.detail}")

    async def render_videos():
        from video.pipeline import make_video
        from video.sync import run_pending_videos
        await asyncio.to_thread(run_pending_videos, _stdb(), maker=make_video, campaign_id=saved_cid)

    @chat.on_message(ChatAcknowledgement)
    async def ack(ctx, sender, msg):
        pass

    @chat.on_message(ChatMessage)
    async def reply(ctx, sender, msg):
        nonlocal step, saved_cid, saved_buttons, winning, video_task
        if sender != ORCHESTRATOR.address or str(msg.msg_id) in seen:
            return
        seen.add(str(msg.msg_id))
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        replies.extend(c.model_dump() for c in msg.content)
        record("reply", content=[c.model_dump() for c in msg.content])
        terminal = next((c for c in msg.content if isinstance(c, MetadataContent) and c.metadata.get("card_kind")
                         and c.metadata.get("requires_card_interaction") != "false"), None)
        if any(c.type == "end-session" for c in msg.content) and terminal is None:
            done(False, "Unexpected agent error")
        if not terminal:
            return
        try:
            validate_card_payload_json(terminal.metadata["card_kind"], terminal.metadata["card_payload"])
            payload = json.loads(terminal.metadata["card_payload"])
            buttons = dict(selections(payload))
            text = "\n".join(c["text"] for c in replies if c["type"] == "text")
            record("result", text=text, buttons=list(buttons))
            assert "couldn't" not in text.lower() and "could not finish" not in text.lower(), text
            if step == 0:
                assert "Current audience" not in text
                step = 1
                await send(f"Build an X audience for @{brand}")
            elif step == 1:
                assert "audience is ready" in text, "Use a ready demo brand for this rehearsal: " + text
                step = 2
                await send(f"Research @{brand}")
            elif step == 2:
                assert "company research" in text and ("Company website" in text or "Recent brand post" in text), text
                step = 3
                await send(f"What are the main interests in @{brand}'s audience?")
            elif step == 3:
                assert "personas" in text, text
                step = 4
                await send(f"Generate a campaign for @{brand} promoting its product using recent company facts. Offer: Explore {brand}.")
            elif step == 4:
                assert "Test both drafts" in buttons, text
                assert "**A:**" in text and "**B:**" in text and "Open campaign" in text, text
                saved_cid = buttons["Test both drafts"]["campaign_id"]
                assert buttons["Edit image A"]["variant_id"] != buttons["Edit image B"]["variant_id"]
                record("generated_campaign", campaign_id=saved_cid)
                step = 5
                await send(buttons["Test both drafts"])
            elif step == 5:
                assert "**Lab:" in text and "unavailable" not in text.lower(), text
                match = re.search(r"\): ([AB]) wins", text)
                winning = match.group(1) if match else "A"
                saved_buttons = buttons
                step = 6
                await send(buttons[f"Approve {winning}"])
            elif step == 6:
                assert "Approved post" in text and "Open X composer" in text, text
                step = 7
                await send(saved_buttons["Make campaign videos"] if args.videos else saved_buttons["Edit image A"])
            elif step == 7 and args.videos:
                assert "video:" in text or " video]" in text, text
                saved_buttons = buttons
                video_task = asyncio.create_task(render_videos())
                step = 8
            elif step == 8:
                assert not re.search(r"Draft [AB] video: failed", text), text
                if "Draft A video]" not in text or "Draft B video]" not in text:
                    return  # Another worker may own a still-running render; saved state decides readiness.
                record("videos_completed", campaign_id=saved_cid)
                step = 9
                await send(buttons["Edit a video"])
            elif step == 9:
                step = 10
                await send({"selection": buttons["Continue"], "brand": "", "draft": "A", "instruction": "Make the opening on-screen title larger. Keep the facts and voiceover the same."})
            elif step == 10:
                video_task = asyncio.create_task(render_videos())
                step = 11
            elif step == 11:
                assert not re.search(r"Draft [AB] video: failed", text), text
                if "Draft A video]" not in text or "Draft B video]" not in text:
                    return
                record("video_edit_completed", campaign_id=saved_cid)
                step = 12
                await send(buttons["Edit image A"])
            elif step in (7, 12):
                step = 13
                await send({"selection": buttons["Continue"], "brand": "", "instruction": "Use a cleaner composition with more whitespace. Keep the same copy and brand colors."})
            elif step == 13:
                assert "Edited image:" in text, text
                record("image_edit_completed", campaign_id=saved_cid)
                step = 14
                await send({"action": "react", "brand": brand,
                            "draft_a": "STOP SCROLLING. This product will literally change your life. You'd be stupid not to buy it. #AI #Disruption #Viral",
                            "draft_b": f"Give your AI agents memory across sessions with {brand}. Explore the API."})
            elif step == 14:
                assert "**Lab:" in text and "unavailable" not in text.lower(), text
                record("office_demo_completed", text=text)
                step = 15
                await send("Open the Ripple menu", fresh=True)
            elif step == 15:
                assert "Current audience" not in text and saved_cid not in text, text
                done(True, "Research, audience, generated posts/images, exact A/B, approval, image edit, imported Office demo, fresh session" + (", two videos and video edit" if args.videos else "") + " passed")
        except Exception as exc:
            done(False, f"{type(exc).__name__}: {exc}")

    probe.include(chat)

    @probe.on_event("startup")
    async def startup(ctx):
        nonlocal step
        await asyncio.sleep(2)
        if args.resume:
            # Only the isolated test runner seeds its own chat state; no public resume/ownership bypass.
            orchestrator.storage.set(f"ripple-chat:{probe.address}:{session}", dict(brand=brand, campaign_id=saved_cid))
            step = 7 if args.videos else 12
            if args.videos:
                await send(dict(action="video", brand=brand, campaign_id=saved_cid))
            else:
                from ripple_agents import cards, workflow
                current = workflow.snapshot(_stdb(), brand, saved_cid)
                button = dict(selections(json.loads(cards.campaign(current).metadata["card_payload"])))
                await send(button["Edit image A"])
        else:
            await send("Open the Ripple menu", fresh=True)

    @probe.on_interval(period=10)
    async def poll(ctx):
        if time.monotonic() - started > 2400:
            done(False, "Timed out after 40 minutes")
        if step in (8, 11) and video_task and video_task.done():
            if video_task.exception():
                done(False, f"Video worker failed: {type(video_task.exception()).__name__}")
            await send(dict(action="campaign_status", brand=brand, campaign_id=saved_cid))

    if args.mailbox:
        probe.run()
    else:
        orchestrator = build_orchestrator(local=True)
        agents = [orchestrator, build_audience_agent(local=True), build_creative_director(_stdb, local=True),
                  build_image_gen(_stdb, local=True), build_simulator(_stdb, local=True), probe]
        Bureau(agents=agents, port=port, endpoint=[endpoint], registration_policy=LocalRegistration()).run()


if __name__ == "__main__":
    main()
