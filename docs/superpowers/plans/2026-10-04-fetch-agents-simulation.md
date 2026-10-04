# Fetch.ai Agents + SpacetimeDB Simulation Plan

**Goal:** Win "Best Use of Fetch.ai". A user opens ASI:One, pastes a draft post, and gets a **simulated reach prediction** (range, niches, top responders with reasons) back **inside the chat** as an **Interactive Card**. The answer comes from three **registered uAgents** that talk to each other. Paid A/B comparisons go through the **Payment Protocol** (testnet FET). Every run streams **live through SpacetimeDB** to the dashboard.

**Decisions (user, 2026-10-04):** payments are FET on **testnet**. The cascade runs **inside SpacetimeDB**, as reducers plus a scheduled tick.

**Sources:**
- [fetchai-integration.md](../../research/fetchai-integration.md) (criteria and requirements)
- Chat Protocol: `uagents_core.contrib.protocols.chat`
- Payment Protocol: `uagents_core.contrib.protocols.payment`, seller role, `Funds(currency="FET", amount, payment_method="fet_direct")`, verified with cosmpy `LedgerClient(NetworkConfig.fetchai_stable_testnet())`
- Interactive Cards: `MetadataContent` with `card_protocol_version="1"`, `card_kind="custom"`, a JSON-stringified `card_payload` (≤ 64 KB, nesting ≤ 8); the selection comes back as JSON or prose in `TextContent`

## Criteria → feature map

| Fetch criterion | Feature |
| --- | --- |
| Agentverse registration (20%) | `ripple-orchestrator`, `ripple-audience`, `ripple-simulation`, all with `mailbox=True` and `publish_agent_details=True` |
| Chat Protocol / ASI:One, workflow inside chat | The Orchestrator ACKs, then replies with a narration plus a results card. "Simulating 95 twins…" progress text goes out first. |
| Multi-agent orchestration (25%) | Orchestrator → Audience agent (twin Q&A, audience breakdown) and Simulation agent (policy + cascade) over typed uAgents messages |
| Payment Protocol (20%) | Single-draft simulation is free. **Compare drafts** (A/B, up to 3) costs **0.1 testnet FET**: RequestPayment → CommitPayment → on-ledger verify → CompletePayment → run. |
| Interactive Cards (bonus, UX 15%) | Results card (reach range bar, niche badges, top responders with profile pictures and an action badge, "Why?" buttons), compare form card, comparison card, "why" detail card |
| Real-time data (bonus) | `sim_run` / `sim_node` rows update live; the dashboard's `/dashboard?run=<id>` animates that exact run |
| Reliability (bonus) | Timeouts, retries and friendly errors, with a text fallback for every card |

## Simulation model (documented, deterministic per run seed)

1. **Policy (Python, Claude Haiku):**
   - Score the draft against every twin in batches of 10, one forced-tool call per batch.
   - Each twin gets an `action` and a `confidence`.
   - `p_engage` = `confidence` if the action is not "ignore", else `(1 − confidence) × 0.25`.
   - Results are written to `sim_prob`.
2. **Graph (Python graph builder):** `audience_edge` holds:
   - an edge from each person to the most-followed member of their primary niche (the "niche hub");
   - ring edges within each niche;
   - the real reply/mention links.
3. **Cascade (SpacetimeDB reducer):**
   - *Tick 0:* the brand's post is **seen** by each follower with `p = FEED_REACH (0.35)`. A viewer who sees it **engages** with their `p_engage`.
   - *Each later tick:* every new engager exposes their graph neighbours, who see it with `p = SHARE_REACH (0.6)` and engage with their own `p_engage`.
   - The cascade stops when nobody new is reached.
   - It runs **200 Monte Carlo trials** with `ctx.random`, which gives reach p10/p50/p90 plus each person's engage frequency.
   - Trial 0 is replayed tick by tick through a **scheduled reducer**, so viewers watch it spread live.

## Tasks

1. **SpacetimeDB module** (`x-followers-db/src/index.ts`, additive only):
   - tables `audience_edge`, `sim_run`, `sim_prob`, `sim_node`, plus a cascade schedule table;
   - reducers `replace_audience_edges`, `create_sim_run`, `set_sim_probs` (batch), `start_cascade` (runs the Monte Carlo, stores the summary, schedules the replay), `cascade_tick` (scheduled, advances the replay), `fail_sim_run`;
   - `smoke-sim.sh` against a scratch DB; publish without clearing data.
2. **Graph builder** (`backend/twins/graph.py`): builds the edges for a brand and calls `replace_audience_edges`, with tests.
3. **Policy scorer** (`backend/twins/policy.py`): batched forced-tool scoring; tests with `FakeClient`.
4. **Simulation service** (`backend/twins/simulate.py`):
   - `run_simulation(stdb, client, brand, draft)` creates the run, scores, writes probabilities, starts the cascade, polls until done, and returns a `SimSummary`: reach p10/p50/p90, top niches, top responders with reasons, run id and dashboard URL;
   - `compare_drafts(...)`;
   - tests with `FakeStdb`.
5. **Agents** (`backend/agents/`):
   - `messages.py`: typed Models;
   - `cards.py`: card payload builders, with size and nesting validated by tests;
   - `router.py`: intent parsing via a Claude forced tool (simulate / compare / why / audience / help), plus card-selection parsing;
   - `payment.py`: seller flow and testnet verification;
   - `orchestrator.py`, `audience_agent.py`, `simulation_agent.py`;
   - `run_agents.py` starts all three;
   - unit tests for cards, router, payment verification (mocked ledger) and orchestrator flows (mocked `ctx`).
6. **Dashboard** `/dashboard?run=<id>`:
   - polls `sim_run` / `sim_node` (500 ms while running);
   - nodes light up as the replay ticks;
   - engaged nodes are bright, seen-only nodes are dimmed;
   - shows reach stats; Playwright test against a live run.
7. **README + submission:**
   - root README with the two badges, agent names and addresses (printed by `run_agents.py`), run instructions and architecture;
   - demo script;
   - update `fetchai-integration.md`, the winning plan and the Lucid diagram.
8. **Live end-to-end:**
   - start the agents;
   - **the user connects each mailbox once in the Agentverse Inspector** (a manual browser login);
   - chat in ASI:One: simulate → card → "why" → compare → testnet payment → comparison card;
   - create a shared ASI:One chat URL for the submission.

**Needs from the user:**
- Agentverse / ASI:One login, so each agent's mailbox can be connected in the Inspector.
- Optional `ASI_ONE_API_KEY` (not required: routing and scoring use Claude Haiku).
- Testnet FET for the buyer side. Judges get free tokens from the testnet faucet.
