"""Agent identities, ports and links. Seeds are secrets: never print them."""
import os
from dataclasses import dataclass

from uagents_core.identity import Identity

from twins.config import MissingSecret, load_secret


def _setting(name, default=""):
    try:
        return load_secret(name)
    except MissingSecret:
        return default

BUREAU_PORT = int(os.environ.get("RIPPLE_AGENTS_PORT", "8100"))
HANDLE = os.environ.get("RIPPLE_AGENT_HANDLE", "ripple")
AVATAR_URL = os.environ.get(
    "RIPPLE_AVATAR_URL", "https://raw.githubusercontent.com/Irfan-Firosh/Ripple/main/frontend/public/favicon.svg")
APP_URL = _setting("RIPPLE_APP_URL", "http://localhost:5173").rstrip("/")
DASHBOARD_URL = _setting("RIPPLE_DASHBOARD_URL")
CARD_ASSET_URL = _setting("RIPPLE_CARD_ASSET_URL",
    "https://raw.githubusercontent.com/Irfan-Firosh/Ripple/5c1a2e9598aff9f1088d90a42422c78d18396caf/frontend/public/fetchai-buttons").rstrip("/")


def simulation_seed() -> str:
    try:
        return load_secret("RIPPLE_SIMULATION_SEED")
    except MissingSecret:
        return load_secret("AGENT_SEED_ORCHESTRATOR") + ":ripple-simulation"


def _local_simulator() -> str:
    """Keep the existing identity while using the current Lab adapter."""
    try:
        return Identity.from_seed(simulation_seed(), 0).address
    except MissingSecret:
        return ""


# RIPPLE_SIMULATOR_ADDRESS points at a Simulation agent running elsewhere; unset = the one in this Bureau.
SIMULATOR_EXTERNAL = _setting("RIPPLE_SIMULATOR_ADDRESS")
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
        try:
            return load_secret(self.seed_env)
        except MissingSecret:
            if self.seed_env in {"AGENT_SEED_CREATIVE_DIRECTOR", "AGENT_SEED_IMAGE_GEN"}:
                return load_secret("AGENT_SEED_ORCHESTRATOR") + ":" + self.name
            raise

    @property
    def address(self) -> str:
        return Identity.from_seed(self.seed, 0).address


ORCHESTRATOR = AgentSpec("ripple", "AGENT_SEED_ORCHESTRATOR")
AUDIENCE = AgentSpec("ripple-audience", "AGENT_SEED_AUDIENCE")
CREATIVE_DIRECTOR = AgentSpec("ripple-creative-director", "AGENT_SEED_CREATIVE_DIRECTOR")
IMAGE_GEN = AgentSpec("ripple-image-gen", "AGENT_SEED_IMAGE_GEN")


def asi1_api_key() -> str:
    return load_secret("ASI_ONE_API_KEY")


def agentverse_api_key(env_name: str = "AGENTVERSE_API_KEY") -> str:
    """Each agent registers with the Agentverse account that owns it: AGENTVERSE_API_KEY for the ripple agents,
    AGENTVERSE_API_KEY_SIMULATION for the Simulation agent when it belongs to a different account."""
    return load_secret(env_name)
