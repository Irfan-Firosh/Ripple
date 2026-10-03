# Ripple × Fetch.ai × AWS Bedrock AgentCore: who does what

Researched 2026-10-03.

- **Decision:** Fetch.ai uAgents run the "general" agents: orchestration, chat, and the pipeline workers.
- **Twins** are built by **AWS Bedrock AgentCore**.
- **Verdict:** feasible, and a clean split. AgentCore is framework- and model-agnostic, and it is callable from any Python process with `boto3`.

## Division of labour

| Layer                    | Runs on                                    | Agents                                                                                                                                                                             | Why there                                                                                                                           |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **"General" agents**     | **Fetch.ai uAgents** (Agentverse, ASI:One) | Orchestrator (Chat Protocol + cards), X Scraper, Graph Builder, Policy model, Backtester                                                                                           | Required for the Fetch.ai prize: Agentverse registration, Chat Protocol, the full workflow in ASI:One, multi-agent orchestration    |
| **Twin factory**         | **AWS Bedrock AgentCore Runtime + Memory** | **TwinBuilder**: turns one account's scraped X activity into a structured twin. Optional **Ask-the-twin**: a persona session that explains "why would you engage with this draft?" | A managed agent runtime with per-session isolation, plus managed long-term memory with namespaces. Each twin is a memory namespace. |
| **Backend / live state** | **SpacetimeDB** (`ripple-mhacks`)          | —                                                                                                                                                                                  | Twin summaries land in the `twin` table. The simulation ticks in-module. See [spacetime-backend.md](spacetime-backend.md).          |

**Key design rule:** AgentCore is called **once per account to build its twin**, and **on demand for explanations**. It is **not** called during the simulation. The cascade uses the policy model's `edge_prob` values inside SpacetimeDB, so there are no LLM calls per agent per tick. That keeps it fast, cheap, and deterministic.

## Flow

1. The Fetch **Graph Builder** finishes the interaction graph for the chosen X page.
2. For each account (in batches), the Fetch agent calls AgentCore:
   - `boto3.client("bedrock-agentcore").invoke_agent_runtime(agentRuntimeArn=…, runtimeSessionId=<handle-based id ≥33 chars>, payload={account's posts + interactions})`
   - ([invoke example](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli.html)).
3. **TwinBuilder** is a Strands agent on Runtime using a Bedrock model such as Claude or Nova. It:
   - extracts topic affinity, tone and format preferences, reply/quote/repost tendencies, active hours, and network role;
   - writes long-term records to **AgentCore Memory** under the namespace `/twins/{handle}/`, by direct long-term ingestion or a custom extraction strategy;
   - returns the structured twin JSON.
4. The Fetch agent writes the twin summary into SpacetimeDB's `twin` table through the HTTP reducer API (proven).
5. The policy model trains and scores on twin features plus content features, then writes `edge_prob`.
6. **Explanations (optional):** "why did @x engage with draft B?" opens an Ask-the-twin session that retrieves `/twins/x/` memory and answers in persona. The answer is shown in the ASI:One detail card and the web node panel.

## Verified facts (sources)

- **Runtime:**
  - Hosts any framework (Strands, LangGraph, CrewAI, ADK, OpenAI Agents SDK, custom) and any model (Bedrock, OpenAI, Gemini, and others).
  - Each session runs in its own microVM. Sessions last up to 8 hours on microVMs.
  - It supports the HTTP, MCP, **A2A** and AG-UI protocols.
  - Sources: [Runtime docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html), [sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html), [FAQ](https://aws.amazon.com/bedrock/agentcore/faqs/).
- **Deploy:**
  - `agentcore create` (Strands + Bedrock + memory option), then deploy. It uses AWS CDK under the hood.
  - There is also a config-only **harness** (no framework code) with built-in long-term memory (semantic, summary, user-pref, episodic) and per-actor scoping.
  - Sources: [CLI guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli.html), [harness vs Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-vs-runtime.html).
- **Memory:**
  - Short- and long-term memory, with **namespaces** for segmenting (we use one per twin).
  - Built-in or custom extraction strategies, direct long-term ingestion, and memory shared across agents.
  - Source: [FAQ](https://aws.amazon.com/bedrock/agentcore/faqs/).
- **Pricing** ([pricing page](https://aws.amazon.com/bedrock/agentcore/pricing/)):
  - Runtime v2 costs $0.1276 per vCPU-hour and $0.0169 per GB-hour, consumption-billed. I/O wait (for example, waiting on the LLM) is not billed for CPU.
  - Memory costs:
    - $0.25 per 1,000 short-term events;
    - $0.75 per 1,000 long-term records stored per month (built-in strategies), or $0.25 per 1,000 (custom);
    - $0.50 per 1,000 retrievals.
  - Bedrock model tokens are billed separately.
  - New AWS customers get up to $200 in Free Tier credits.

**Cost sketch (estimate):**

- 500 twins × about 5 records each = 2,500 records, about **$1.90 a month** stored.
- 2,000 explanation retrievals, about **$1**.
- Runtime is pennies.
- Bedrock tokens dominate: about 500 profile calls at a few thousand tokens each.

That is comfortably within free credits.

## Integration notes

- **Auth:** the Fetch agent service needs AWS credentials with `bedrock-agentcore:InvokeAgentRuntime`. Keep them in the gitignored `.env`.
- **Region:** pick one where AgentCore and the chosen Bedrock model are both available. The exact region list is unverified here; check the console. Enable model access in Bedrock first.
- **Session IDs** must be at least 33 characters. Reuse one per twin so explanation calls hit a warm microVM.
- **A2A:** AgentCore supports A2A. Fetch-to-AgentCore over A2A is possible in principle but **unverified**. `boto3 invoke_agent_runtime` is the verified path; use it.
- **SpacetimeDB writes:** do them from the Fetch side, after AgentCore returns. That way only one service holds the SpacetimeDB service token, and AgentCore needs no outbound credentials for it.

## Prize impact

- **There is no AWS prize at MHacks 2026** (see [mhacks-2026-prizes.md](mhacks-2026-prizes.md)). AgentCore is an engineering choice, not a prize play.
- It **strengthens** the "Actually Intelligent (AI)" and Grand Prize story: real managed agent infrastructure, persistent per-twin memory, and explainable twins.
- It **doesn't weaken** Fetch.ai eligibility, because the Fetch agents still orchestrate, and the full workflow still runs in ASI:One.
- Pitch line: "Fetch.ai agents run the pipeline; AWS AgentCore builds and remembers every twin; SpacetimeDB runs the simulation live."

## Risks

| Risk                                                       | Mitigation                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| AWS setup time (IAM, CDK bootstrap, Bedrock model access)  | Do it in hour 0–1; use the `agentcore` CLI defaults (Strands + Bedrock)                                       |
| Per-account LLM profiling latency for hundreds of accounts | Batch calls, run them in parallel sessions, and cache twins in SpacetimeDB; pre-build twins for the demo page |
| Twins of real X accounts stored in AWS Memory (privacy)    | Public behavior only, no sensitive attributes, a delete-by-namespace path, and aggregate display in the UI    |
| Two clouds plus Fetch increases moving parts               | One adapter module (`twins_client.py`) owns all AgentCore calls; fall back to a local profiler if AWS is down |
