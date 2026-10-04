"""Agent settings from the environment / repo-root .env. Seeds are secrets: never log them."""
import os
import secrets

from twins.config import DEFAULT_ENV_PATH, _dotenv_value

PORTS = {"orchestrator": 8101, "audience": 8102, "simulation": 8103}


def seed(name: str) -> str:
    key = f"RIPPLE_{name.upper()}_SEED"
    value = os.environ.get(key, "").strip() or _dotenv_value(DEFAULT_ENV_PATH, key)
    if not value:
        raise RuntimeError(f"{key} is not set. Generate one with: python -c \"import secrets;print(secrets.token_hex(32))\"")
    return value


def new_seed() -> str:
    return secrets.token_hex(32)
