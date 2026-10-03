# Ripple × SpacetimeDB: SpacetimeDB as the backend

Agreed 2026-10-03. Ripple's validation loop stays exactly as it is. SpacetimeDB is where every step's state lives and where the simulation runs. **No prediction market, no game:** this is Ripple, with SpacetimeDB as its engine.

## Why this wins the Spacetime prize

Their brief rewards Spacetime as **"the core real-time backend"**, with **live shared state**, **instant sync between users/agents/systems**, **server-side logic close to the data**, **shared simulations**, and **AI systems coordinating in a persistent world state**. It penalizes being **"added on the side"**.

> **Pitch:** Ripple's simulation doesn't run on a server and get copied into a database. It runs _in_ SpacetimeDB. Agents, the chat, and the browser all read and write the same live world state.

## Why SpacetimeDB and not Supabase

**In Supabase, the database and the logic are separate.** Postgres stores the data. The code (Edge Functions, a Python server, the browser) runs elsewhere: it reads from the database, computes, and writes back. Realtime then tells clients that rows changed.

**In SpacetimeDB, the database is the server.** A module written in TypeScript or Rust is uploaded into the database. Its functions, called **reducers**, run inside it, next to the data. Each reducer call is one atomic transaction. Clients subscribe to SQL queries and get the changes pushed to them. ([key architecture](https://spacetimedb.com/docs/intro/key-architecture): a database is _"an application that runs on a host"_, and reducers _"are run in their own separate and atomic database transactions"_.)

|                    | Supabase                                         | SpacetimeDB                                                   |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------- |
| Where logic runs   | Outside the database (Edge Functions or own server) | Inside the database (reducers)                                |
| Write path         | client/server → API → Postgres → Realtime broadcast | client calls a reducer → transaction → subscribers get the diff |
| Timed jobs         | pg_cron or an external worker                    | Scheduled reducers, built into the module                     |
| Live sync          | Realtime reads the Postgres change log (added on) | Subscriptions are the main way to read                        |
| State              | On disk in Postgres                              | In memory, plus a commit log                                  |
| Caller identity    | Auth JWT plus row-level security                 | `ctx.sender` in every reducer                                 |
| Strengths          | Auth, storage, pgvector, mature tooling          | Shared live state, multiplayer, simulations                   |

**Why it fits Ripple:**

1. **The cascade runs next to the data.** A scheduled `tick` reducer reads `twin`, `interaction` and `edge_prob`, rolls `ctx.random`, and writes `node_state`, all in one transaction. With Supabase, a worker would pull the graph out on every tick, compute, and write it back. That means more round trips, and partial-write races between overlapping runs.
2. **Every viewer sees the same run live.** The web graph, the ASI:One agent and teammates' screens all subscribe to `node_state` and `sim_result`. Each tick commits, and every viewer sees the same nodes light up. No separate WebSocket server is needed.
3. **Many agents share one world state.** The Fetch agents, AgentCore twin writes and the web app all write through reducers. Because each reducer is atomic, nobody ever reads a half-built twin or a half-finished tick.
4. **Results are reproducible.** Seeded randomness inside the module means re-running a draft gives the same cascade, so A/B/C comparisons are fair.
5. **Prize fit.** The Spacetime brief asks for "shared simulations", "AI systems coordinating in a persistent world state", and Spacetime as the _core_ backend. Supabase is not an MHacks sponsor; Neon is the Postgres sponsor.

**Caveats:**

- If Ripple only computed a reach number in Python and stored it, Supabase would do the job. SpacetimeDB earns its place because the simulation runs inside it.
- Modules cannot run Python. The model, Grok and AgentCore calls stay outside, and only their results come in through reducers.
- SpacetimeDB has no built-in auth, file storage or vector search. Clerk handles auth.
- The free tier allows about 3M function calls a month. Batch the work per tick rather than making one call per node.
- There is no Python SDK. Plain HTTP works, as proven in the spike.

## Reducers vs AWS Lambda

**Alike:** both are functions you deploy without managing a server, and both are invoked by name.

**Different:**

|                   | Lambda                                  | Reducer                                                         |
| ----------------- | --------------------------------------- | --------------------------------------------------------------- |
| Where it runs     | Separate container, away from the data  | Inside the database process                                     |
| Data access       | Network call to DynamoDB, RDS, etc.     | In-memory (`ctx.db.twin.find(...)`)                             |
| Transactions      | None by default                         | Every call is one atomic transaction                            |
| Side effects      | Can call any API                        | **No network calls**: it only reads and writes tables (deterministic) |
| State             | Stateless                               | The tables are the state                                        |
| Caller            | Parsed from the event or JWT            | `ctx.sender`, built in                                          |
| Timers            | EventBridge triggers                    | Scheduled reducers                                              |
| Client push       | Built by you (API Gateway WebSockets, SNS) | Automatic when the transaction commits                          |
| Cold starts       | Yes                                     | No                                                              |

**Mental model:** a reducer is closer to a **stored procedure** than to a Lambda. It is written in TypeScript or Rust and comes with real-time push.

**In Ripple:**

- Reducers do the fast, deterministic work: `upsert_post`, `start_simulation`, `tick`, writing `sim_result`.
- Anything that needs the network runs outside, in Fetch agents or Python: Grok `x_search`, AgentCore twin building, and the policy model. That outside work is the Lambda-like part, and it writes its results back by calling reducers.

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
