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


def network_kwargs(name: str) -> dict:
    """Agentverse mailbox by default; RIPPLE_AGENTS_LOCAL=1 talks over localhost (dev, no Inspector step)."""
    port = PORTS[name]
    if os.environ.get("RIPPLE_AGENTS_LOCAL") == "1":
        return {"port": port, "endpoint": [f"http://127.0.0.1:{port}/submit"], "handle_messages_concurrently": True}
    # Concurrent handling: one slow simulation must not queue every other request behind it.
    return {"port": port, "mailbox": True, "handle_messages_concurrently": True}


def allowed_senders() -> frozenset[str] | None:
    """RIPPLE_ALLOWED_SENDERS: comma-separated agent addresses (the Orchestrator's). Unset = open (dev only)."""
    raw = os.environ.get("RIPPLE_ALLOWED_SENDERS", "").strip() or _dotenv_value(DEFAULT_ENV_PATH, "RIPPLE_ALLOWED_SENDERS")
    addresses = frozenset(a.strip() for a in (raw or "").split(",") if a.strip())
    return addresses or None
