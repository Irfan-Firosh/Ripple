"""Agent identities, ports and links. Seeds are secrets: never print them."""
import os
from dataclasses import dataclass

from uagents_core.identity import Identity

from twins.config import MissingSecret, load_secret

BUREAU_PORT = int(os.environ.get("RIPPLE_AGENTS_PORT", "8100"))
HANDLE = os.environ.get("RIPPLE_AGENT_HANDLE", "ripple")
AVATAR_URL = os.environ.get(
    "RIPPLE_AVATAR_URL", "https://raw.githubusercontent.com/Irfan-Firosh/Ripple/main/frontend/public/favicon.svg")
APP_URL = os.environ.get("RIPPLE_APP_URL", "http://localhost:5173").rstrip("/")
DASHBOARD_URL = os.environ.get("RIPPLE_DASHBOARD_URL", "")


def _local_simulator() -> str:
    """Address of our own Simulation agent (backend/agents), which `python -m ripple_agents` runs in the Bureau."""
    try:
        return Identity.from_seed(load_secret("RIPPLE_SIMULATION_SEED"), 0).address
    except MissingSecret:
        return ""


# RIPPLE_SIMULATOR_ADDRESS points at a Simulation agent running elsewhere; unset = the one in this Bureau.
SIMULATOR_EXTERNAL = os.environ.get("RIPPLE_SIMULATOR_ADDRESS", "").strip()
SIMULATOR_ADDRESS = SIMULATOR_EXTERNAL or _local_simulator()


def lab_url(brand: str, experiment_id: str) -> str:
    return f"{APP_URL}/lab?brand={brand}&exp={experiment_id}"


def dashboard_url(brand: str) -> str:
    return DASHBOARD_URL or f"{APP_URL}/dashboard?brand={brand}"


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
