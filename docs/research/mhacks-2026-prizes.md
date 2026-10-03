# MHacks 2026: official prizes, rules, and Ripple's strategy

Researched 2026-10-03 from the official prize list and [mhacks-2026.devpost.com](https://mhacks-2026.devpost.com/) ([rules](https://mhacks-2026.devpost.com/rules)). This **supersedes the guessed prize tables** in [mhacks-2026-sponsors.md](mhacks-2026-sponsors.md). Sponsor identities and the tech research there are still valid.

**V** = verified at the source. **U** = unverified.

## Rules that shape strategy (V)

- **Team size:** up to 4. Each person can be on only one project.
- **Main tracks: a team may submit to only ONE MHacks track.** It can enter **as many sponsor tracks as it likes**.
- **Shared rubric:** every MHacks prize uses one 4-point rubric, with no weights and no separate criteria for the Grand Prize.
  - **Innovation:** originality, real-world need.
  - **Technical Complexity:** depth, robustness, scalability.
  - **Usability:** intuitiveness, accessibility, impact.
  - **Adherence to Theme.** The 2026 theme is "build something that grows".
- **Deadline:** Sunday **Oct 4, 12:00pm EDT**. The Devpost header says 12:15. Use 12:00.
- **Demo:** in person, science-fair style. Stay at your table during judging.
- **Work rules:**
  - The project must be substantially built during the event. AI tools are allowed.
  - The code must be accessible, through a public repo.
  - No double-submitting to another hackathon that weekend.
- Whether one team can win both the Grand Prize and a track is not stated (U).

## Prize list and Ripple fit

| Prize                                              | Value                                                     | Requirement (summary)                                                                                                                                     | Fit         | Minimum to qualify / how to win                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grand Prize**                                    | $5,000 + 3 months of ElevenLabs Pro per member            | Shared rubric                                                                                                                                             | ★★★         | A coherent, polished, working demo. The visual "aha" plus real numbers.                                                                                                                                          |
| **Actually Intelligent (AI)** (our one main track) | $2,500                                                    | No published description. The name implies AI that does real work, not a wrapper (U).                                                                     | ★★★         | Multi-agent system, a trained policy model, a backtest beating baselines.                                                                                                                                        |
| Sustainability / FinTech / Beyond the Code         | $2,500 each                                               | Only one main track is allowed                                                                                                                            | ✗           | Skip. AI is the honest fit.                                                                                                                                                                                      |
| **Fetch.ai ASI:One Agent Challenge**               | $1,250 / $750 / $500                                      | Agent on Agentverse, Chat Protocol, discoverable and usable in ASI:One, real actions. **Plus submission via the ASI "MHacks Submission Agent".**          | ★★★         | See the submission steps below. Weights: functionality 25, Fetch tech 20, innovation 20, impact 20, UX 15.                                                                                                       |
| **Best use of Spacetime**                          | $1,000 / $500 / $200                                      | Spacetime as _the core_ real-time backend: live shared state, "AI systems coordinating in a persistent world state", "shared simulations". Not bolted on. | ★★★         | Live cascade state, scout grid and war-room presence live **only** in SpacetimeDB. A scheduled reducer ticks the cascade. Two browsers watch the same run.                                                       |
| **Relay: Interactive Agents**                      | 1st: SF trip + a week at the Relay house + merch          | The agent must work in the Relay app (text, call, video)                                                                                                  | ★★☆         | Python `relaymessenger` SDK (v0.1.0): WebSocket events, buttons/cards, calls via WebRTC. Get TestFlight access and a token at the booth.                                                                         |
| **Photon: Agents in iMessage**                     | $700 ($400 + credits + final-interview fast-track) / $300 | Must use Spectrum to connect to iMessage. Social context, persistent context.                                                                             | ★★☆         | TypeScript `spectrum-ts` sidecar bridging to the Python core. Free shared line; **pre-register recipient numbers**. Group chats need a paid dedicated line.                                                      |
| **ElevenLabs**                                     | 3 months of Scale per member ($897 each)                  | "Best use of ElevenLabs"                                                                                                                                  | ★★☆         | **Audience voices:** Voice Design gives each community a voice that reads its simulated reactions aloud. Optional voice briefing via ElevenAgents (custom-LLM = Ripple).                                         |
| **Neon Backend**                                   | $1,000 / $500 / $100 in AI Gateway credits                | "Utilize Neon to its fullest"                                                                                                                             | ★★☆         | Use 3+ primitives: Postgres + pgvector, **branch per simulation/what-if** (shown live), Better Auth + RLS (watchlists), Data API, **AI Gateway for agent LLM calls**. The free plan has only 0.5 GB per project. |
| **Figma Best Design**                              | LEGO Trevi set / merch                                    | No published criteria. The closest proxy is FigBuild 2026: execution, craft, storytelling, problem fit, innovation.                                       | ★★☆         | Design system + prototype in Figma. Figma MCP (`mcp.figma.com/mcp`) captures the live UI back into Figma. Show design-to-app parity.                                                                             |
| **Notability: Trust the Process**                  | 1 year of Pro + merch                                     | Use Notability Pro during the hackathon, ≥2 screenshots, tag on Devpost                                                                                   | ★☆☆ (cheap) | Start the Pro trial on day one (a 3-day trial is reported, U). Use it for architecture sketches and live-transcribed brainstorms.                                                                                |
| **Judged by an LLM** (side quest)                  | Mystery                                                   | No details published (U)                                                                                                                                  | ★☆☆ (free)  | A clear, factual Devpost write-up. **No prompt injection.**                                                                                                                                                      |
| SpaceXAI "Make it Legendary"                       | Keyboards                                                 | Space data, built with Cursor, Grok Imagine/Voice API                                                                                                     | ✗           | Off-theme.                                                                                                                                                                                                       |
| Capital One Nessie                                 | Gift cards                                                | Mock banking API                                                                                                                                          | ✗           | Off-theme.                                                                                                                                                                                                       |
| FinchNode                                          | Apple Watch / $500                                        | Synthetic health records                                                                                                                                  | ✗           | Off-theme.                                                                                                                                                                                                       |
| FREE-WILi                                          | Kits                                                      | Hardware                                                                                                                                                  | ✗           | Off-theme.                                                                                                                                                                                                       |
| Freesolo                                           | Not on the list                                           | —                                                                                                                                                         | —           | Train the policy model ourselves. Freesolo is no longer a prize driver.                                                                                                                                          |

## Fetch.ai submission steps (from the official doc)

**Team lead:**

1. In ASI:One, message the **"MHacks Submission Agent"**.
2. Pick **"Create team (I'm the lead)"**.
3. Fill in:
   - project name, name, email, team size,
   - problem statement,
   - public GitHub URL,
   - optional: table number and demo video.
4. Bonus fields:
   - number of Agentverse agents and their profile URLs,
   - number of ASI:One shared chats and their URLs.
5. Click Continue to review, then Confirm submission. Share the **Team ID**.

**Teammates:** open the same agent, choose **"Join with Team ID"**, and enter name and email.

The status changes from "Incomplete" to "Submitted" once everyone has joined. This is **in addition to** Devpost.

## Integration notes

- **One backend, many front doors.** Put shared logic in one `handle_user_message(channel, user, text)` function, with thin adapters:
  - uAgent (ASI:One),
  - Relay Python WebSocket task (don't use the same Relay token for both webhook and WebSocket: 409),
  - Photon TypeScript sidecar.
  - Keep memory per channel and user.
- **Neon vs SpacetimeDB split:**
  - Neon = durable data (graphs, twins, briefs, embeddings, auth, watchlists).
  - SpacetimeDB = live state (cascade ticks, scouts, presence).
  - Don't duplicate live state.
- **SpacetimeDB has no maintained Python SDK** (the 2.0 modules are TypeScript, Rust, C# or C++). Python agents reach it through the HTTP API (exact call path U) or a small TypeScript bridge.
- **Sources:**
  - Relay: [docs](https://docs.relayapp.im), [PyPI](https://pypi.org/project/relaymessenger/)
  - Photon: [Spectrum](https://photon.codes/docs/spectrum-ts/introduction), [pricing](https://photon.codes/pricing)
  - ElevenLabs: [docs](https://elevenlabs.io/docs/overview/intro)
  - Neon: [neon.com](https://neon.com/), [pricing](https://neon.com/pricing)
  - SpacetimeDB: [architecture](https://spacetimedb.com/docs/intro/key-architecture), [pricing](https://spacetimedb.com/pricing)
  - Figma MCP: [guide](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
  - Proxy for Figma judging: [FigBuild 2026](https://figbuild2026.devpost.com/)
