# Ripple

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Ripple turns a brand's existing social audience into a pre-launch test market. Compare campaigns against
synthetic behavioural personas grounded in public posts (X and Bluesky). Personas never infer
sensitive traits such as race, religion, health, sexual orientation, politics or income.

## Use it in ASI:One

Open [ASI:One](https://asi1.ai) and talk to **@ripple**, for example:

- "Research @supermemory."
- "Generate a campaign for @supermemory using recent company facts. Offer: Explore Supermemory."
- "Compare @supermemory. A: 'Give your AI agents memory across sessions.' B: 'Your agent forgot your last conversation. Give it persistent memory.'"

Chat follows Audience → Concepts → Test → Launch. Buttons let you edit images, make and edit videos,
test the exact saved posts, approve a draft, and open it in the X composer. The Supermemory demo has 219
personas; Raycast's Bluesky audience also remains available.

## Agents (Fetch.ai uAgents, registered on Agentverse)

| Agent | Address | Role |
|---|---|---|
| `ripple` (orchestrator, handle `ripple`) | `agent1qvq9ea8vhcvwure28rvzzdjp23k2ffnmcq0d6sed9thmn85kvam5jvqdrlj` | Agent Chat Protocol entry point for ASI:One. Plans each request with the ASI:One LLM, delegates, and replies in chat. |
| `ripple-audience` | `agent1qvl0y3yn06476jkk6wpzj638x0hjh4ws87wgs4200k83n4ugk0nk65ruxnw` | Finds who in the audience cares about a topic; asks the most relevant personas how they would react to each draft. |
| `ripple-creative-director` | `agent1qwnufkenp53ewr5rfqxprkvx04ztes96xqmw32uvcegd4674dh5ajkfva3y` | Researches the company and manages saved campaign concepts, full post copy, videos, and approvals. |
| `ripple-image-gen` | `agent1q0ed307u95982pv35ecz3ekr5u9l6eckx6nfcswahtyp56f4fgv9x7muyse` | Generates campaign images and saves each concept. |
| `ripple-simulation` | `agent1qtcpquer88v9q83t3p7t83cwjkt9m5t9lt2etw435c04grerdzw26ve3d2f` | Projects reach and runs the same A/B experiments shown in the web Lab. Runs inside the Bureau by default; `RIPPLE_SIMULATOR_ADDRESS` can override it. |

Shared state (raw follower data, personas, niches) lives in the SpacetimeDB database `ripple-mhacks`.

The web campaign page uses the same saved flow and workers. Chat links open a shared review view; continue
editing and approving in the originating chat. The Lab shows the exact tested drafts, audience results, and
side-by-side analysis. See [Fetch.ai setup and demo instructions](docs/fetch-ai-demo.md).

Results are synthetic stress tests, not validated predictions of individual behavior. Historical engagement
anchors simulation scale; held-out historical accuracy scoring is not implemented. Current X onboarding uses
the repository's cookie-based ingestion, not the official X Developer API.

## Clerk demo sign-in

Put `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the repo-root `.env`, using the publishable key from your Clerk Development instance. The Vite frontend maps that value to its `ClerkProvider`; a `VITE_CLERK_PUBLISHABLE_KEY` in `frontend/.env.local` takes precedence if you need a frontend-specific instance. Keep `CLERK_SECRET_KEY` in the root `.env` for server-side use; the frontend never receives it. Restart the Vite server after changing either public key.

Open `http://localhost:5173/auth` to sign up or `http://localhost:5173/auth/sign-in` to sign in. Successful authentication redirects to `/onboarding`. Clerk handles the sign-in session; SpacetimeDB currently uses its own separate identity for campaign mutations.

## Run the agents

Requirements: Python 3.12+, [uv](https://docs.astral.sh/uv/), an [ASI:One API key](https://asi1.ai), an
[Agentverse API key](https://agentverse.ai), an Anthropic API key, and `spacetime login` (or `SPACETIME_TOKEN`).

Put these in `.env` at the repo root:

```bash
ASI_ONE_API_KEY=...
AGENTVERSE_API_KEY=...
CLAUDE_API_KEY=...
CLAUDE_API_KEY_2=...          # current brand writer and video pipeline
EXA_API_KEY=...              # company research
ELEVENLABS_API_KEY=...       # video narration
XAI_API_KEY=...              # image generation
AGENT_SEED_ORCHESTRATOR=...   # any long random string; it fixes the agent's address
AGENT_SEED_AUDIENCE=...
# optional
RIPPLE_SIMULATOR_ADDRESS=agent1...
RIPPLE_DASHBOARD_URL=https://...
```

```bash
cd backend
uv sync
uv run python -m ripple_agents              # starts the orchestrator and specialists
uv run python -m ripple_agents --addresses  # prints the agent addresses
uv run python -m ripple_agents.probe "Who in @raycast.com's audience cares about AI agents?"  # test without ASI:One
uv run pytest                               # unit tests
```

For the complete guided chat demo, worker commands, and live verification, see [Fetch.ai demo instructions](docs/fetch-ai-demo.md).
