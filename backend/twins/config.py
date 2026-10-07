"""Secrets and endpoints. Never print the values returned here."""
import os
import re
from collections.abc import Mapping
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV_PATH = REPO_ROOT / ".env"
CLI_TOML = Path.home() / ".config/spacetime/cli.toml"
STDB_URL = os.environ.get("STDB_URL", "https://maincloud.spacetimedb.com")
STDB_DATABASE = os.environ.get("STDB_DATABASE", "ripple-mhacks")


class MissingSecret(RuntimeError):
    pass


def _dotenv_value(env_path: Path, name: str) -> str:
    if not env_path.exists():
        return ""
    for line in env_path.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def load_secret(name: str, env_path: Path = DEFAULT_ENV_PATH, environ: Mapping[str, str] = os.environ) -> str:
    value = environ.get(name, "").strip() or _dotenv_value(env_path, name)
    if not value:
        raise MissingSecret(f"{name} is not set in the environment or in {env_path.name}")
    return value


def load_api_key(env_path: Path = DEFAULT_ENV_PATH, environ: Mapping[str, str] = os.environ) -> str:
    return load_secret("CLAUDE_API_KEY", env_path, environ)


def load_stdb_token(cli_toml: Path = CLI_TOML, environ: Mapping[str, str] = os.environ) -> str:
    value = environ.get("SPACETIME_TOKEN", "").strip()
    if not value and cli_toml.exists():
        match = re.search(r'spacetimedb_token\s*=\s*"([^"]+)"', cli_toml.read_text())
        value = match.group(1) if match else ""
    if not value:
        raise MissingSecret("no SpacetimeDB token: run `spacetime login` or set SPACETIME_TOKEN")
    return value

# Every worker claim carries this; the database refuses older workers (e.g. a stale machine sharing the login).
WORKER_VERSION = 2
