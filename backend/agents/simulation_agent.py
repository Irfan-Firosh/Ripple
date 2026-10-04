"""Ripple Simulation agent: scores a draft against a brand's twins and runs the cascade in SpacetimeDB."""
from pathlib import Path

from uagents import Agent, Context, Protocol

from .contracts import CompareRequest, CompareResult, SimulateRequest, SimulateResult
from .handlers import default_deps, handle_compare, handle_simulate
from .settings import network_kwargs, seed

agent = Agent(name="ripple-simulation", seed=seed("simulation"), **network_kwargs("simulation"),
              publish_agent_details=True, readme_path=str(Path(__file__).with_name("README.md")),
              description="Simulates how a real scraped audience (95 X / 1,000 Bluesky twins) reacts to a draft post.")
proto = Protocol(name="ripple-simulation", version="1.0.0")
DEPS = default_deps()


@proto.on_message(model=SimulateRequest, replies=SimulateResult)
async def on_simulate(ctx: Context, sender: str, msg: SimulateRequest):
    await handle_simulate(ctx, sender, msg, DEPS)


@proto.on_message(model=CompareRequest, replies=CompareResult)
async def on_compare(ctx: Context, sender: str, msg: CompareRequest):
    await handle_compare(ctx, sender, msg, DEPS)


agent.include(proto, publish_manifest=True)


@agent.on_event("startup")
async def announce(ctx: Context):
    ctx.logger.info(f"ripple-simulation {agent.address}")


if __name__ == "__main__":
    agent.run()
