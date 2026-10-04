"""Ripple Simulation agent: scores a draft against a brand's twins and runs the cascade in SpacetimeDB."""
from pathlib import Path

from uagents import Agent, Context, Protocol

from .contracts import CompareRequest, CompareResult, SimulateRequest, SimulateResult
from ripple_agents.messages import LabRequest as OrchLabRequest
from ripple_agents.messages import LabResult as OrchLabResult
from ripple_agents.messages import SimulateRequest as OrchSimulateRequest
from ripple_agents.messages import SimulateResult as OrchSimulateResult

from .handlers import default_deps, handle_compare, handle_orchestrator_lab, handle_orchestrator_simulate, handle_simulate
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


# The teammate's Orchestrator (backend/ripple_agents) sends its own message types; same protocol, separate handler.
orchestrator_proto = Protocol(name="ripple-simulation-orchestrator", version="1.0.0")


@orchestrator_proto.on_message(model=OrchSimulateRequest, replies=OrchSimulateResult)
async def on_orchestrator_simulate(ctx: Context, sender: str, msg: OrchSimulateRequest):
    await handle_orchestrator_simulate(ctx, sender, msg, DEPS)


@orchestrator_proto.on_message(model=OrchLabRequest, replies=OrchLabResult)
async def on_orchestrator_lab(ctx: Context, sender: str, msg: OrchLabRequest):
    await handle_orchestrator_lab(ctx, sender, msg, DEPS)


agent.include(proto, publish_manifest=True)
agent.include(orchestrator_proto, publish_manifest=True)


@agent.on_event("startup")
async def announce(ctx: Context):
    ctx.logger.info(f"ripple-simulation {agent.address}")


if __name__ == "__main__":
    agent.run()
