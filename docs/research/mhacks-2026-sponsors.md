# MHacks 2026 — sponsor identities and Fetch.ai reference

> **Update 2026-10-03:** the official prize list is out. See [mhacks-2026-prizes.md](mhacks-2026-prizes.md). It supersedes the guessed prize tables below. Notably, Freesolo is not a prize, and Relay, Figma and side quests are. Sponsor identities and the tech notes here are still valid.

Researched 2026-09-30 for the Ripple project. MHacks 2026 runs **Oct 3–4, 2026, Ann Arbor, 24 hours** ([mhacks.org](https://www.mhacks.org/)), with "over $40,000 in prizes" ([fetch.ai event page](https://www.fetch.ai/events/mhacks-2026)).

**Unverified:** the official per-sponsor prize list. `mhacks.org/prizes` sits behind a login, and no MHacks 2026 Devpost page loaded. Prizes marked "typical" are what that sponsor offered at _other_ hackathons. Confirm at the sponsor tables on day one.

## Sponsor wall: identification

Sponsors were identified from the logos and the links on mhacks.org.

| Logo                          | Entity                                                           | What it is                                                                |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| fetch.ai                      | [Fetch.ai](https://fetch.ai) (Premier sponsor)                   | Agent platform: uAgents, Agentverse, ASI:One                              |
| University of Michigan        | Host ("Envision" sponsor)                                        | —                                                                         |
| notability                    | [Notability](https://notability.com) (Ginger Labs)               | Note-taking app, AI study features                                        |
| FREE WILi²                    | [Free-Wili](https://freewili.com)                                | Open-hardware handheld dev multitool (RP2350, ESP32-C5, FPGA), Python API |
| aws                           | [AWS](https://aws.amazon.com)                                    | Cloud, Bedrock                                                            |
| Capital One                   | Capital One                                                      | Bank; usually runs "Best Financial Hack"                                  |
| Meta                          | Meta                                                             | Llama, Ray-Ban Meta                                                       |
| DE Shaw & Co                  | D. E. Shaw & Co.                                                 | Quant/tech firm (recruiting)                                              |
| SpaceX                        | SpaceX (logo links to **x.ai**)                                  | Recruiting; links to xAI / Grok                                           |
| council (purple dotted heart) | [Health Council](https://council.health)                         | Healthcare LLM API                                                        |
| NEON                          | [Neon](https://neon.com)                                         | Serverless Postgres                                                       |
| Photon                        | [Photon](https://photon.codes)                                   | Spectrum SDK: AI agents in iMessage / WhatsApp / Slack                    |
| Freesolo                      | [Freesolo](https://freesolo.co) (YC)                             | Post-training (SFT/RL) of small models on your data                       |
| Blue smiling speech bubble    | [Relay](https://relayapp.im)                                     | Chat app for talking to AI agents (confirmed from `/sponsors/relay.png`)  |
| TechSmith                     | TechSmith                                                        | Camtasia / Snagit (async video)                                           |
| SpacetimeDB                   | [SpacetimeDB](https://spacetimedb.com)                           | Database with built-in app logic and real-time subscriptions              |
| SCM                           | [Stevens Capital Management](https://www.scm-lp.com/internships) | Quant hedge fund (recruiting)                                             |
| salesforce                    | Salesforce                                                       | CRM / Agentforce                                                          |
| ElevenLabs                    | [ElevenLabs](https://elevenlabs.io)                              | Voice AI                                                                  |

## Fetch.ai: the primary target

- **Prizes:**
  - The event page lists **$1,250 / $750 / $500 plus internship interviews** ([fetch.ai/events/mhacks-2026](https://www.fetch.ai/events/mhacks-2026)). The [hackpack](https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack) shows only "Best Use of Fetch.ai – 1st Prize", with no amount.
  - In 2025 these were three separate tracks: Best Use of Fetch.ai, Best Deployment on Agentverse, and Best Use of ASI:One ([2025 page](http://fetch.ai/events/m-hacks)).
  - Promo code `MHACKS26MHACKSAV` gives one month of ASI:One Pro and Agentverse Premium.
- **Challenge:** build an agent that is discoverable through ASI:One, understands what the user wants, and takes meaningful multi-step action on a real problem. It must be "more than a chatbot or a thin wrapper around an API."
- **Mandatory:**
  - At least one agent registered on Agentverse.
  - The **Agent Chat Protocol** implemented.
  - Discoverable and usable through ASI:One.
  - Meaningful tool execution or multi-agent orchestration.
  - **The complete primary workflow runs inside an ASI:One conversation, with no custom frontend required.**
  - A public GitHub repo.
- **Bonus:**
  - Multi-agent collaboration.
  - The **Payment Protocol** with a credible monetization model.
  - **ASI Interactive Cards.**
  - Reliability and recovery from failed tool calls.
  - Real-time data.
  - An agent that could keep running after the hackathon.
- **Judging:**

  | Criterion                 | Weight |
  | ------------------------- | ------ |
  | Functionality / technical | 25%    |
  | Use of Fetch.ai tech      | 20%    |
  | Innovation                | 20%    |
  | Real-world impact         | 20%    |
  | UX / presentation         | 15%    |

- **Deliverables (Devpost):**
  - A public ASI:One shared-chat URL.
  - Agentverse profile URL(s).
  - The GitHub repo, whose README carries the `innovationlab` and `hackathon` badges plus the agent names and addresses.
  - A 3–5 minute demo video.
  - A short description: problem, users, outcome.
- **Docs:**
  - [Chat Protocol](https://innovationlab.fetch.ai/resources/docs/agent-communication/agent-chat-protocol): `uagents_core.contrib.protocols.chat`, `ChatMessage` + `ChatAcknowledgement`.
  - [Interactive Cards](https://innovationlab.fetch.ai/resources/docs/interactive-cards/asi-interactive-cards): `MetadataContent` with `card_kind` set to carousel, detail, form, review or custom, plus a JSON `card_payload`.
  - [Payment Protocol](https://innovationlab.fetch.ai/resources/docs/agent-transaction/agent-payment-protocol): `RequestPayment`, then `CommitPayment` / `RejectPayment`, then `CompletePayment`. Stripe and Skyfire are among the payment methods. Two doc versions assign the buyer/seller roles differently, so check against the current docs.
  - Examples: [fetchai/innovation-lab-examples](https://github.com/fetchai/innovation-lab-examples). See `fetch-hackathon-quickstarter/` (start here), `news-card-agent/` (cards) and `stripe-horoscope-agent/` (payments).
  - Agentverse MCP: `https://mcp.agentverse.ai/sse`.
- **What won before:**
  - MHacks 2025, 1st: MobiLens (accessibility assistant) and deCluttered.ai (photo in, items priced and listed, with agents negotiating via AgentMail).
  - Cal Hacks 12: Orbit (voice workflow automation) and Homes AI (nine coordinated agents that call realtors).
  - The pattern: **multi-agent systems, a real workflow, live APIs or voice or payments, and a polished demo.**

_Sponsor-fit and prize tables were removed on 2026-10-03. They're superseded by [mhacks-2026-prizes.md](mhacks-2026-prizes.md) and [ripple-winning-plan.md](ripple-winning-plan.md)._
