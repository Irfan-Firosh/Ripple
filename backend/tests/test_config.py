from pathlib import Path

import pytest

from twins.config import MissingSecret, load_api_key, load_stdb_token


def test_api_key_env_wins(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("CLAUDE_API_KEY=from-file\n")
    assert load_api_key(env, {"CLAUDE_API_KEY": "from-env"}) == "from-env"


def test_api_key_from_dotenv_strips_quotes(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text('X_API_KEY=other\nCLAUDE_API_KEY="abc123"\n')
    assert load_api_key(env, {}) == "abc123"


def test_api_key_missing_does_not_leak_other_values(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("X_API_KEY=secret-x\n")
    with pytest.raises(MissingSecret) as exc:
        load_api_key(env, {})
    assert "secret-x" not in str(exc.value)


def test_stdb_token_from_cli_toml(tmp_path: Path):
    toml = tmp_path / "cli.toml"
    toml.write_text('default_server = "maincloud"\nspacetimedb_token = "tok123"\n')
    assert load_stdb_token(toml, {}) == "tok123"


def test_stdb_token_env_wins_and_missing_raises(tmp_path: Path):
    assert load_stdb_token(tmp_path / "none.toml", {"SPACETIME_TOKEN": "envtok"}) == "envtok"
    with pytest.raises(MissingSecret):
        load_stdb_token(tmp_path / "none.toml", {})
