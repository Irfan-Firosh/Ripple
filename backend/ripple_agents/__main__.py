"""Run the Ripple agents in one Bureau: `uv run python -m ripple_agents` (or `--addresses` to print them)."""
import sys

from uagents import Agent, Bureau, Context
from uagents_core.registration import BatchRegistrationPolicy

from twins.config import MissingSecret

from .agents import STARTER_PROMPTS, _stdb, build_audience_agent, build_orchestrator
from .creative import build_creative_director, build_image_gen
from .config import (AUDIENCE, BUREAU_PORT, CREATIVE_DIRECTOR, IMAGE_GEN, ORCHESTRATOR, SIMULATOR_ADDRESS, SIMULATOR_EXTERNAL,
                     agentverse_api_key)
from .registration import connect_mailbox


SIMULATION_KEY = "AGENTVERSE_API_KEY_SIMULATION"


class LocalRegistration(BatchRegistrationPolicy):
    """A rehearsal must never replace the live agents' published endpoints."""
    def add_agent(self, agent_info, identity):
        pass

    async def register(self):
        pass


def _register_on_startup(agent: Agent, starter_prompts: list[str] | None = None,
                         key_env: str = "AGENTVERSE_API_KEY") -> None:
    @agent.on_event("startup")
    async def register(ctx: Context):
        try:
            try:
                api_key = agentverse_api_key(key_env)
            except MissingSecret:
                if key_env != SIMULATION_KEY:
                    raise
                api_key = agentverse_api_key()
                ctx.logger.info("Using the main Agentverse account for the simulation agent")
            ok, detail = await connect_mailbox(agent, api_key, starter_prompts)
        except MissingSecret:
            if key_env == SIMULATION_KEY:
                ctx.logger.info("No Agentverse API key is available for the simulation agent; it remains reachable inside the Bureau")
            else:
                ctx.logger.warning(f"{key_env} not set: connect the mailbox from the Agent Inspector link above")
            return
        if ok:
            ctx.logger.info(f"on Agentverse: https://agentverse.ai/agents/details/{agent.address}")
        else:
            ctx.logger.error(f"Agentverse registration failed: {detail}")


def main(argv: list[str]) -> int:
    if "--addresses" in argv:
        for spec in (ORCHESTRATOR, AUDIENCE, CREATIVE_DIRECTOR, IMAGE_GEN):
            print(f"{spec.name}: {spec.address}")
        where = "external" if SIMULATOR_EXTERNAL else "in this Bureau"
        print(f"simulator: {SIMULATOR_ADDRESS} ({where})" if SIMULATOR_ADDRESS else
              "simulator: (not configured: set RIPPLE_SIMULATION_SEED or RIPPLE_SIMULATOR_ADDRESS)")
        return 0
    local = "--local" in argv
    orchestrator, audience = build_orchestrator(local=local), build_audience_agent(local=local)
    director, image_gen = build_creative_director(_stdb, local=local), build_image_gen(_stdb, local=local)
    if not local:
        _register_on_startup(orchestrator, STARTER_PROMPTS)
        _register_on_startup(audience)
        _register_on_startup(director)
        _register_on_startup(image_gen)
    agents = [orchestrator, audience, director, image_gen]
    if SIMULATOR_ADDRESS and not SIMULATOR_EXTERNAL:
        from .simulation import build_simulator
        simulator = build_simulator(_stdb, local=local)
        if not local:
            _register_on_startup(simulator, key_env=SIMULATION_KEY)
        agents.append(simulator)
    bureau = Bureau(agents=agents, port=BUREAU_PORT,
                    endpoint=[f"http://127.0.0.1:{BUREAU_PORT}/submit"],
                    registration_policy=LocalRegistration() if local else None)
    bureau.run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
