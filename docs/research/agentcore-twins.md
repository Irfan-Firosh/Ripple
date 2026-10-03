# Ripple × Fetch.ai × AWS Bedrock AgentCore: who does what

> **Decision (2026-10-03):** AWS denied AgentCore access. Twins are now built with the **Claude API (Haiku 4.5, `claude-haiku-4-5-20251001`)** in `backend/twins/` and **synced through SpacetimeDB**:
> - `twin`: the twins themselves
> - `twin_build_run` / `twin_build_job`: live build progress
> - `twin_question`: the Ask-the-twin queue
>
> The input is the teammate's raw X audience data in `ripple-mhacks`. Plan: `docs/superpowers/plans/2026-10-03-claude-twins.md`. The AgentCore material below is kept for reference only.

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

## What AgentCore is (the three parts we use)

| Part                     | What it is                                                                                                                                                                                                | Our use                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Runtime**              | Managed hosting for an agent. You write a Python file with `BedrockAgentCoreApp` and an `@app.entrypoint` function. AWS containerises it and serves `POST /invocations` and `GET /ping` on port 8080. Each session runs in its own microVM. | Hosts the **TwinBuilder** and **Ask-the-twin** agent (one deployment, two actions). |
| **Memory**               | Managed store. **Short-term** memory holds raw events per actor and session. **Long-term** memory holds records, organised by **namespace** (for example `/twins/{actorId}/`) and searchable by meaning. | One memory resource, `ripple_twins`. Each X handle is an `actorId`, and each twin is a namespace. |
| **Bedrock model**        | The LLM, called through Bedrock (Claude Haiku 4.5, `global.anthropic.claude-haiku-4-5-20251001-v1:0`, as used in the AWS samples).                                                                         | Reads an account's posts and produces a structured persona.                |

Think of Runtime as "a Lambda for agents, with long sessions", Memory as "a vector database scoped per twin", and Bedrock as the brain.

## Implementation

### Design rule: numbers in Python, judgement in the LLM

A twin has two halves:

| Half                     | Fields                                                                                                                                        | Computed by                                                     | Why                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Behavioural numbers**  | `post_count`, `reply_rate`, `quote_rate`, `mention_rate`, `avg_likes`, `active_hours`, `network_role` (hub / bridge / leaf from graph degree and betweenness) | Fetch **Graph Builder**, deterministically from scraped `x_post` and `interaction` rows | Reproducible, free, testable. An LLM must not invent rates.              |
| **Semantic persona**     | `topics[{topic, affinity 0–1}]`, `tone`, `format_prefs` (threads, media, links), `hot_buttons` (what makes them reply), `ignores`, `persona_summary` (≤500 characters), `evidence_post_ids` | **AgentCore TwinBuilder** (Bedrock LLM, structured output)      | This is the part that needs reading comprehension, so it is what AgentCore is for. |

The policy model uses both halves as features: the numbers directly, and the topics as an affinity vector matched against the draft's topics.

### End-to-end sequence

1. The **Fetch Graph Builder** finishes the graph and computes the behavioural numbers for each account.
2. For each account, in parallel batches of about 10, the **Fetch agent** calls the Runtime:
   - `invoke_agent_runtime(agentRuntimeArn, runtimeSessionId, payload)`
   - payload: `{"action": "build_twin", "handle", "posts": [text, created_at, metrics…], "stats": {…numbers}}`
3. **TwinBuilder**, running in the Runtime microVM:
   1. A Strands `Agent` calls `structured_output(TwinPersona, prompt)` and gets back a validated Pydantic object.
   2. It writes the persona to Memory with `batch_create_memory_records` (direct writes with no extraction wait, up to 100 records per call, ≤16k characters each, one namespace per record). Records written:
      - `/twins/{handle}/profile/`: `persona_summary`, plus one record per topic and per hot-button.
      - `/twins/{handle}/posts/`: the account's most telling 10–20 posts verbatim. These are what Ask-the-twin cites.
   3. It returns the persona JSON.
4. The **Fetch agent** merges numbers and persona, then calls the SpacetimeDB reducer `upsert_twin`. Only Fetch holds the SpacetimeDB token; AgentCore never talks to SpacetimeDB.
5. The **policy model** scores drafts and writes `edge_prob`. The **simulation ticks inside SpacetimeDB** with no AgentCore calls.
6. **Ask-the-twin**, on demand, when a user clicks a node or asks in ASI:One "why would @x engage?":
   - payload: `{"action": "ask_twin", "handle", "draft", "question"}`
   - The agent calls `retrieve_memories(namespace_path="/twins/{handle}/", query=draft, top_k=8)` and answers in persona, citing the retrieved posts.
   - It reuses that twin's `runtimeSessionId`, so repeated questions hit a warm microVM.

### Runtime agent (sketch: `agents/twins/twin_agent.py`)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory import MemoryClient
from strands import Agent
from strands.models import BedrockModel
from pydantic import BaseModel, Field

MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
MEMORY_ID = os.environ["RIPPLE_TWIN_MEMORY_ID"]

class Topic(BaseModel):
    topic: str
    affinity: float = Field(ge=0, le=1)

class TwinPersona(BaseModel):
    topics: list[Topic]
    tone: str
    format_prefs: list[str]
    hot_buttons: list[str]      # what reliably makes them reply or quote
    ignores: list[str]
    persona_summary: str = Field(max_length=500)
    evidence_post_ids: list[str]

app = BedrockAgentCoreApp()
memory = MemoryClient()
model = BedrockModel(model_id=MODEL_ID, temperature=0.0)

@app.entrypoint
def handler(payload: dict) -> dict:
    if payload["action"] == "build_twin":
        return build_twin(payload)
    if payload["action"] == "ask_twin":
        return ask_twin(payload)
    raise ValueError("unknown action")

def build_twin(p):
    agent = Agent(model=model, system_prompt=BUILDER_PROMPT)
    persona = agent.structured_output(TwinPersona, render_posts(p["posts"], p["stats"]))
    memory.gmdp_client.batch_create_memory_records(
        memoryId=MEMORY_ID, records=to_records(p["handle"], persona, p["posts"]))
    return persona.model_dump()

def ask_twin(p):
    hits = memory.retrieve_memories(memory_id=MEMORY_ID,
        namespace_path=f"/twins/{p['handle']}/", query=p["draft"], top_k=8)
    agent = Agent(model=model, system_prompt=persona_prompt(p["handle"], hits))
    return {"answer": str(agent(p["question"] + "\n\nDraft:\n" + p["draft"]))}

if __name__ == "__main__":
    app.run()
```

### Fetch-side client (sketch: `agents/twins_client.py`)

```python
client = boto3.client("bedrock-agentcore", region_name=REGION)

def session_id(handle: str) -> str:   # must be at least 33 characters, stable per twin
    return "ripple-twin-" + hashlib.sha256(handle.encode()).hexdigest()[:32]

def build_twin(handle, posts, stats) -> dict:
    r = client.invoke_agent_runtime(agentRuntimeArn=TWIN_ARN,
        runtimeSessionId=session_id(handle), qualifier="DEFAULT",
        payload=json.dumps({"action": "build_twin", "handle": handle,
                            "posts": posts, "stats": stats}).encode())
    return json.loads(b"".join(r["response"]))
```

This is the only module that touches AWS. If AgentCore is down, the same `TwinPersona` prompt can run against xAI Grok locally, which gives the fallback listed under Risks.

### One-time setup (hour 0–1)

1. Install the AWS CLI. Run `aws configure` (or SSO) with an IAM user that has AgentCore, Bedrock, ECR, CodeBuild and IAM role-creation rights.
2. In the **Bedrock console**, enable model access for Claude Haiku 4.5 in the chosen region (`us-east-1` or `us-west-2`; both appear in the AWS samples).
3. Install the tooling: `uv pip install bedrock-agentcore strands-agents bedrock-agentcore-starter-toolkit boto3`.
4. Create the memory once:
   - Call `MemoryClient().create_memory_and_wait(name="ripple_twins")`.
   - No extraction strategies are needed, because we write records directly.
   - Save the ID as `RIPPLE_TWIN_MEMORY_ID` in `.env`.
5. Deploy the agent:
   - `agentcore configure -e twin_agent.py` (this auto-creates the execution role and ECR repository), then `agentcore launch`. The result gives the **agent ARN**; save it as `RIPPLE_TWIN_AGENT_ARN` in `.env`.
   - The execution role also needs `bedrock-agentcore:BatchCreateMemoryRecords` and `bedrock-agentcore:RetrieveMemoryRecords` on the memory.
   - The CLI verbs differ by toolkit version (`configure` / `launch` / `deploy`, or the newer `create`). Use whatever `agentcore --help` shows.
6. Smoke test:
   - Run `agentcore invoke '{"action":"build_twin",…}'` with one real account from `x_post`.
   - Then check that `retrieve_memories` returns its records.

### Optional upgrade: IngestData

AgentCore Memory added **`IngestData`** on 2026-09-08 ([announcement](https://aws.amazon.com/about-aws/whats-new/2026/09/agentcore-memory-direct-ingest/), [docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/long-term-ingest-data.html)).

- It takes raw posts as a JSON payload and runs the memory's built-in **semantic** strategy to extract facts into `/twins/{actorId}/facts/`, with no short-term event stored.
- This would give Ask-the-twin richer recall with no extra code.
- **Skip it for the MVP.** Extraction is asynchronous (seconds to minutes), and the API is new. `batch_create_memory_records` is synchronous and deterministic.

### Is Runtime strictly needed?

Honestly, no. TwinBuilder could be a plain Bedrock `converse` call from the Fetch service, writing to Memory directly.

Runtime earns its place because it gives:
- an isolated, observable, managed agent;
- warm per-twin sessions for Ask-the-twin;
- a clean "twin factory" service boundary for the architecture story.

**Keep it**, but the `twins_client.py` boundary means it can be swapped out in minutes if it fights back.

### Verification status

- **Confirmed from AWS docs and SDK source:**
  - `BedrockAgentCoreApp` / `@app.entrypoint`;
  - the `invoke_agent_runtime` signature and response streaming;
  - `MemoryClient.create_memory_and_wait`;
  - `retrieve_memories(namespace | namespace_path, query, top_k)`;
  - the `batch_create_memory_records` limits (100 records, 16k characters, one namespace);
  - `IngestData`;
  - Strands `structured_output` with Pydantic.
- **Not yet run:** this machine has no AWS CLI, credentials or `boto3`. The setup steps above are the first task for whoever owns AWS.

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

## Live run (2026-10-03, Claude Haiku 4.5 on `ripple-mhacks`)

- **Build `twins-spacetimedb-20261003T220255`:**
  - 95 audience accounts of @spacetimedb.
  - **78 twins ready, 0 failed, 17 skipped** (fewer than 3 posts).
  - Run status `completed`, in about 2 minutes with 4 workers.
  - A 3-account pilot ran first (`…T220237`: 2 ready, 1 skipped).
- **Real-time sync verified:** `spacetime subscribe` on `twin_build_job` / `twin_build_run` / `twin_question` received every transition live:
  - jobs: queued → building → ready / skipped
  - questions: pending → answering → answered
- **Example persona (@clockwork_labs):**
  - Tone: "Professional yet approachable; enthusiastic about technical achievements and community engagement; transparent about company updates and product launches."
  - The summary identifies it as the BitCraft game studio.
- **Ask-the-twin through the queue:** `ask_twin` reducer → Python worker → `answer_twin_question`. Questions were asked of @clockwork_labs:

  | Draft | Action | Confidence | Answer (excerpt) |
  | --- | --- | --- | --- |
  | "We rebuilt our multiplayer backend on SpacetimeDB and cut server code by 70%." | **repost** | 0.85 | "This is exactly the kind of technical win we love to see!" (cites its own posts) |
  | "Top 10 skincare tips for autumn" | **ignore** | 0.99 | "Not relevant to my focus areas." |

- **Bug found and fixed live:** SpacetimeDB's SQL returns `array<u8>` columns as hex strings (`"040e0f1016"`). This broke `load_twin` for the first question (#1, marked `failed` by the worker as designed). It is fixed in the `twins/stdb.py` decoder, with a regression test.
