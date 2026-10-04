#!/usr/bin/env bash
# Start the local pieces of the Fetch.ai demo against the shared maincloud database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${TMPDIR:-/tmp}/ripple-fetch-demo-$(id -u)"
DB_URL="https://maincloud.spacetimedb.com"
DB_NAME="ripple-mhacks"
APP_PORT=5173
AGENTS_PORT=8100

usage() {
  cat <<'EOF'
Usage: scripts/fetch_demo.sh [start|check|status]

  start   Preflight and start/reuse agents, onboarding, creative, Lab, and UI (default)
  check   Check dependencies, secrets, and maincloud without starting services
  status  Show services started by this script and their log paths

This script does not run the paid live rehearsal. See docs/fetch-ai-demo.md.
EOF
}

die() { printf 'Fetch demo: %s\n' "$*" >&2; exit 1; }

case "${1:-start}" in
  -h|--help|help) usage; exit 0 ;;
  start|check|status) ACTION="${1:-start}" ;;
  *) usage >&2; exit 2 ;;
esac

mkdir -p "$RUN_DIR"

running_pid() {
  local service="$1" pid=""
  if [[ -f "$RUN_DIR/$service.pid" ]]; then
    read -r pid < "$RUN_DIR/$service.pid" || true
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      printf '%s\n' "$pid"
    fi
  fi
}

status() {
  local service pid
  for service in agents onboarding creative lab ui; do
    pid="$(running_pid "$service")"
    if [[ -n "$pid" ]]; then
      printf '%-12s running (PID %s)  %s/%s.log\n' "$service" "$pid" "$RUN_DIR" "$service"
    else
      printf '%-12s not started by this script\n' "$service"
    fi
  done
}

if [[ "$ACTION" == status ]]; then status; exit 0; fi

command -v uv >/dev/null 2>&1 || die 'uv is missing; install it before the demo.'
command -v npm >/dev/null 2>&1 || die 'npm is missing; install Node.js before the demo.'
command -v curl >/dev/null 2>&1 || die 'curl is missing.'
[[ -x "$ROOT/frontend/node_modules/.bin/vite" ]] || die 'frontend dependencies are missing; run npm install in frontend/.'
[[ -f "$ROOT/.env" ]] || die 'repo-root .env is missing; see README.md.'

# The Python secret loader understands both .env and spacetime login. Never print secret values.
(
  cd "$ROOT"
  PYTHONPATH=backend STDB_URL="$DB_URL" STDB_DATABASE="$DB_NAME" \
    uv run --project backend python - <<'PY'
import os
import re
import sys

from twins.config import MissingSecret, STDB_DATABASE, STDB_URL, load_secret, load_stdb_token
from twins.stdb import StdbClient
from ripple_agents.config import ORCHESTRATOR

required = ("ASI_ONE_API_KEY", "AGENTVERSE_API_KEY", "AGENT_SEED_ORCHESTRATOR",
            "AGENT_SEED_AUDIENCE", "CLAUDE_API_KEY", "XAI_API_KEY")
try:
    for name in required:
        load_secret(name)
    if ORCHESTRATOR.address != "agent1qvq9ea8vhcvwure28rvzzdjp23k2ffnmcq0d6sed9thmn85kvam5jvqdrlj":
        raise RuntimeError("orchestrator seed does not match the linked Agentverse agent")
    token = load_stdb_token()
    # A read-only query also checks that the token can reach the intended database.
    StdbClient(STDB_URL, STDB_DATABASE, token).sql("SELECT * FROM onboarding LIMIT 1")
except Exception as exc:
    if isinstance(exc, MissingSecret):
        print(f"Fetch demo preflight: {exc}", file=sys.stderr)
    elif "orchestrator seed" in str(exc):
        print(f"Fetch demo preflight: {exc}.", file=sys.stderr)
    else:
        print(f"Fetch demo preflight: cannot read {STDB_DATABASE} on maincloud ({type(exc).__name__}).", file=sys.stderr)
    sys.exit(1)

with open(".env", encoding="utf-8") as source:
    env_file = source.read()
has_x_cookie = any(os.environ.get(key) for key in os.environ if re.fullmatch(r"X_AUTH_TOKEN(?:_\d+)?", key))
has_x_cookie |= bool(re.search(r"^X_AUTH_TOKEN(?:_\d+)?=\S+", env_file, re.MULTILINE))
if not has_x_cookie:
    print("Fetch demo preflight: X_AUTH_TOKEN* is missing; new-company onboarding cannot scrape X.", file=sys.stderr)
    sys.exit(1)
print(f"Preflight OK: credentials present; {STDB_DATABASE} reachable on maincloud.")
PY
)

if [[ "$ACTION" == check ]]; then exit 0; fi

# Pin both sides of the handoff to the same database, regardless of local overrides.
export STDB_URL="$DB_URL" STDB_DATABASE="$DB_NAME"
export VITE_SPACETIMEDB_URI="wss://maincloud.spacetimedb.com"
export VITE_SPACETIMEDB_DATABASE="$DB_NAME"
export RIPPLE_AGENTS_PORT="$AGENTS_PORT"
export PYTHONPATH="$ROOT/backend"

port_free() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $port is occupied by a process this script did not start; inspect it before retrying."
  fi
}

start_service() {
  local service="$1" pid
  shift
  pid="$(running_pid "$service")"
  if [[ -n "$pid" ]]; then
    printf '%-12s already running (PID %s)\n' "$service" "$pid"
    return
  fi
  if [[ "$service" == agents ]]; then port_free "$AGENTS_PORT"; fi
  if [[ "$service" == ui ]]; then port_free "$APP_PORT"; fi
  (
    cd "${SERVICE_DIR:-$ROOT}"
    exec nohup "$@" >"$RUN_DIR/$service.log" 2>&1 </dev/null
  ) &
  pid=$!
  printf '%s\n' "$pid" > "$RUN_DIR/$service.pid"
  sleep 2
  if ! kill -0 "$pid" 2>/dev/null; then
    tail -n 20 "$RUN_DIR/$service.log" >&2 || true
    die "$service exited during startup; see $RUN_DIR/$service.log"
  fi
  printf '%-12s started (PID %s)\n' "$service" "$pid"
}

start_service agents uv run --project backend python -m ripple_agents
start_service onboarding uv run --project backend python -m twins onboarding-worker
start_service creative uv run --project backend python -m creative worker
start_service lab uv run --project backend python -m twins lab-worker
SERVICE_DIR="$ROOT/frontend" start_service ui npm run dev -- --host 127.0.0.1 --port "$APP_PORT" --strictPort

for attempt in {1..20}; do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:$APP_PORT/" >/dev/null; then break; fi
  sleep 1
done
curl --silent --fail --max-time 2 "http://127.0.0.1:$APP_PORT/" >/dev/null || die "UI did not become ready; see $RUN_DIR/ui.log"
for attempt in {1..20}; do
  if curl --silent --max-time 2 "http://127.0.0.1:$AGENTS_PORT/submit" >/dev/null; then break; fi
  sleep 1
done
curl --silent --max-time 2 "http://127.0.0.1:$AGENTS_PORT/submit" >/dev/null || die "agents did not open port $AGENTS_PORT; see $RUN_DIR/agents.log"
for service in agents onboarding creative lab ui; do
  [[ -n "$(running_pid "$service")" ]] || die "$service stopped; see $RUN_DIR/$service.log"
done

printf '\nReady: http://localhost:%s/\n' "$APP_PORT"
printf 'Chat: https://agentverse.ai/agents/details/agent1qvq9ea8vhcvwure28rvzzdjp23k2ffnmcq0d6sed9thmn85kvam5jvqdrlj\n'
printf 'Logs: %s/  (rerun with status to check processes)\n' "$RUN_DIR"
