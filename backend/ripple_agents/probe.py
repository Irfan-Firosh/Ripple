"""Talk to the running orchestrator over the Chat Protocol, as ASI:One would:
`uv run python -m ripple_agents.probe "Who in @raycast.com's audience cares about developer tools?"`."""
import os
import sys
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, TextContent, MetadataContent, chat_protocol_spec

from .config import ORCHESTRATOR

PROBE_PORT = 8105


def main(text: str) -> None:
    probe = Agent(name="ripple-probe", seed=f"ripple probe {ORCHESTRATOR.seed}", port=PROBE_PORT,
                  endpoint=[f"http://127.0.0.1:{PROBE_PORT}/submit"], enable_agent_inspector=False)
    # Startup handlers may only send message types from an included protocol.
    chat = Protocol(spec=chat_protocol_spec)

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        print("[ack]", flush=True)

    @chat.on_message(ChatMessage)
    async def on_reply(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        for c in msg.content:
            print(c.text if isinstance(c, TextContent) else f"[{c.type}]", flush=True)
            if c.type == "end-session":
                os._exit(0)  # uagents swallows SystemExit inside handlers
        if any(isinstance(c, MetadataContent) and c.metadata.get("card_kind")
               and c.metadata.get("requires_card_interaction") != "false" for c in msg.content):
            os._exit(0)

    probe.include(chat)

    @probe.on_event("startup")
    async def send(ctx: Context):
        status = await ctx.send(ORCHESTRATOR.address, ChatMessage(
            timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type="text", text=text)]))
        print(f"[sent: {status.status} {status.detail}]", flush=True)

    probe.run()


if __name__ == "__main__":
    main(" ".join(sys.argv[1:]) or "What can you do?")
