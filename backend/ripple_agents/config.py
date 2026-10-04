"""Agent identities, ports and links. Seeds are secrets: never print them."""
import os
from dataclasses import dataclass

from uagents_core.identity import Identity

from twins.config import load_secret

BUREAU_PORT = int(os.environ.get("RIPPLE_AGENTS_PORT", "8100"))
HANDLE = os.environ.get("RIPPLE_AGENT_HANDLE", "ripple")
AVATAR_URL = os.environ.get(
    "RIPPLE_AVATAR_URL", "https://raw.githubusercontent.com/Irfan-Firosh/Ripple/main/frontend/public/favicon.svg")
DASHBOARD_URL = os.environ.get("RIPPLE_DASHBOARD_URL", "")
# The Simulation agent (reach / cascade) runs elsewhere; set its address to have the orchestrator call it.
SIMULATOR_ADDRESS = os.environ.get("RIPPLE_SIMULATOR_ADDRESS", "")


@dataclass(frozen=True)
class AgentSpec:
    name: str
    seed_env: str

    @property
    def seed(self) -> str:
        return load_secret(self.seed_env)

    @property
    def address(self) -> str:
        return Identity.from_seed(self.seed, 0).address


ORCHESTRATOR = AgentSpec("ripple", "AGENT_SEED_ORCHESTRATOR")
AUDIENCE = AgentSpec("ripple-audience", "AGENT_SEED_AUDIENCE")


def asi1_api_key() -> str:
    return load_secret("ASI_ONE_API_KEY")


def agentverse_api_key() -> str:
    return load_secret("AGENTVERSE_API_KEY")
