# Ripple

## Run the frontend at ripple.test

From this directory, with Node.js 24 or newer:

```bash
./ripple.sh
```

Open **https://ripple.test**. The launcher uses the pinned frontend Portless
dependency, installing frontend dependencies if needed. Run it without `sudo`;
Portless requests administrator access when needed for port 443, local HTTPS
trust, and its managed `/etc/hosts` entries. The frontend runs as your normal user.

Ctrl+C stops the frontend. `./ripple.sh --doctor` checks the proxy, certificate,
and hostname; `./ripple.sh --stop` stops the shared proxy. If another Portless
proxy has a different configuration, stop that proxy before starting this one.
The launcher starts only the frontend; backend workers run separately.

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Ripple predicts how a brand's real social audience would react to a post before it is published. Each follower is
simulated by a synthetic behavioural persona built from their public posts (X and Bluesky). Personas never infer
sensitive traits such as race, religion, health, sexual orientation, politics or income.

## Use it in ASI:One

Open [ASI:One](https://asi1.ai) and talk to **@ripple**, for example:

- "How would @raycast.com's audience react to: 'Raycast AI now runs your extensions for you. Just ask.'"
- "Which is better for @raycast.com? A: 'Raycast for Windows is here.' B: 'Stop alt-tabbing. Raycast now on Windows.'"
- "Who in @raycast.com's audience cares about developer tools?"

The demo audience is Raycast's Bluesky followers: 999 personas built from 1,000 followers.

## Agents (Fetch.ai uAgents, registered on Agentverse)

| Agent | Address | Role |
|---|---|---|
| `ripple` (orchestrator, handle `ripple`) | `agent1qvq9ea8vhcvwure28rvzzdjp23k2ffnmcq0d6sed9thmn85kvam5jvqdrlj` | Agent Chat Protocol entry point for ASI:One. Plans each request with the ASI:One LLM, delegates, and replies in chat. |
| `ripple-audience` | `agent1qvl0y3yn06476jkk6wpzj638x0hjh4ws87wgs4200k83n4ugk0nk65ruxnw` | Finds who in the audience cares about a topic; asks the most relevant personas how they would react to each draft. |
| Simulation agent | set via `RIPPLE_SIMULATOR_ADDRESS` | Projects reach for a draft. |

Shared state (raw follower data, personas, niches) lives in the SpacetimeDB database `ripple-mhacks`.

The workspace has separate **Campaigns** and **Lab v2** tabs: audience-backed briefs, Grok Imagine concepts, editable drafts, and a handoff to the existing Lab simulator. Lab v2 also retains the original illustrative comparison, history, and export tools. See [setup and demo instructions](docs/campaign-studio.md).

## Run the agents

Requirements: Python 3.12+, [uv](https://docs.astral.sh/uv/), an [ASI:One API key](https://asi1.ai), an
[Agentverse API key](https://agentverse.ai), an Anthropic API key, and `spacetime login` (or `SPACETIME_TOKEN`).

Put these in `.env` at the repo root:

```bash
ASI_ONE_API_KEY=...
AGENTVERSE_API_KEY=...
CLAUDE_API_KEY=...
AGENT_SEED_ORCHESTRATOR=...   # any long random string; it fixes the agent's address
AGENT_SEED_AUDIENCE=...
# optional
RIPPLE_SIMULATOR_ADDRESS=agent1...
RIPPLE_DASHBOARD_URL=https://...
```

```bash
cd backend
uv sync
uv run python -m ripple_agents              # starts both agents and registers them on Agentverse
uv run python -m ripple_agents --addresses  # prints the agent addresses
uv run python -m ripple_agents.probe "Who in @raycast.com's audience cares about AI agents?"  # test without ASI:One
uv run pytest                               # unit tests
```
