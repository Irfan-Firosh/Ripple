# Ripple: MHacks 2026 winning plan

Written 2026-10-03. It consolidates these decisions:

- [mhacks-2026-prizes.md](mhacks-2026-prizes.md): official prizes, rules, requirements.
- [probe-analysis.md](probe-analysis.md): Discover feature and source limits.
- [ripple-fact-check.md](ripple-fact-check.md): data access, prior art, ethics.
- [mhacks-2026-sponsors.md](mhacks-2026-sponsors.md): sponsor identities and tech notes.
- Design detail: [`plan/ripple-design.md`](../../plan/ripple-design.md). Its sponsor map still lists Freesolo; this plan supersedes that part.

**Hard deadline:**

- Devpost submission: **Sunday Oct 4, 12:00pm EDT**.
- Fetch.ai also needs the ASI:One Submission Agent.
- Judging is in person, science-fair style.

## 0. Current scope and data decisions (2026-10-03)

These override anything below that conflicts with them.

- **Scope: the content _validation_ pipeline only** (graph → twins → policy model → simulator → backtest). The content _generation_ side (Discover scouts, drafting) is **paused**. The user supplies drafts A/B/C directly.
- **Data source: X only, through the xAI console key** (`X_API_KEY=xai-…` in the repo-root `.env`), using Grok `x_search`. **No Bluesky.** We don't have an X developer-console (X API) token.
- **What `x_search` gives** (proven in [`spikes/x-to-spacetime`](../../spikes/x-to-spacetime/README.md)):
  - real posts with author, text, time, and likes / reposts / replies / quotes / views (15/15 URLs verified; counts are Grok-reported);
  - filtering to specific handles (up to 20 per query) and date ranges;
  - thread fetch.
  - About $0.14 per ~15-post call.
- **What it does _not_ give:** a follower graph or "who liked / reposted". Accepted. The audience graph will be built from what X does expose: **reply, quote and mention edges** around the chosen page, plus thread fetches. Whether this yields a dense enough graph is untested.
- **Target:** a **specific X page (account)** to scrape. It is chosen later, and this plan gets updated then.
- **Agents split (2026-10-03):** **Fetch.ai uAgents** run the general agents: Orchestrator/chat, X Scraper, Graph Builder, Policy model, Backtester. **Claude API (Haiku 4.5) twin builder, synced via SpacetimeDB** builds the twins (`backend/twins/`), plus "ask the twin" explanations through the `twin_question` queue. AWS AgentCore was dropped after AWS denied access. See [agentcore-twins.md](agentcore-twins.md).
- **Backend: SpacetimeDB is Ripple's backend**: scraped posts, the graph, twins, drafts, model outputs, the simulation itself (scheduled `tick` reducer) and results. See [spacetime-backend.md](spacetime-backend.md). It's live on Maincloud as `ripple-mhacks`. Neon's role is open.

**Dev infrastructure diagram (Lucid):** https://lucid.app/lucidchart/98e15453-d4db-417a-b9ca-56ab9d30761a/view

## 1. The idea in one breath

> **Ripple lets you test a post on a digital twin of your social network before you test it on real people.**

The loop is **Discover → Draft → Simulate → Post → Recalibrate.** The current build covers **Draft (user-supplied) → Simulate → Recalibrate** (§0).

1. **Discover** _(paused, see §0)_. A swarm of scout agents researches a topic across X (via Grok), Reddit, YouTube, Hacker News and the web. It maps what's rising onto _your_ audience's communities: ★ bridge topics, hooks, gaps. Every claim is cited.
2. **Draft.** Ripple turns a finding into drafts A/B/C.
3. **Simulate.** Behavioral twins of the accounts around a chosen X page run Monte Carlo cascades. Ripple shows which draft escapes your niche and why, and you can hear it: each community "reads" its reactions in its own voice.
4. **Post and recalibrate.** Ripple compares the prediction with reality and updates the twins.

## 2. Prize strategy

**Main track: "Actually Intelligent (AI)".** Only one main track is allowed, and the Grand Prize uses the same rubric, so one build competes for both.

| Tier        | Prize                                                                            | Value                        | Ripple's job for it                                                                                                        | Fit (/5) |
| ----------- | -------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| Core        | Grand Prize                                                                      | $5,000 + ElevenLabs Pro      | Coherent, polished, working loop; the 60-second golden path (§6)                                                           | 4.2      |
| Core        | Actually Intelligent (AI)                                                        | $2,500                       | Multi-agent reasoning, a self-trained policy model, a backtest that beats baselines                                        | 5.0      |
| Core        | Fetch.ai ASI:One Agent Challenge                                                 | $1,250 / $750 / $500         | Ten agent types on Agentverse; the full loop works in the ASI:One chat alone; Interactive Cards                            | 4.5      |
| Core        | Spacetime                                                                        | $1,000 / $500 / $200         | **SpacetimeDB is the backend:** all pipeline state + the simulation runs inside it ([details](spacetime-backend.md))       | 4.0      |
| Surface     | ElevenLabs                                                                       | Scale tier per member        | **Audience voices:** each community has a designed voice that reads its simulated reactions aloud; optional voice briefing | 4.25     |
| Surface     | Relay: Interactive Agents                                                        | SF trip + Relay house week   | Text or call Ripple in the Relay app                                                                                       | 3.0      |
| Surface     | Photon: Agents in iMessage                                                       | $700 + interview fast-track  | iMessage via Spectrum; drafts in, verdicts and watchlist alerts out                                                        | 3.0      |
| Backend     | Neon                                                                             | $1,000 in AI Gateway credits | Durable data plus visible use of branches, auth + RLS, Data API, pgvector, AI Gateway                                      | 4.0      |
| Cheap extra | Figma Best Design                                                                | LEGO / merch                 | Figma design system + prototype; design-to-app parity                                                                      | 3.5      |
| Cheap extra | Notability: Trust the Process                                                    | Pro + merch                  | Plan in Notability Pro; ≥2 screenshots; tag on Devpost                                                                     | 3.5      |
| Cheap extra | Judged by an LLM                                                                 | Mystery                      | A clear, factual Devpost write-up (no prompt tricks)                                                                       | 4.0      |
| Skip        | SpaceXAI, Nessie, FinchNode, FREE-WiLi; Sustainability, FinTech, Beyond the Code | —                            | Off-theme; forcing them in weakens the pitch                                                                               | 1.0      |

**Changes from the earlier spec:**

- **Freesolo is dropped** (not a prize). We train the policy model ourselves.
- **SpacetimeDB moves from extra to core.**
- **Relay is added** as a surface.
- **ElevenLabs grows** from a briefing into audience voices.

**Optional upgrade for Relay and Photon (both 3.0 → ~4):** give Ripple a _social role_ in a creator team's group chat. It notices ideas and offers: "this is a ★ bridge topic, want me to simulate it?". This needs Relay groups or a paid Photon dedicated line. Decide on day one.

## 3. Fit rubric (summary)

MHacks shared rubric for Ripple:

| Criterion            | Score | Gap to close                                                            |
| -------------------- | ----- | ----------------------------------------------------------------------- |
| Innovation           | 4     | Lead with counterfactuals and bridge topics, not "we simulate users"    |
| Technical complexity | 5     | The risk is too much, not too little                                    |
| Usability            | 3     | **The biggest risk.** One scripted 60-second golden path                |
| Theme ("grows")      | 4     | Say "grows" in the pitch: audiences grow, posts ripple, narratives grow |

Per-prize scores are in §2. The full rubric discussion is in the [prize research](mhacks-2026-prizes.md).

## 4. Architecture changes to make

| Area         | Decision                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent core   | Python uAgents on Agentverse for the general agents. Shared logic in `handle_user_message(channel, user, text)`; each surface is a thin adapter. **Twins: Claude API (Haiku 4.5) twin builder, synced via SpacetimeDB** (`backend/twins/` writes `twin` rows through reducers); never called per simulation tick ([agentcore-twins.md](agentcore-twins.md)). |
| Live state   | **SpacetimeDB is the backend** (see [spacetime-backend.md](spacetime-backend.md)): `x_post`, `account`, `interaction`, `twin`, `draft`, `edge_prob`, `sim_run`, `node_state`, `sim_result`, `engagement_snapshot`. A scheduled `tick` reducer runs the cascade in-module. Python agents call reducers over HTTP (proven).                                      |
| Durable data | **Neon:**<br>• graphs, twins, briefs, watchlists, embeddings (pgvector);<br>• Better Auth + RLS for per-user watchlists;<br>• Data API for the web app;<br>• **a branch per what-if simulation**;<br>• **AI Gateway** for all agent LLM calls.<br>Budget the free plan's 0.5 GB.                                                                               |
| Policy model | Trained by us on X engagement data from Grok `x_search`: post-level counts plus reply/quote/mention interactions around the chosen page (a small model such as gradient boosting or a tiny MLP). The backtest against baselines is the "actually intelligent" proof.                                                                                           |
| Surfaces     | **ASI:One** (primary, Cards). **Relay:** Python `relaymessenger` WebSocket task; one token per mode. **Photon:** `spectrum-ts` sidecar; pre-register recipient numbers. **Web:** React + SpacetimeDB subscriptions.                                                                                                                                            |
| Voice        | ElevenLabs Voice Design: one voice per community; TTS of top reactions per draft (`eleven_flash_v2_5` for speed). Optional ElevenAgents briefing call with Ripple as the custom LLM.                                                                                                                                                                           |

## 5. Workstreams (up to 4 people)

| Stream                               | Owns                                                                                                                                    | Prizes it carries                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **A. Agents and Fetch.ai**           | Orchestrator, Cards, the "validate these drafts" ASI:One flow, submission                                                               | Fetch.ai, AI track                                      |
| **B. Simulation and model**          | X scraper (Grok `x_search`), Graph Builder (reply/quote/mention), Twin Profiler, Content Analyst, policy model training, Backtester     | AI track, Grand Prize                                   |
| **C. Real-time and web**             | SpacetimeDB module (tables, reducers, in-module `tick` simulation), "Watch it spread" view, Figma design system                         | Spacetime, Figma, Grand Prize                           |
| **D. Surfaces, backend and process** | Neon (branches, auth, Data API, AI Gateway), Relay adapter, Photon sidecar, ElevenLabs voices, Notability screenshots, Devpost write-up | Neon, Relay, Photon, ElevenLabs, Notability, LLM-judged |

Beads: Discover (`mhacks-dxo`) is **paused**, and the hero redesign (`mhacks-q73`) has stale paths. New beads are needed for: the SpacetimeDB backend module, the X scraper, graph + twins, the policy model, the in-module simulator, Relay, Photon, audience voices, and the submission checklist.

## 6. The 60-second golden path (the demo)

1. **0–10s.** In ASI:One: "Which of these 3 posts will spread furthest with @<chosen page>'s audience?" Paste drafts A/B/C. A form card confirms; tap Simulate.
2. **10–40s.** On a second screen, the network (built from real X replies, quotes and mentions around the page) **lights up live from SpacetimeDB**. Draft A dies inside one community. Draft B crosses a bridge account into another. **Hear it:** that community's voice reads its reaction. Open the same view on a judge's phone; it shows the identical run.
3. **40–50s.** Click a node: "why did this account engage?" Change B's hook and re-run that account: 76% → 31%.
4. **50–60s.** The accuracy panel shows real backtest numbers against baselines. Then text the same request to Ripple on **iMessage or Relay**, and the verdict comes back.

**Fallback:** pre-scrape the demo page and keep recorded fixtures, so the demo works even if Grok or the network is slow.

## 7. Timeline (hour 0 = hacking starts; deadline Sun 12:00pm)

| Hours | Milestone                                                                                                                                                                                                                                                           | Gate                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0–1   | Confirm booth details:<br>• Relay TestFlight + token;<br>• Photon line + numbers;<br>• whether a link out of ASI:One is OK;<br>• ElevenLabs credits.<br>Also: start the Notability Pro trial; create the Neon + SpacetimeDB projects; brief the team from this doc. | Every account works                                    |
| 1–4   | **Walking skeleton:** Orchestrator in ASI:One with cards, using stub agents; SpacetimeDB module with tables; web reads `node_state` and `sim_result`; data contract                                                                                                 | One fake end-to-end run visible in chat and on the web |
| 4–10  | Scrape the chosen X page via Grok `x_search` into SpacetimeDB; Graph Builder (reply/quote/mention edges) + Twin Profiler; in-module `tick` simulation with a heuristic policy                                                                                       | Real graph + real cascade, live                        |
| 10–16 | Train the policy model + run the backtest; Relay adapter; Photon sidecar; audience voices; Neon branch-per-what-if + auth                                                                                                                                           | Every surface answers                                  |
| 16–20 | Counterfactual flow; recalibration snapshots; Figma design pass + MCP capture                                                                                                                                                                                       | The golden path runs end to end                        |
| 20–22 | **Freeze features.** Polish the golden path, cache the demo page, error states                                                                                                                                                                                      | Three clean rehearsals in a row                        |
| 22–24 | Demo video (3–5 min); README with agent names, addresses and badges; Devpost; ASI Submission Agent; Notability screenshots                                                                                                                                          | Everything submitted **before 11:30am**                |

## 8. Submission checklist

- [ ] **Devpost:**
  - track = **Actually Intelligent (AI)**;
  - every sponsor prize ticked: Fetch.ai, Spacetime, Neon, ElevenLabs, Relay, Photon, Figma, Notability, Judged by an LLM;
  - public repo link: `github.com/Irfan-Firosh/Ripple`;
  - demo video;
  - "how we used X" for every sponsor;
  - Notability tag + ≥2 screenshots.
- [ ] **Fetch.ai:**
  - agents on Agentverse, with the README badges `innovationlab` + `hackathon` and agent names and addresses;
  - a public ASI:One shared-chat URL;
  - **the MHacks Submission Agent:** the lead creates the team, then teammates join with the Team ID; fill in the agent URLs and shared-chat URLs for bonus points.
- [ ] **Relay:** the agent works in the Relay app.
- [ ] **Photon:** built on Spectrum; judges' numbers registered.
- [ ] **Figma:** link to the design file + prototype.
- [ ] Repo is public and builds from the README instructions.

## 9. Top risks

| Risk                                               | Mitigation                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Too many integrations; the demo confuses judges    | The golden path first; the feature freeze at hour 20 is real                      |
| SpacetimeDB ↔ Python bridging                      | **Resolved:** HTTP reducer calls proven in the spike                              |
| Relay SDK is v0.1.0 with contradictory docs        | Confirm at the booth in hour 0; Relay is a surface, so drop it if blocked         |
| X graph from replies/quotes/mentions may be sparse | Choose a high-engagement page; pre-scrape; fall back to fixtures                  |
| Pre-post prediction is noisy                       | Show distributions and rankings; lead with pairwise accuracy against baselines    |
| Maincloud free tier (~3M function calls/month)     | Size tick rate × runs × nodes; cap concurrent runs                                |
| Ethics questions                                   | Public behavior only, aggregates, no per-person X queries, twin your own audience |
