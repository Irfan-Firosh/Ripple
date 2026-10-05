# Ripple

**See the ripple before you post.** Ripple builds AI twins of a brand's real X audience, has a team of agents create the campaign, and tests every draft on the twins before anything goes live.

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Winner at MHacks 2026 · Live demo: [ripple-mhacks.vercel.app](https://ripple-mhacks.vercel.app)

## What it does

1. **Twin the audience.** Enter an X handle. Ripple reads the brand's real followers and builds a Claude Haiku twin for each one from who they follow and what they post, then maps the twins into interest niches.
2. **Generate the campaign.** Exa researches the brand's latest launches, a campaign agent (Claude Opus) writes two drafts with different angles, Grok Imagine creates concept images, and a video agent renders a film for each draft, voiced by ElevenLabs and timed to its word timestamps.
3. **Test it in the Lab.** Every twin decides in character whether to like, repost, reply or quote. Reposts cascade to the reposters' followers, results are projected to the full audience, and the winner ships to X in one click.
4. **Ask from anywhere.** Ripple is a Fetch.ai agent on Agentverse, so ASI:One users can test posts in plain language.

## User flow

![Ripple user flow](docs/lucid/user_flow.png)

## Infrastructure

![Ripple infrastructure](docs/lucid/infra.png)

## Stack

| Layer | Technology |
| --- | --- |
| Database and server logic | SpacetimeDB (TypeScript module on Maincloud): tables, reducers, job claims and real-time subscriptions |
| Frontend | React, TypeScript, Vite, Clerk, Recharts |
| Workers | Python 3.12 with uv: onboarding, Lab simulation, creative, tweet writer and video |
| Models and APIs | Claude Haiku and Opus (Anthropic), ElevenLabs, xAI Grok Imagine, Exa |
| Agents | Fetch.ai uAgents on Agentverse, ASI:One chat |
| Video rendering | Playwright (Chromium) and FFmpeg |
| X data | Scweet with a pool of logged-in sessions |

## Repository

| Path | Contents |
| --- | --- |
| `x-followers-db/` | SpacetimeDB module (`src/index.ts`) and the X follower ingest (`ingest/`) |
| `backend/twins/` | Twin builder, onboarding worker and Lab simulation worker |
| `backend/creative/` | Research, brief and concept image worker |
| `backend/video/` | Tweet writer and video worker |
| `backend/ripple_agents/`, `backend/agents/` | Fetch.ai agents (see their READMEs) |
| `frontend/` | Web app: landing, Home, Audience, Campaign, Lab, `/ops` and `/logs` |
| `docs/lucid/` | Architecture diagrams |

## Getting started

Requirements: Node.js 24+, Python 3.12+ with [uv](https://docs.astral.sh/uv/), the [SpacetimeDB CLI](https://spacetimedb.com/install) (`spacetime login`) and FFmpeg for video.

**1. Configure.** Create `.env` at the repo root (never commit it). The main keys:

```bash
CLAUDE_API_KEY=          # twins, Lab scoring and replies
ELEVENLABS_API_KEY=      # video voiceover
XAI_API_KEY=             # Grok Imagine images
EXA_API_KEY=             # campaign research
X_AUTH_TOKEN=            # auth_token cookie of a logged-in x.com session (X_AUTH_TOKEN_2, ... add more)
STDB_URL=https://maincloud.spacetimedb.com
STDB_DATABASE=ripple-mhacks
# Fetch.ai agents: ASI_ONE_API_KEY, AGENTVERSE_API_KEY, AGENT_SEED_ORCHESTRATOR, AGENT_SEED_AUDIENCE
```

The frontend reads `frontend/.env.local`: `VITE_CLERK_PUBLISHABLE_KEY`, plus optional `VITE_SPACETIMEDB_URI` and `VITE_SPACETIMEDB_DATABASE`.

**2. Publish the database module.**

```bash
cd x-followers-db && npm install
spacetime publish --no-config -s maincloud ripple-mhacks --delete-data=never -y
spacetime generate --lang typescript --out-dir ../frontend/src/module_bindings --module-path . -y
```

**3. Start the workers** (from `backend/`, after `uv sync`):

```bash
uv run python -m twins onboarding-worker   # scrape followers, build twins and the audience graph
uv run python -m twins lab-worker          # run Lab A/B simulations
uv run python -m creative worker           # research, briefs and concept images
uv run python -m video copy-worker         # write the tweet copy for each draft
uv run python -m video worker              # render campaign videos
```

**4. Run the app.**

```bash
cd frontend && npm install && npm run dev
```

Or run `./ripple.sh` from the repo root to serve it at https://ripple.test. Open `/ops` to control twins per brand, video length and voice, pause workers, and toggle the demo switches.

**Fetch.ai agents:** `cd backend && uv run python -m ripple_agents` starts and registers the agents on Agentverse. See [backend/ripple_agents/README.md](backend/ripple_agents/README.md).

## Tests

```bash
cd backend && uv run pytest            # workers and agents
cd frontend && npx playwright test     # web app
```

## Deployment

The Vercel deployment is a static build. `npm run build:static` serves a recorded snapshot of the showcase brand (`frontend/snapshot/`) instead of the live database and makes the deployed site read-only. `frontend/vercel.json` holds the build settings.

## Team

Built by Ansh and Irfan at MHacks 2026.
