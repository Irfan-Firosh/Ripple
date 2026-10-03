# Ripple — design spec

**Status:** approach approved 2026-09-30 (agent-native core plus web visualizer, with sponsor extras). The detailed design sections have not been reviewed yet.
**Event:** MHacks 2026, Oct 3–4, Ann Arbor (24h).
**Architecture diagram (Lucid):** https://lucid.app/lucidchart/46537ebb-3bd3-4bfa-b18e-1fa36712627d/view
**Research:** [`docs/research/mhacks-2026-sponsors.md`](../docs/research/mhacks-2026-sponsors.md), [`docs/research/ripple-fact-check.md`](../docs/research/ripple-fact-check.md).

## 1. Pitch

> **Ripple lets you test a post on a digital twin of your social network before you test it on real people.**

You give Ripple 2–3 candidate posts and a Bluesky handle. It builds behavioral twins of the accounts in your audience graph, then runs many Monte Carlo cascades. For each draft it reports:

- the reach distribution,
- which communities the post is likely to enter,
- which bridge accounts carry it across, and
- _why_, with per-account explanations.

It can also answer counterfactual questions: what is the smallest change to the hook that lets this post escape its niche?

## 2. Principles

1. **Agents are the product.** The complete primary workflow runs inside an ASI:One chat. This is a mandatory Fetch.ai requirement. The web app and iMessage are extra surfaces over the same agents, so neither is required.
2. **Use the right tool at each layer.**
   - LLMs profile accounts and content _once_.
   - A small trained model scores P(action | author, content, context) thousands of times.
   - The diffusion engine is deterministic probabilistic code, not an LLM.
3. **Use Bluesky, not X.** Bluesky's follower, repost and like data is free and public, and X's terms forbid per-person profiling. See the fact-check.
4. **Report honestly.**
   - Output distributions and rankings (B > A > C), not point estimates.
   - Every accuracy number comes from a leakage-free backtest against baselines.
   - Never claim to recreate a platform's feed algorithm.
5. **Respect privacy.**
   - Model only observable public behavior.
   - Infer no sensitive attributes.
   - Show aggregates.
   - Don't publish per-person profiles.

## 3. Surfaces

| Surface                       | Role                                                                                                                                     | Sponsor     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **ASI:One chat**              | Primary surface. Takes drafts, runs simulations, and shows results, explanations, counterfactuals and payment through Interactive Cards. | Fetch.ai    |
| **Web app "Watch it spread"** | A live network that lights up as each cascade unfolds. Built for the demo and the overall judges. ASI:One cards link to it.              | SpacetimeDB |
| **iMessage**                  | Text 2–3 drafts and get back the winner, a one-line reason, and a link.                                                                  | Photon      |

## 4. Agents (all registered on Agentverse)

| Agent               | Responsibility                                                                                                                                                                                                                            | Tools / sponsors                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Orchestrator**    | Chat Protocol entry point. Parses intent, plans the run, calls the other agents, renders Interactive Cards (form, carousel, detail, review), and runs the Payment Protocol (per-simulation charge). Recovers from failed sub-agent calls. | Fetch.ai uAgents, ACP, Cards, Payment Protocol |
| **Graph Builder**   | Pulls the follower graph within N hops of the user plus each account's recent engagements from Bluesky. Runs community detection (Leiden/Louvain) and computes centrality and bridge scores.                                              | Bluesky public API / Jetstream, Neon           |
| **Twin Profiler**   | One LLM pass per account, producing a structured profile: topic affinity, format and tone preferences, reply/repost/quote rates, activity windows, and network role. Cached.                                                              | AWS Bedrock or Llama, Neon (pgvector)          |
| **Content Analyst** | Turns each draft (text, image or video) into features: topics, format, hook type, tone, novelty.                                                                                                                                          | Multimodal LLM (Llama / Bedrock)               |
| **Simulator**       | Runs a Monte Carlo cascade, about 200 runs per draft. At each step it decides exposure, scores each account with the policy model, samples actions, and propagates. Streams step state live.                                              | Freesolo-trained model, SpacetimeDB, AWS       |
| **Backtester**      | Replays historical posts using only data from before each post. Compares the simulation with real cascades and reports accuracy against baselines.                                                                                        | Neon, Bluesky datasets                         |

## 5. Request flow

1. The user sends drafts A, B and C plus a handle in ASI:One. The Orchestrator answers with a **form card** to confirm the target audience and the number of runs.
2. The Orchestrator issues a `RequestPayment` (per run), and the user commits.
3. The Graph Builder loads the graph from cache or Bluesky. The Twin Profiler fills in missing twins. The Content Analyst extracts features from the drafts.
4. The Simulator runs the cascades for each draft and streams every step to SpacetimeDB. The web view subscribes and lights up live.
5. The Orchestrator sends back:
   - a **carousel card** comparing A/B/C (median reach, P(reach > X), community penetration),
   - **detail cards** for the bridge accounts,
   - a **"why did this account repost?"** detail card (feature contributions),
   - a **counterfactual form card**: edit the hook and re-run.
6. Optional: ElevenLabs reads a 30-second audio briefing.
7. After the post goes live, Ripple compares real engagement against the prediction and recalibrates the twins. This closes the loop.

## 6. Model and simulation

- **Policy model.** P(ignore, like, reply, repost, quote | author twin, content features, social context). It is a small model trained (SFT) on **Freesolo** using real Bluesky engagement events.
- **Social context features:**
  - number of exposures,
  - how many peers the account interacts with have already engaged,
  - relationship strength,
  - recency,
  - saturation.
- **Social proof** is a fitted hypothesis, not an assumed law.
- **Diffusion.** An Independent Cascade variant with timesteps, activity windows, repeated exposure and saturation. It runs until the cascade dies, then reports distributions across runs.
- **Explanations.** Per-agent feature attributions (for example SHAP-style) with counterfactual re-scoring of a single agent.

## 7. Calibration (makes or breaks credibility)

- **Data:** live Bluesky history, plus the Zenodo Bluesky dataset and Hugging Face Bluesky datasets.
- **Protocol:** for each historical post, hide everything after its timestamp, simulate it, and compare with what actually happened.
- **Metrics:** pairwise A-vs-B accuracy, reach-rank correlation, and community-penetration error.
- **Baselines** the simulation must beat, or we say so:
  - follower count,
  - the author's median engagement,
  - a text-only classifier.
- Show a **"Digital twin accuracy"** panel in both the chat and the web app. Use only real numbers.

## 8. Sponsor map

| Tier         | Sponsor                                                                                                | Use                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Core         | Fetch.ai                                                                                               | Six agents, ACP, Interactive Cards, Payment Protocol, Agentverse, ASI:One                        |
| Core         | Freesolo                                                                                               | Trains the policy model                                                                          |
| Extra        | SpacetimeDB                                                                                            | Live simulation state powering "Watch it spread"                                                 |
| Extra        | Photon                                                                                                 | iMessage front door to the Orchestrator                                                          |
| Supporting   | Neon                                                                                                   | Long-term storage (graph, twins, history, backtests) and pgvector                                |
| Supporting   | AWS                                                                                                    | Hosts the agents and simulation workers; Bedrock LLMs                                            |
| Supporting   | Meta                                                                                                   | Llama for profiling and content analysis, and possibly the base model for the Freesolo fine-tune |
| Supporting   | ElevenLabs                                                                                             | Audio briefing                                                                                   |
| Out of scope | SpaceX/xAI, Free-Wili, Relay, Capital One, TechSmith, Notability, Council, Salesforce, D. E. Shaw, SCM | No honest fit; see research                                                                      |

## 9. Build order

1. **Fetch.ai core.** The Orchestrator plus stubs for the other agents, running end to end in ASI:One with cards. Mandatory, so it comes first.
2. Graph Builder and Twin Profiler on real Bluesky data; Neon storage.
3. Simulator with a heuristic policy, then swap in the Freesolo-trained model.
4. Backtester and the accuracy panel.
5. Web "Watch it spread" view on SpacetimeDB.
6. Photon iMessage, Payment Protocol polish, ElevenLabs briefing.

## 10. What winning needs (checklist)

**Fetch.ai eligibility (mandatory):**

- [ ] At least one agent on Agentverse (we register six).
- [ ] Agent Chat Protocol implemented.
- [ ] Discoverable and usable in ASI:One.
- [ ] The complete primary workflow works **in the ASI:One chat alone**.
- [ ] Public GitHub repo; README carries the `innovationlab` and `hackathon` badges plus agent names and addresses.
- [ ] Devpost submission with the public ASI:One shared-chat URL, Agentverse profile URLs, a 3–5 minute demo video, and a description (problem, users, outcome).

**Fetch.ai bonus points:**

- [ ] Multi-agent collaboration.
- [ ] Payment Protocol with a credible model (pay per simulation run).
- [ ] Interactive Cards.
- [ ] Retries and fallbacks when an agent call fails.
- [ ] Real-time data (Bluesky Jetstream).
- [ ] Keeps running after the hackathon.

**Freesolo:**

- [ ] The policy model is trained on Freesolo, and its gain over the baselines is shown.

**Overall and demo:**

- [ ] A 5-second "aha": draft A dies in one cluster, draft B crosses a bridge, and a new cluster lights up.
- [ ] Click any account to see why it reposted, then run a counterfactual.
- [ ] Real backtest numbers on screen.

**Day one:**

- [ ] Confirm the actual 2026 sponsor tracks at the tables, especially Freesolo, SpacetimeDB, Photon and Meta.
- [ ] Ask Fetch.ai mentors whether a link out to the web view is acceptable.

## 11. Risks

| Risk                                                  | Mitigation                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pre-post prediction is inherently noisy               | Output distributions and rankings, and lead with pairwise accuracy                     |
| Bluesky API rate limits are undocumented              | Cache in Neon, cap graph hops, pre-build the demo graph                                |
| Freesolo or other sponsor tracks may not be at MHacks | Keep the core judged on Fetch.ai; treat other sponsors as upside                       |
| Too many integrations look like bolt-ons              | Follow the build order; every sponsor has a concrete job                               |
| Ethics questions from judges                          | Lead with: public behavior only, aggregates, opt-out respected, twin your own audience |
