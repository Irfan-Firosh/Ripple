# Fetch.ai demo

Open [Ripple on Agentverse](https://agentverse.ai/agents/details/agent1qvq9ea8vhcvwure28rvzzdjp23k2ffnmcq0d6sed9thmn85kvam5jvqdrlj), then **Chat with Agent** to use @ripple in ASI:One. The primary workflow completes in chat. The website is an optional live view of the same saved campaign and experiment.

1. **Build an X audience for @supermemory.** For a new company, follow **Check progress**, then **Continue my request**. A saved request resumes only after its audience is ready.
2. **Research @supermemory.** Review recent launches, blog/changelog sources, and the company's own posts. Research is cached daily and feeds the generation pipeline.
3. **What are the main interests in @supermemory's audience?** Or ask which segments care about a topic.
4. Choose **Generate campaign**, then provide the launch/news and optional CTA. Ripple uses the main audience segment, a researched brief, two image concepts, and two full posts in the brand's voice. Defaults match the app: two concepts, 16:9. Explicit image counts/ratios remain supported; the first two concepts form the A/B campaign.
5. Choose **Test both drafts**. The audience agent interviews the relevant sample; the simulation agent runs the exact saved drafts in the shared Lab. Review modeled engagement, segment differences, objections, and side-by-side analysis. Estimates are synthetic, not measured outcomes.
6. Choose **Make campaign videos** to queue a distinct video for each draft. **Check campaign progress** returns stage/progress and the finished video links. **Edit a video** accepts A/B plus an instruction; **Edit image A/B** uses the same image-edit pipeline as the app.
7. Choose **Approve A** or **Approve B** after testing. Ripple returns the tested copy and an **Open X composer** link. Review and publish in X yourself; nothing is automatically posted.

To import your own drafts, use **Test a post / compare two**. Two drafts become a saved campaign with the same test/approval/video flow. A single post retains the quick interview and reach workflow. A fresh chat has no audience or campaign selected. Switching companies clears the previous saved campaign.

**Open campaign** opens `/campaign?brand=...&id=...&view=1`. A fresh browser can review chat-created work; mutations stay in the chat that created it. **Watch A vs B play out live** opens the exact saved experiment. Video completion attaches each draft's own video to that experiment, including videos that finish after testing.

## Services

Run `./scripts/fetch_demo.sh` after verification to start/reuse the agents, onboarding, creative, video/copy, Lab, and UI workers. It pins both sides to maincloud `ripple-mhacks`. Logs/PIDs are under `${TMPDIR:-/tmp}/ripple-fetch-demo-$(id -u)/`. `status` checks services; `check` performs credential/database preflight without publishing anything.

Video files are currently served from the rendering machine's `frontend/public/generated/videos`. Run the video worker and demo UI on the same host; a worker on another machine needs shared media hosting to make its relative video links available here.

Required local credentials: `ASI_ONE_API_KEY`, `AGENTVERSE_API_KEY`, `AGENT_SEED_ORCHESTRATOR`, `AGENT_SEED_AUDIENCE`, `CLAUDE_API_KEY`, `CLAUDE_API_KEY_2`, `XAI_API_KEY` (images and video thumbnails), `EXA_API_KEY`, `ELEVENLABS_API_KEY`, and a SpacetimeDB admin login. New X onboarding also needs the existing `X_AUTH_TOKEN*` session cookies. The current ingestion path uses Scweet; do not describe it as official X API ingestion.

The Fetch Bureau uses the current `twins`, `creative`, and `video` pipelines. The older standalone `agents.audience_agent` and `agents.simulation_agent` entry points are retired. Existing live identities are preserved, so the ASI:One handle and links remain stable.

## Verify before deployment

```sh
cd backend
.venv/bin/python -m pytest -q
```

From `frontend/`, run `npm run build` and `npm test -- fetch-workflow.spec.ts --workers=1`.

Rehearse real signed ACP messages and typed specialist orchestration locally before publishing profiles:

```sh
PYTHONPATH=backend backend/.venv/bin/python scripts/fetch_workflow_check.py --videos
```

This uses real paid providers, creates campaigns, renders two videos and an edited version, edits an image, tests both generated posts, approves a draft, imports the Office skit's bad/good posts, and checks fresh-session isolation. It does not publish the updated agents to Agentverse. Evidence is written to `/tmp/ripple-fetch-workflow.json`. Omit `--videos` for a faster core rehearsal.

After deployment, add `--mailbox` to run the same check through Agentverse's signed mailbox transport. Its evidence is `/tmp/ripple-fetch-workflow-mailbox.json`.

Verify the real browser handoffs from `frontend/`:

```sh
RIPPLE_FETCH_WORKFLOW_LIVE_TEST=1 npm test -- fetch-workflow.spec.ts --workers=1
```

The original `scripts/fetch_demo_check.py --onboard NEW_X_HANDLE` remains an onboarding-only mailbox check; its old image-only rehearsal is replaced by `fetch_workflow_check.py`.

## Demo claims

Pitch Ripple as an audience wind tunnel: test messaging against a model grounded in your existing audience before publishing. Current historical engagement anchoring adjusts simulation scale; it is not a held-out backtest, rank-correlation score, or guarantee of individual behavior. Do not claim those measurements without implementing and evaluating them.

Existing actions retain the hosted image tiles. New workflow actions use native ACP buttons, so no additional asset deployment is required.

After persona analysis, Fetch.ai offers **Expand to 50 · 0.1 test FET** and **No thanks, continue**. This is a
testnet payment demo: the seller verifies the ledger transfer and saves the upgrade receipt, but does not expand
the persona count. ASI:One checkout must include `buyer_fet_wallet` (or `buyer_fet_address`) in the commitment.
The offer is scoped to the chat and analysis; skipped offers preserve all campaign actions. Web app behavior is unchanged.

Interview reports and the checkout card arrive before the response stream closes and include an explicit reply-completion marker. **Show interview results**
replays the latest saved report in the same chat without rerunning interviews. Reports from before this fix
need one new analysis to be saved.
