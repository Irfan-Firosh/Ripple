"""Ripple Audience agent: asks a twin why it would (not) engage, and describes the audience by niche."""
from pathlib import Path

from uagents import Agent, Context, Protocol

from .contracts import AudienceRequest, AudienceResult, WhyRequest, WhyResult
from .handlers import default_deps, handle_audience, handle_why
from .settings import network_kwargs, seed

agent = Agent(name="ripple-audience", seed=seed("audience"), **network_kwargs("audience"),
              publish_agent_details=True, readme_path=str(Path(__file__).with_name("README.md")),
              description="Talks to Claude-built digital twins of a brand's real audience.")
proto = Protocol(name="ripple-audience", version="1.0.0")
DEPS = default_deps()


@proto.on_message(model=WhyRequest, replies=WhyResult)
async def on_why(ctx: Context, sender: str, msg: WhyRequest):
    await handle_why(ctx, sender, msg, DEPS)


@proto.on_message(model=AudienceRequest, replies=AudienceResult)
async def on_audience(ctx: Context, sender: str, msg: AudienceRequest):
    await handle_audience(ctx, sender, msg, DEPS)


agent.include(proto, publish_manifest=True)


@agent.on_event("startup")
async def announce(ctx: Context):
    ctx.logger.info(f"ripple-audience {agent.address}")


if __name__ == "__main__":
    agent.run()
