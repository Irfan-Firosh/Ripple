# Ripple agents

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Ripple tests a post on Claude-built digital twins of a brand's real audience before it goes live.

| Agent | Address | Does |
| --- | --- | --- |
| ripple-orchestrator | (teammate fills in) | ASI:One chat, cards, payments |
| ripple-audience | (printed on startup) | "Why would @x engage?", audience by niche |
| ripple-simulation | (printed on startup) | Reach prediction: Claude policy + Monte Carlo cascade in SpacetimeDB |

Run: `cd backend && uv run python -m agents.simulation_agent` and `uv run python -m agents.audience_agent`.
Needs `.env`: `CLAUDE_API_KEY`, `RIPPLE_AUDIENCE_SEED`, `RIPPLE_SIMULATION_SEED` (+ optional `AGENTVERSE_API_KEY`).

Local round trip without Agentverse (no Inspector step): set `RIPPLE_AGENTS_LOCAL=1` for both agents and run
`uv run python -m agents.dev_client <simulation address> <audience address>`.
