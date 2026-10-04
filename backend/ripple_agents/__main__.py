"""Run the Ripple agents in one Bureau: `uv run python -m ripple_agents` (or `--addresses` to print them)."""
import sys

from uagents import Agent, Bureau, Context

from twins.config import MissingSecret

from .agents import STARTER_PROMPTS, build_audience_agent, build_orchestrator
from .config import AUDIENCE, BUREAU_PORT, ORCHESTRATOR, SIMULATOR_ADDRESS, agentverse_api_key
from .registration import connect_mailbox


def _register_on_startup(agent: Agent, starter_prompts: list[str] | None = None) -> None:
    @agent.on_event("startup")
    async def register(ctx: Context):
        try:
            ok, detail = await connect_mailbox(agent, agentverse_api_key(), starter_prompts)
        except MissingSecret:
            ctx.logger.warning("AGENTVERSE_API_KEY not set: connect the mailbox from the Agent Inspector link above")
            return
        if ok:
            ctx.logger.info(f"on Agentverse: https://agentverse.ai/agents/details/{agent.address}")
        else:
            ctx.logger.error(f"Agentverse registration failed: {detail}")


def main(argv: list[str]) -> int:
    if "--addresses" in argv:
        for spec in (ORCHESTRATOR, AUDIENCE):
            print(f"{spec.name}: {spec.address}")
        print(f"simulator: {SIMULATOR_ADDRESS or '(not configured: set RIPPLE_SIMULATOR_ADDRESS)'}")
        return 0
    orchestrator, audience = build_orchestrator(), build_audience_agent()
    _register_on_startup(orchestrator, STARTER_PROMPTS)
    _register_on_startup(audience)
    bureau = Bureau(agents=[orchestrator, audience], port=BUREAU_PORT,
                    endpoint=[f"http://127.0.0.1:{BUREAU_PORT}/submit"])
    bureau.run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
