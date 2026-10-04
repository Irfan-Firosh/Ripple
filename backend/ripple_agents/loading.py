"""A streamed, three-step loading bar using real workflow milestones."""
from datetime import datetime, timezone
from uuid import uuid4

from uagents_core.contrib.protocols.chat import ChatMessage, TextContent, StartStreamContent, EndStreamContent, EndSessionContent

from .cards import loading


class Loading:
    def __init__(self, ctx, sender, brand):
        self.ctx, self.sender, self.brand = ctx, sender, brand
        self.stream_id = str(uuid4())

    async def update(self, completed, stage):
        filled = round(12 * completed / 3)
        bar = "█" * filled + "░" * (12 - filled)
        content = [TextContent(type="text", text=f"\n@{self.brand} · {stage}\n{bar}  {completed}/3 steps complete\n"),
                   loading(self.brand, stage, completed)]
        if completed == 0:
            content.insert(0, StartStreamContent(type="start-stream", stream_id=self.stream_id))
        await self.ctx.send(self.sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content))

    async def finish(self, text="", card=None):
        content = [TextContent(type="text", text=text)] if text else []
        if card is not None:
            content.append(card)
        content.append(EndStreamContent(type="end-stream", stream_id=self.stream_id))
        if text:
            content.append(EndSessionContent(type="end-session"))
        delivery = await self.ctx.send(self.sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
            content=content))
        if text:
            self.ctx.logger.info(f"interview results sent: {len(text)} characters; delivery={delivery}")
