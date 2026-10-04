# Fetch.ai demo

Open [Ripple on Agentverse](https://agentverse.ai/agents/details/agent1qvq9ea8vhcvwure28rvzzdjp23k2ffnmcq0d6sed9thmn85kvam5jvqdrlj), then **Chat with Agent** to use @ripple in ASI:One. Keep the local app at http://localhost:5173 running for optional visualization links. The primary workflow completes in chat.

1. Send: **Build an X audience for @supermemory.** The ready card appears.
2. Send: **What are the main interests in @supermemory’s audience?** Review the audience size and interests.
3. Send: **Who in @supermemory’s audience cares about AI and developer tools?** Review the relevant segments and follower handles.
4. Send: **Create 2 campaign images for @supermemory promoting that they are open sourcing their software. Goal: make it easier for developers.** This creates two images per segment, up to six across three segments. Allow roughly two minutes for generation; wait for the concept cards.
5. Click **Test this post** on a concept. Wait for the loading bar to finish; review predicted reactions, sample responses, and reach.
6. Click **Test another post / compare two**. Leave the audience blank to retain Supermemory. Enter Post A: **Open source memory for agents. Add memory today.** Enter Post B: **Ship smarter agents faster. Add memory today.** Click **Continue** and wait for the final A/B prediction. The overall winner comes from the full-audience Lab simulation; the interview sample can favor a different draft.
7. Click **Watch A vs B play out live**. The Lab opens the exact saved experiment for Supermemory. Click **Replay** to restart its animation.

The **Open campaign studio** link opens the exact campaign from chat, including its images. A fresh browser can review it and select two concepts for Lab v2; campaign mutations belong to the identity that created it. **See @supermemory’s audience** opens the matching dashboard.

To demonstrate new-company onboarding, choose a valid X handle that is not built yet and ask to explore it. Ripple saves the request and queues scraping, persona building, and graph construction. **Check progress** shows the current stage. **Continue my request** resumes the saved analysis when ready. **Watch it build** opens that company's existing build in the app, then **See your audience** opens its graph. A new chat starts with no audience selected. @resend was verified through this entire onboarding flow on October 4, 2026; it is now already built.

## Services

From the repository root, run `./scripts/fetch_demo.sh` right before presenting. It checks the required keys, X cookie presence, and read access to the `ripple-mhacks` maincloud database, then starts the agents, onboarding worker, creative worker, Lab worker, and local UI. It pins the frontend and backend to that database and reuses processes it started on a previous run. Logs and PID files are under `${TMPDIR:-/tmp}/ripple-fetch-demo-$(id -u)/`. Use `./scripts/fetch_demo.sh status` to check them, or `./scripts/fetch_demo.sh check` for preflight only. The launcher does not run the paid live rehearsal or create a new audience.

Run each command in its own terminal from the repository root:

```sh
PYTHONPATH=backend uv run --project backend python -m ripple_agents
PYTHONPATH=backend uv run --project backend python -m twins onboarding-worker
PYTHONPATH=backend uv run --project backend python -m creative worker
PYTHONPATH=backend uv run --project backend python -m twins lab-worker
```

Start the frontend with `npm run dev` from `frontend/`. Backend services use `https://maincloud.spacetimedb.com` / `ripple-mhacks` by default. The frontend must use `VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com` and `VITE_SPACETIMEDB_DATABASE=ripple-mhacks`. A stale local campaign-test override prevents chat-created campaigns from opening. `RIPPLE_APP_URL` defaults to `http://localhost:5173`; set it to the deployed website URL if the demo should open on another machine. Keep provider keys, agent seeds, the database admin token, and working X session cookies in the documented local configuration.

## Verification

The live rehearsal sends signed ACP messages through Agentverse's mailbox, exercises actual button selections and form values, generates real images, runs the exact two drafts above, and checks fresh and different-company sessions:

```sh
PYTHONPATH=backend uv run --project backend python scripts/fetch_demo_check.py
PYTHONPATH=backend uv run --project backend python scripts/fetch_demo_check.py --onboard NEW_X_HANDLE
```

These commands execute real provider calls. Evidence is saved to `/tmp/ripple-fetch-demo.json` and `/tmp/ripple-fetch-onboarding.json`. After rehearsal, run the live browser checks from `frontend/`:

```sh
RIPPLE_FETCH_LIVE_TEST=1 npm test -- fetch-handoff.spec.ts --workers=3
```

The onboarding browser check uses the verified @resend build. All three live browser handoffs passed: six chat-created images opened under Supermemory and transferred into Lab v2; the exact A/B result opened experiment 18 and replayed; new-company onboarding opened @resend's populated dashboard. ACP buttons were exercised through the protocol; ASI:One's own card rendering was not available for browser automation in this session.
