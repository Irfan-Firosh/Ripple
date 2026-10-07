#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./ripple.sh [--stop | --doctor | --help]

Starts the Ripple frontend at https://ripple.test.
Requires Node.js 24+. Run as your normal user, not with sudo.
Portless may prompt for administrator access for port 443, HTTPS trust,
and its managed /etc/hosts entries. Ctrl+C stops the app; the proxy stays
available until ./ripple.sh --stop (which also affects other Portless apps).
USAGE
}

if [[ $# -gt 1 ]]; then usage >&2; exit 2; fi
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  ''|--stop|--doctor) ;;
  *) usage >&2; exit 2 ;;
esac

if [[ ${EUID} -eq 0 ]]; then
  echo 'Run ./ripple.sh without sudo; Portless elevates only its proxy setup.' >&2
  exit 1
fi
for command in node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing $command. Install Node.js 24 or newer first." >&2
    exit 1
  fi
done
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo 'Portless requires Node.js 24 or newer.' >&2
  exit 1
fi

ripple_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$ripple_root/frontend"
ripple_portless="$PWD/node_modules/.bin/portless"
if [[ ! -x "$ripple_portless" || ! -x "$PWD/node_modules/.bin/vite" ]]; then
  echo 'Installing frontend dependencies…'
  npm install
fi

# Keep this launcher on loopback HTTPS with the exact, port-free URL.
export PORTLESS=1 PORTLESS_PORT=443 PORTLESS_HTTPS=1 PORTLESS_TLD=test
export PORTLESS_LAN=0 PORTLESS_SYNC_HOSTS=1
case "${1:-}" in
  --stop) exec "$ripple_portless" proxy stop ;;
  --doctor) exec "$ripple_portless" doctor ;;
esac

"$ripple_portless" proxy start --https --tld test --port 443
echo 'Starting Ripple at https://ripple.test — Ctrl+C stops the app.'
exec "$ripple_portless" ripple npm run dev -- --host 127.0.0.1 --strictPort
