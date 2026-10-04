"""Rehearse the real ACP + Agentverse mailbox flow (makes paid model/image calls).

PYTHONPATH=backend uv run --project backend python scripts/fetch_demo_check.py
PYTHONPATH=backend uv run --project backend python scripts/fetch_demo_check.py --onboard resend
Evidence is written to /tmp/ripple-fetch-demo.json (or ripple-fetch-onboarding.json).
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

from uagents import Agent, Model, Protocol
from uagents.communication import send_exchange_envelope
from uagents_core.envelope import Envelope
from uagents_core.config import AgentverseConfig
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement, ChatMessage, MetadataContent, StartSessionContent,
    TextContent, chat_protocol_spec,
)
from ripple_agents.config import ORCHESTRATOR


def selections(node):
    if isinstance(node, dict):
        if node.get("type") == "button":
            yield node["label"], node["action"]["selection"]
        for value in node.values():
            yield from selections(value)
    elif isinstance(node, list):
        for value in node:
            yield from selections(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--onboard", help="Build a new X audience and resume its saved audience analysis")
    args = parser.parse_args()
    port = 8108 if args.onboard else 8107
    artifact = Path("/tmp/ripple-fetch-onboarding.json" if args.onboard else "/tmp/ripple-fetch-demo.json")
    probe = Agent(name="ripple-demo-check", seed=ORCHESTRATOR.seed + f":audit:{port}", port=port,
                  endpoint=[f"http://127.0.0.1:{port}/submit"], enable_agent_inspector=False)
    chat = Protocol(spec=chat_protocol_spec)
    session, step, started = uuid4(), 0, time.monotonic()
    evidence, replies, seen = [], [], set()

    def record(kind, **data):
        evidence.append({"kind": kind, "step": step, "seconds": round(time.monotonic() - started, 1), **data})
        artifact.write_text(json.dumps(evidence, indent=2, default=str))
        print(json.dumps({"kind": kind, "step": step, **{k: v for k, v in data.items() if k != "content"}}, default=str), flush=True)

    def done(ok, reason):
        record("complete", passed=ok, reason=reason)
        os._exit(0 if ok else 1)

    async def send(request, *, fresh=False, card=False):
        nonlocal session, replies
        replies = []
        if fresh:
            session = uuid4()
        content = [StartSessionContent(type="start-session")] if fresh else []
        if card:
            content += [TextContent(type="text", text="Continue"),
                        MetadataContent(type="metadata", metadata={"card_selection": json.dumps(request)})]
        else:
            content.append(TextContent(type="text", text=request))
        msg = ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content)
        env = Envelope(version=1, sender=probe.address, target=ORCHESTRATOR.address, session=session,
                       schema_digest=Model.build_schema_digest(ChatMessage), expires=int(time.time()) + 900)
        env.encode_payload(msg.model_dump_json()); env.sign(probe._identity)
        record("request", request=request, session=str(session))
        status = await send_exchange_envelope(env, [AgentverseConfig().mailbox_endpoint])
        record("delivery", status=str(status.status), detail=status.detail)
        if "DELIVERED" not in str(status.status):
            done(False, status.detail)

    @chat.on_message(ChatAcknowledgement)
    async def ack(ctx, sender, msg):
        record("ack")

    @chat.on_message(ChatMessage)
    async def reply(ctx, sender, msg):
        nonlocal step
        if sender != ORCHESTRATOR.address or str(msg.msg_id) in seen:
            return
        seen.add(str(msg.msg_id))
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        replies.extend(c.model_dump() for c in msg.content)
        record("reply", content=[c.model_dump() for c in msg.content])
        if any(c.type == "end-session" for c in msg.content):
            done(False, "Unexpected error/end-session")
        terminal = next((c for c in msg.content if isinstance(c, MetadataContent)
                         and c.metadata.get("card_kind") and c.metadata.get("requires_card_interaction") != "false"), None)
        if not terminal:
            return
        payload = json.loads(terminal.metadata["card_payload"])
        text = "\n".join(c["text"] for c in replies if c["type"] == "text")
        buttons = dict(selections(payload))
        record("result", text=text, buttons=list(buttons))
        try:
            if args.onboard:
                if "Continue my request" in buttons:
                    step = 2
                    await send(buttons["Continue my request"], card=True)
                elif "Check progress" in buttons:
                    step = 1
                    await asyncio.sleep(3)
                    await send(buttons["Check progress"], card=True)
                elif "Retry build" in buttons:
                    done(False, text)
                else:
                    assert "personas" in text and args.onboard.lower() in text.lower(), text
                    done(True, f"@{args.onboard}: onboarding, progress, saved request resume and live audience completed")
                return
            if step == 0:
                assert "Current audience" not in text, text
                step = 1
                await send("Build an X audience for @supermemory.")
            elif step == 1:
                assert "audience is ready" in text, text
                step = 2
                await send("What are the main interests in @supermemory’s audience?")
            elif step == 2:
                assert "personas" in text and "Main niche" in text, text
                step = 3
                await send("Who in @supermemory’s audience cares about AI and developer tools?")
            elif step == 3:
                assert "Most engaged" in text, text
                step = 4
                await send("Create 2 campaign images for @supermemory promoting that they are open sourcing their software. Goal: make it easier for developers.")
            elif step == 4:
                tests = [selection for label, selection in selections(payload) if label == "Test this post"]
                assert len(tests) >= 2, text
                assert "campaign=" in text, text
                step = 5
                await send(tests[0], card=True)
            elif step == 5:
                assert "Projected reach" in text and "unavailable" not in text.lower(), text
                step = 6
                await send(buttons["Test another post / compare two"], card=True)
            elif step == 6:
                assert terminal.metadata["card_kind"] == "form", payload
                step = 7
                await send({"selection": payload["submit_cta"]["selection"], "brand": "",
                            "draft_a": "Open source memory for agents. Add memory today.",
                            "draft_b": "Ship smarter agents faster. Add memory today."}, card=True)
            elif step == 7:
                assert "**Lab:" in text and "unavailable" not in text.lower(), text
                assert re.search(r"/lab\?brand=supermemory&exp=\d+", text), text
                step = 8
                await send("Open the Ripple menu", fresh=True)
            elif step == 8:
                assert "Current audience" not in text, text
                step = 9
                await send("What are the main interests in @linear’s audience?")
            elif step == 9:
                assert "@linear's audience" in text and "supermemory" not in text, text
                done(True, "Seven-step workflow, structured button/form submissions, fresh chat and different-company chat passed")
        except Exception as exc:
            done(False, f"{type(exc).__name__}: {exc}")

    probe.include(chat)

    @probe.on_event("startup")
    async def startup(ctx):
        await asyncio.sleep(3)
        try:
            await send(f"What are the main interests in @{args.onboard}’s audience?" if args.onboard else "Open the Ripple menu", fresh=True)
        except Exception as exc:
            done(False, f"Startup failed: {exc}")

    @probe.on_interval(period=30)
    async def timeout(ctx):
        if time.monotonic() - started > 1200:
            done(False, "Timed out after 20 minutes")

    probe.run()


if __name__ == "__main__":
    main()
