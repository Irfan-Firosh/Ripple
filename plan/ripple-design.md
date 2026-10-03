# Ripple — design spec

**Status:**

- Core approach approved 2026-09-30: agent-native core, web visualizer, sponsor extras.
- **Discover** design approved section by section on 2026-10-02 (flow, scouts, output, depth and watchlists).
- No pricing anywhere; this is a hackathon build.

**Event:** MHacks 2026, Oct 3–4, Ann Arbor (24h).
**Architecture diagram (Lucid, v2 with Discover):** https://lucid.app/lucidchart/c3e5f176-6b43-4ed2-b8c6-d4779257bf4d/view (v1, superseded: https://lucid.app/lucidchart/46537ebb-3bd3-4bfa-b18e-1fa36712627d/view)
**Research:** [`mhacks-2026-sponsors.md`](../docs/research/mhacks-2026-sponsors.md), [`ripple-fact-check.md`](../docs/research/ripple-fact-check.md), [`probe-analysis.md`](../docs/research/probe-analysis.md).

## 1. Pitch

> **Ripple lets you test a post on a digital twin of your social network before you test it on real people.**

Ripple is one loop: **Discover → Draft → Simulate → Post → Recalibrate.**

1. **Discover.** A Probe-style scout swarm researches a topic across the public social web: Bluesky, X via Grok, Reddit, YouTube, Hacker News and the web. It maps what it finds onto _your_ audience's communities: rising narratives, ★ bridge topics shared by several of your communities, hooks that work, and unanswered gaps. Everything is cited.
2. **Draft.** Ripple turns any narrative, bridge topic or gap into 2–3 candidate posts.
3. **Simulate.** Ripple builds behavioral twins of the accounts in your Bluesky audience graph and runs many Monte Carlo cascades. For each draft it reports:
   - the reach distribution,
   - which communities it is likely to enter,
   - which bridge accounts carry it, and
   - _why_, with per-account explanations and counterfactuals ("what is the smallest change to the hook that escapes your niche?").
4. **Post and recalibrate.** Ripple compares what actually happened with its prediction and updates the twins.

## 2. Principles

1. **Agents are the product.** The complete primary workflow runs inside an ASI:One chat; this is a mandatory Fetch.ai requirement. The web app and iMessage are extra surfaces over the same agents.
2. **Use the right tool at each layer.**
   - LLMs profile accounts and content _once_.
   - A small trained model scores P(action | author, content, context) thousands of times.
   - The diffusion engine is deterministic probabilistic code, not an LLM.
   - The scouts use LLM tools, but only for search and synthesis.
3. **Pick data sources by use.**
   - The audience graph and twins come from **Bluesky** (free and public).
   - **X** is used only through Grok `x_search`, for _aggregate_ narrative signal. Never use it for a follower graph or a per-person profile.
   - Source limits are in [`probe-analysis.md`](../docs/research/probe-analysis.md).
4. **Report honestly.**
   - Distributions and rankings (B > A > C), not point estimates.
   - Accuracy numbers come only from a leakage-free backtest against baselines.
   - Every Discover claim is cited.
   - The coverage line says when scouts failed.
   - Never claim to recreate a platform's feed algorithm.
5. **Respect privacy.**
   - Use only observable public behavior.
   - Infer no sensitive attributes.
   - Show aggregates.
   - Don't publish per-person profiles.

## 3. Surfaces

| Surface          | Role                                                                                                                                                                                                                | Sponsor     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **ASI:One chat** | Primary surface. Runs the whole loop through Interactive Cards: Discover scoping, narrative carousel, drafts, simulation results, explanations, counterfactuals.                                                    | Fetch.ai    |
| **Web app**      | The **Discover** page (live scout grid, narrative map, brief) and **Watch it spread** (a live network that lights up as each cascade unfolds). Built for the demo and the overall judges. ASI:One cards link to it. | SpacetimeDB |
| **iMessage**     | Text 2–3 drafts and get back the winner plus a one-line reason. Receive watchlist alerts.                                                                                                                           | Photon      |

## 4. Agents (all registered on Agentverse)

| Agent                 | Responsibility                                                                                                                                                                                                                    | Tools / sponsors                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Orchestrator**      | Chat Protocol entry point. Parses intent, plans each stage, calls the other agents, renders Interactive Cards (form, carousel, detail, review), and recovers from failed sub-agent calls.                                         | Fetch.ai uAgents, ACP, Interactive Cards                                              |
| **Discovery Planner** | Turns a question plus the scoping answers into a scout plan: source × angle pairs, time window, target communities. Depth sets the fan-out.                                                                                       | LLM                                                                                   |
| **Scouts** (parallel) | One source × one angle each. Runs a few searches and returns findings with citations and metadata (engagement, timestamp, link).                                                                                                  | Bluesky API, xAI Grok `x_search` / `web_search`, Reddit, YouTube Data API, HN Algolia |
| **Synthesizer**       | Removes duplicates, clusters findings into narratives, scores how fast each is rising, extracts hooks, formats, sentiment and gaps, and maps narratives onto the user's communities (★ bridge topics).                            | LLM, Neon pgvector                                                                    |
| **Watchlist**         | Re-runs saved scout plans at Scan depth on a schedule. Alerts when a narrative speeds up or reaches a new community.                                                                                                              | Neon, Photon, ASI:One                                                                 |
| **Graph Builder**     | Pulls the follower graph within N hops of the user plus each account's recent engagements from Bluesky. Runs community detection (Leiden/Louvain) and computes centrality and bridge scores.                                      | Bluesky public API / Jetstream, Neon                                                  |
| **Twin Profiler**     | One LLM pass per account, producing a structured profile: topic affinity, format and tone preferences, reply/repost/quote rates, activity windows, network role. Cached. Also produces per-community topic profiles for Discover. | AWS Bedrock or Llama, Neon (pgvector)                                                 |
| **Content Analyst**   | Turns each draft (text, image or video) into features: topics, format, hook type, tone, novelty. Keeps the Discover evidence each draft came from.                                                                                | Multimodal LLM (Llama / Bedrock)                                                      |
| **Simulator**         | Runs Monte Carlo cascades, about 200 per draft: exposure, policy-model scoring, sampled actions, propagation. Streams step state live.                                                                                            | Freesolo-trained model, SpacetimeDB, AWS                                              |
| **Backtester**        | Replays historical posts using only data from before each post. Compares the simulation with real cascades and reports accuracy against baselines.                                                                                | Neon, Bluesky datasets                                                                |

## 5. Request flow

1. **Ask.** The user asks about a topic in ASI:One, for example "AI agents for small business", and gives their Bluesky handle once.
2. **Scope.** A **form card** asks:
   - which of your communities to focus on (the communities the Graph Builder found),
   - the goal (reach, a specific community, or replies),
   - the time window (24h, 7d or 30d),
   - the depth (Scan, Deep or Swarm).
3. **Discover.** The Discovery Planner fans out the Scouts in parallel. Chat shows progress ("9/16 scouts done…"), and the web scout grid fills in live. The Synthesizer builds the brief (§6.3).
4. **Pick.** A **carousel card** shows the narratives, bridge topics first. Tapping one opens a **detail card** (heatmap row, hooks, citations) with **"Draft 3 posts"** and **"Watch this topic"** buttons.
5. **Draft.** A **review card** shows drafts A/B/C, each linked to its evidence. The user can edit them or paste their own.
6. **Simulate.** The Graph Builder, Twin Profiler and Content Analyst prepare the run. The Simulator streams to SpacetimeDB, and the web view lights up live.
7. **Results.**
   - A **carousel card** comparing A/B/C: median reach, P(reach > X), community penetration.
   - **Detail cards** for the bridge accounts.
   - A **"why did this account repost?"** card. Explanations can cite Discover, e.g. "B rides the ★ pricing-pain bridge topic".
   - A **counterfactual form card**: edit the hook and re-run.
8. Optional: ElevenLabs reads a 30-second audio briefing.
9. **Post and recalibrate.** After the post goes live, Ripple compares real engagement with the prediction and updates the twins.

## 6. Discover (detail)

### 6.1 Depth

| Depth | Scouts                                                | Use                               |
| ----- | ----------------------------------------------------- | --------------------------------- |
| Scan  | 1: Bluesky narratives                                 | Quick check; watchlists           |
| Deep  | 4: Bluesky, X and Reddit narratives, plus Reddit gaps | Default                           |
| Swarm | 16: the full matrix below                             | Demo moment; the whole grid fills |

### 6.2 Swarm scout matrix (16)

| Angle                 | Bluesky | X (Grok) | Reddit | YouTube      | HN         | Web |
| --------------------- | ------- | -------- | ------ | ------------ | ---------- | --- |
| Rising narratives     | ✓       | ✓        | ✓      |              | ✓          | ✓   |
| Hooks that work       | ✓       | ✓        |        | ✓            |            |     |
| Open questions / gaps | ✓       |          | ✓      | ✓ (comments) | ✓ (Ask HN) |     |
| Sentiment             | ✓       | ✓        |        |              |            |     |
| Formats               |         |          |        | ✓            |            | ✓   |

**Community mapping:**

- Each narrative's topic embedding is stored in Neon pgvector.
- Each community's topic profile is the aggregate of its members' twins.
- A narrative's score for a community is the similarity between the two.
- A narrative that scores above a threshold in **two or more** communities is a **★ bridge topic**.

### 6.3 The brief

One data object, rendered on the web and in cards, in this order:

1. Summary (three sentences).
2. Rising narratives: 5–8, each with rise rate, sources, sentiment, and 2–3 cited example posts.
3. ★ Bridge topics, with per-community scores.
4. Community × topic heatmap.
5. Hooks and formats that work.
6. Gaps: unanswered questions, each with its source thread.
7. Numbered sources.
8. Coverage line, e.g. "16/16 scouts · 412 posts · 7d".

**Web Discover page layout:**

- Left: the live scout grid.
- Right: the narrative map. Your communities are the large shapes; narratives are nodes placed between the communities they belong to and sized by rise rate; bridge topics are starred. It reuses the visual language of `frontend/src/visuals/NetworkCanvas.tsx`.
- Below: the brief, with "Draft from this" on every narrative, bridge topic and gap.

### 6.4 Watchlists

- **Save:** "Watch this topic" saves the scout plan (topic, communities, window) to Neon.
- **Re-run:** the Watchlist agent re-runs it at Scan depth, hourly during the event.
- **Alert:** when the rise rate more than doubles, or the narrative reaches a new community of yours. Alerts go to ASI:One, iMessage (Photon) and a web badge, and each offers "Draft from this".

### 6.5 Limits and guardrails

- **YouTube:**
  - `search.list` is capped at **100 calls/day**, so cache searches per topic per day.
  - Spend the 10k-unit pool on `videos.list` and `commentThreads.list`.
- **Hacker News:**
  - Algolia caps each query at **1,000 hits**, so split long windows.
  - The rate limit is undocumented, so add backoff.
- **Grok tools:**
  - About 50–80 calls per Swarm (an estimate).
  - Keep a per-run call cap.
  - Never send per-person queries.
- **Reddit:** stay under the 100 queries/minute limit.

### 6.6 Error handling

- **Scout failures:**
  - Each scout retries once with backoff. If it still fails, its grid tile turns grey.
  - The brief always states its coverage.
  - The Synthesizer runs on partial results whenever at least half the scouts reported. Below that, the user gets a clear "not enough coverage, try again / reduce depth" message, never an empty brief.
- **Missing Bluesky audience graph** (new or private handle): Discover still runs. Community mapping is skipped, and the brief says so.
- **Sub-agent call failures:** the Orchestrator times out and recovers, and the chat always gets a message.

### 6.7 Testing

- **Unit tests:**
  - the planner's depth → scout-set mapping;
  - the Synthesizer's clustering, rise-rate and bridge-topic logic on fixed fixture findings;
  - the alert rules.
- **Scout contract tests:** recorded API responses for each source, plus failure and timeout cases.
- **End-to-end test:** a scripted ASI:One conversation through Ask → Scope → Discover → Draft → Simulate, using fixtures so it is deterministic. Plus one live smoke run per source before the demo.
- **Web (Playwright):** the scout grid fills, a failed tile renders grey, "Draft from this" carries the evidence into the drafts, and the page passes the accessibility (axe) checks.

## 7. Model and simulation

- **Policy model.** P(ignore, like, reply, repost, quote | author twin, content features, social context). It is a small model trained (SFT) on **Freesolo** using real Bluesky engagement events.
- **Social context features:**
  - number of exposures,
  - how many peers the account interacts with have already engaged,
  - relationship strength,
  - recency,
  - saturation.
- **Social proof** is a fitted hypothesis, not an assumed law.
- **Diffusion.** An Independent Cascade variant with timesteps, activity windows, repeated exposure and saturation. It runs until the cascade dies, then reports distributions across runs.
- **Explanations.** Per-agent feature attributions (for example SHAP-style), with counterfactual re-scoring of a single agent.

## 8. Calibration (makes or breaks credibility)

- **Data:** live Bluesky history, plus the Zenodo and Hugging Face Bluesky datasets.
- **Protocol:** for each historical post, hide everything after its timestamp, simulate it, and compare with what actually happened.
- **Metrics:** pairwise A-vs-B accuracy, reach-rank correlation, community-penetration error.
- **Baselines** the simulation must beat, or we say so:
  - follower count,
  - the author's median engagement,
  - a text-only classifier.
- Show a **"Digital twin accuracy"** panel in chat and on the web. Use only real numbers.

## 9. Sponsor map

| Tier         | Sponsor                                                                                    | Use                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Core         | Fetch.ai                                                                                   | Ten agent types (scouts run as many parallel instances), ACP, Interactive Cards, Agentverse, ASI:One |
| Core         | Freesolo                                                                                   | Trains the policy model                                                                              |
| Extra        | SpacetimeDB                                                                                | Live simulation state powering "Watch it spread"                                                     |
| Extra        | Photon                                                                                     | iMessage front door and watchlist alerts                                                             |
| Supporting   | xAI (SpaceX logo links to x.ai)                                                            | Grok `x_search` / `web_search` for Discover scouts (aggregate only)                                  |
| Supporting   | Neon                                                                                       | Long-term storage: graph, twins, history, backtests, watchlists, pgvector                            |
| Supporting   | AWS                                                                                        | Hosts the agents and workers; Bedrock LLMs                                                           |
| Supporting   | Meta                                                                                       | Llama for profiling and content analysis; possible base model for the Freesolo fine-tune             |
| Supporting   | ElevenLabs                                                                                 | Audio briefing                                                                                       |
| Out of scope | Free-Wili, Relay, Capital One, TechSmith, Notability, Council, Salesforce, D. E. Shaw, SCM | No honest fit; see research                                                                          |

## 10. Build order

1. **Fetch.ai core.** The Orchestrator plus stubs for the other agents, running end to end in ASI:One with cards. Mandatory, so it comes first.
2. **Discover v1:** Planner, Bluesky and X scouts, a basic Synthesizer, and the narrative carousel in chat, at Deep depth.
3. Graph Builder and Twin Profiler on real Bluesky data; Neon storage; community mapping and bridge topics.
4. Simulator with a heuristic policy, then swap in the Freesolo-trained model. Connect "Draft 3 posts → Simulate".
5. Backtester and the accuracy panel.
6. Web: the Discover page (scout grid, narrative map, brief) and "Watch it spread" on SpacetimeDB.
7. **Discover v2:** Reddit, YouTube, HN and Web scouts (Swarm depth); watchlists.
8. Photon iMessage and the ElevenLabs briefing.

## 11. What winning needs (checklist)

**Fetch.ai eligibility (mandatory):**

- [ ] At least one agent on Agentverse (we register ten agent types).
- [ ] Agent Chat Protocol implemented.
- [ ] Discoverable and usable in ASI:One.
- [ ] The complete primary workflow (Discover → Draft → Simulate) works **in the ASI:One chat alone**.
- [ ] Public GitHub repo; README carries the `innovationlab` and `hackathon` badges plus agent names and addresses.
- [ ] Devpost submission: the public ASI:One shared-chat URL, Agentverse profile URLs, a 3–5 minute demo video, and a description (problem, users, outcome).

**Fetch.ai bonus points:**

- [ ] Multi-agent collaboration (the scout swarm makes this visible).
- [ ] Interactive Cards.
- [ ] Retries and fallbacks when an agent call fails.
- [ ] Real-time data (Bluesky Jetstream, live scouts).
- [ ] Keeps running after the hackathon (watchlists).
- [ ] _Optional, skipped for now:_ Payment Protocol. It can be added later in test mode with no real money if wanted.

**Freesolo:**

- [ ] The policy model is trained on Freesolo, and its gain over the baselines is shown.

**Overall and demo:**

- [ ] Discover runs at Swarm depth, the grid fills, and a ★ bridge topic appears on the narrative map.
- [ ] "Draft 3 posts" and simulate: draft A dies in one cluster, draft B crosses a bridge, and a new cluster lights up.
- [ ] Click any account to see why it reposted, then run a counterfactual.
- [ ] Real backtest numbers on screen.

**Day one:**

- [ ] Confirm the actual 2026 sponsor tracks at the tables, especially Freesolo, SpacetimeDB, Photon, Meta and xAI.
- [ ] Ask Fetch.ai mentors whether a link out to the web view is acceptable.

## 12. Risks

| Risk                                                  | Mitigation                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Pre-post prediction is inherently noisy               | Output distributions and rankings, and lead with pairwise accuracy                |
| Bluesky API rate limits are undocumented              | Cache in Neon, cap graph hops, pre-build the demo graph                           |
| Source quotas (YouTube search 100/day, HN 1k cap)     | Cache per topic per day, split windows, pre-run the demo topic                    |
| A scout source is down during judging                 | Coverage line plus partial briefs; recorded fixtures as a fallback demo path      |
| Freesolo or other sponsor tracks may not be at MHacks | Keep the core judged on Fetch.ai; treat other sponsors as upside                  |
| Too many integrations look like bolt-ons              | Follow the build order; every sponsor has a concrete job                          |
| Ethics questions from judges                          | Public behavior only, aggregates, no per-person X queries, twin your own audience |
