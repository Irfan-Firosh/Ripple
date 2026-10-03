# Ripple × SpacetimeDB: SpacetimeDB as the backend

Agreed 2026-10-03. Ripple's validation loop stays exactly as it is. SpacetimeDB is where every step's state lives and where the simulation runs. **No prediction market, no game:** this is Ripple, with SpacetimeDB as its engine.

## Why this wins the Spacetime prize

Their brief rewards Spacetime as **"the core real-time backend"**, with **live shared state**, **instant sync between users/agents/systems**, **server-side logic close to the data**, **shared simulations**, and **AI systems coordinating in a persistent world state**. It penalizes being **"added on the side"**.

> **Pitch:** Ripple's simulation doesn't run on a server and get copied into a database. It runs _in_ SpacetimeDB. Agents, the chat, and the browser all read and write the same live world state.

## The loop, mapped to SpacetimeDB

| Ripple step                                    | Lives in SpacetimeDB                                                    | Written by                                                                                                   | Why it's core                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Scrape** the chosen X page (Grok `x_search`) | `x_post` (live already), `account`                                      | Python scraper, via reducers                                                                                 | Transactional upserts, so re-scrapes never duplicate                                                                 |
| **Graph**                                      | `interaction` edges (reply, quote, mention)                             | A reducer derives the edges as posts arrive                                                                  | The graph is built inside the database the moment data lands                                                         |
| **Twins**                                      | `twin` (per-account rates, topic profile)                               | AWS AgentCore TwinBuilder; the Fetch agent writes it via reducers ([agentcore-twins.md](agentcore-twins.md)) | One shared source of truth for every agent                                                                           |
| **Drafts**                                     | `draft` (A/B/C)                                                         | ASI:One agent or the web app                                                                                 | The team edits together with instant sync                                                                            |
| **Score**                                      | `edge_prob` (policy-model probability per draft and link)               | Python model, written in a batch                                                                             | The model stays in Python; only its output enters the database                                                       |
| **Simulate**                                   | `sim_run`, `node_state`; a **scheduled `tick` reducer**                 | **The SpacetimeDB module itself**                                                                            | The cascade runs next to the data with deterministic randomness (`ctx.random`). Every viewer sees the same run live. |
| **Results**                                    | `sim_result` (reach distribution, communities reached, bridge accounts) | The module, when a run finishes                                                                              | The ASI:One agent and the web app read the same row, so they're always in sync                                       |
| **Recalibrate**                                | `engagement_snapshot` for a draft once it's really posted               | Python re-checks via Grok                                                                                    | Prediction and reality sit side by side, and the twins update from it                                                |

## How the pieces talk

1. **Agents (Python / Fetch.ai uAgents) call reducers over HTTP:** `POST /v1/database/<db>/call/<reducer>`. Options use SATS-JSON `{"some": v}` / `{"none": []}`. This is proven in [`spikes/x-to-spacetime`](../../spikes/x-to-spacetime/README.md). There is no maintained Python SDK, and none is needed.
2. **The web app subscribes** to tables with the TypeScript SDK (`spacetimedb/react`, `useTable`). Live push is proven: a subscriber received an update the moment the reducer committed.
3. **The ASI:One agent** calls `start_simulation`, then reads `sim_result` (SQL over HTTP) and replies in chat.
4. **The model and anything that needs Python stay outside.** TypeScript modules can't run Python, so only results cross over.

## Live deployment (Maincloud)

| Item              | Value                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| Database name     | `ripple-mhacks`                                                                     |
| Database identity | `c200b8794f10e73f0d0c59fc29570993af24bdf1dc4c5531f1c628bfb855aaf6`                  |
| Host              | `https://maincloud.spacetimedb.com`                                                 |
| Dashboard         | https://spacetimedb.com/ripple-mhacks                                               |
| Current module    | The spike module (`x_post` table + `upsert_post` reducer); 15 verified posts loaded |
| Public reads      | Work without auth: `POST <host>/v1/database/ripple-mhacks/sql` with a SQL body      |

**Not yet secured:** `upsert_post` currently accepts calls from any identity. Before the event, restrict writes to the agents' service identity, using `ctx.sender` checks against an allow-list table.

**Credentials:** the owner's CLI token (`~/.config/spacetime/cli.toml`) can publish and delete this database. Never commit or share it. Collaborators log in with their own `spacetime login`. Clients only need the name and host.

## Open items

- Pick the X page to scrape. This sets graph density and whether reply/quote/mention edges are enough.
- Detailed table and reducer design (next design section): keys, indexes, tick rate, run lifecycle, cleanup of finished runs.
- Free-tier budget: Maincloud gives about 3M function calls a month. Size the tick rate × runs × nodes against it.
