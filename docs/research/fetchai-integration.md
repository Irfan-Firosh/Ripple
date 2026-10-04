# Ripple × Fetch.ai: requirements, judging criteria and integration plan

Written 2026-10-03.

**Sources:**
- [Event page](https://www.fetch.ai/events/mhacks-2026)
- [MHacks 2026 hackpack](https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack)
- [Agentverse](https://agentverse.ai)
- [ASI:One docs](https://docs.asi1.ai/documentation/getting-started/overview)
- [Fetch.ai docs](https://www.fetch.ai/docs)

**Prize ("Best Use of Fetch.ai"):**

| Place | Prize |
| --- | --- |
| 1st | **$1,250** + internship interview |
| 2nd | **$750** + internship interview |
| 3rd | **$500** + internship interview |

**Perk:** the code `MHACKS26MHACKS26AV` gives one month of Agentverse Premium and ASI:One Pro.

## Role in Ripple

Fetch.ai is **the front door and the orchestration layer**. A user opens ASI:One, talks to the Ripple agent, pastes a draft, and gets the prediction back **in the chat**.

The agents are a thin layer over what already exists:
- `backend/twins`: twins, niches, Ask-the-twin;
- SpacetimeDB `ripple-mhacks`: live state and the simulation.

The web dashboard is the visual extra. It is **not** the required path.

```
ASI:One chat ──Chat Protocol──▶ Ripple Orchestrator (uAgent, registered on Agentverse via mailbox)
                                  ├─▶ Audience agent   → twins: "who in my audience cares about X?"
                                  ├─▶ Simulation agent → policy (ask each twin) + cascade in SpacetimeDB → reach range
                                  └─▶ Payment Protocol → e.g. first simulation free, A/B comparisons paid
SpacetimeDB ripple-mhacks ──subscriptions──▶ /dashboard ("watch it spread" link in the reply card)
```

**Code location (planned):** `backend/agents/`, a uAgents package importing the `twins` library. It runs locally and connects to Agentverse through the **mailbox**, so it needs no public host.

## Mandatory requirements (all needed to qualify)

| Requirement (hackpack wording) | Ripple plan | Status |
| --- | --- | --- |
| "Register at least one agent on Agentverse" | Orchestrator, Audience and Simulation agents, each registered | Not started |
| "Implement the Agent Chat Protocol (ACP)" | Orchestrator implements ACP; it is the ASI:One entry point | Not started |
| "Be discoverable and directly usable through ASI:One" | Clear agent name, description and README so ASI:One routes "test my post" requests to it | Not started |
| "Demonstrate meaningful tool execution or multi-agent orchestration" | Orchestrator → Audience and Simulation agents → `twins` tools + SpacetimeDB reducers | Not started; the tools exist (`ask_twin`, `load_audience`, twin build) |
| "Complete the primary user workflow entirely within an ASI:One conversation" | The draft goes in and reach, top niches, top responders and reasons come back **as the chat reply**; the dashboard link is optional | Not started |
| "Submit a public GitHub repository with instructions to run or test the project" | `github.com/Irfan-Firosh/Ripple` with run instructions in the README | The repo exists; instructions still to write |

## Judging criteria (official weights) and how Ripple scores

| Criterion | Weight | What judges look for (hackpack wording) | How Ripple earns it |
| --- | --- | --- | --- |
| Functionality & Technical Implementation | **25%** | "Does the agent system work as intended? Are the agents properly communicating and reasoning in real time?" | A working draft → reply loop in ASI:One. Agents message each other. Twins answer in seconds; build and simulation progress stream through SpacetimeDB. |
| Use of Fetch.ai Technology | **20%** | "Are agents registered on Agentverse? Is the Chat Protocol implemented for ASI:One discoverability? Is the Payment Protocol integrated to enable monetisation?" | Three registered agents, ACP on the Orchestrator, and the **Payment Protocol** for paid simulations or A/B comparisons. Don't skip payment: the criterion names it. |
| Innovation & Creativity | **20%** | "How original or creative is the solution?" | Test a post on a **digital twin of your real audience** before posting: 95 Claude-built twins from scraped X data, with a cascade simulation. |
| Real-World Impact & Usefulness | **20%** | "Does the solution solve a meaningful problem? How useful would this be to an end user?" | Creators and brands avoid posts that flop. Live demo on @spacetimedb's real audience. |
| User Experience & Presentation | **15%** | "Is the solution presented clearly with a well-structured demo? Is there a smooth and intuitive user experience?" | **Interactive Cards** with the reach range, top niches and "compare another draft". A one-tap link to the live dashboard. A tight 3–5 min video. |

**Bonus considerations (hackpack):**
- multi-agent collaboration;
- Payment Protocol with a monetisation model;
- **ASI Interactive Cards**;
- reliability and error handling;
- real-time data and external services;
- post-hackathon viability.

Ripple's SpacetimeDB live state and its real scraped X data map directly onto "real-time data and external services".

## README requirements (repo root)

- Agent **name** and **address** for every registered agent.
- Extra resources needed, with links.
- Badges:
  - `![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)`
  - `![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)`

## Submission steps

1. **Devpost:** submit the project as usual.
2. **MHacks ASI:One Submission Agent:** see [mhacks-2026-prizes.md](mhacks-2026-prizes.md#fetchai-submission-steps-from-the-official-doc) for the full flow. The lead creates the team, and teammates join with the Team ID. For bonus points, fill in the Agentverse agent URLs and the ASI:One shared-chat URLs.
3. **Demo video:** 3–5 minutes.

## Build order

1. **Orchestrator agent (qualifies on its own):**
   - ACP and an Agentverse mailbox.
   - Answers "how would my audience react to this draft?" by asking the most relevant twins through `twins.ask_twin`.
   - Replies in chat with a short summary plus a dashboard link.
2. **Simulation:**
   - policy: ask every twin about the draft, which gives `edge_prob`;
   - a cascade tick reducer in SpacetimeDB;
   - exposed as the Simulation agent, so the chat returns real reach numbers.
3. **Interactive Cards** (results and "compare drafts") and the **Payment Protocol**.
4. **Paperwork:** README badges and addresses, a public ASI:One shared chat, the demo video, and registration through the Submission Agent.
