# Campaign studio

Open `/campaigns`. Campaigns and `/lab-v2` are separate tabs in the floating navigation, using the colors, typography, panels, and themes from `origin/main`. Main’s Audience, Lab, and simulator are preserved.

The flow is **goal → audience brief → two concepts → edit/select → Lab v2 → Run in Lab**. Brief evidence and image-generation controls are collapsed; segment percentages and provider/cost captions are removed.

The live path uses SpacetimeDB subscriptions and a Python job worker. Images come exclusively from Grok Imagine. Headline and CTA are editable copy below the image. Editing copy is free and clears approval; image changes create a new take with its parent preserved.

## Start

The creative backend and database additions have been merged onto `origin/main`, including its existing simulation tables. The combined module builds and has been verified in an isolated local database. Cloud publication has not been performed as part of this UI integration. Never delete main’s simulation data to publish a schema.

Keep `XAI_API_KEY` in the root `.env`; it never goes into frontend environment variables. Once the live simulation source is merged, these are the maincloud deployment commands from the repository root:

```sh
spacetime publish ripple-mhacks --server maincloud --module-path x-followers-db --no-config --delete-data=never --yes
spacetime generate --lang typescript --out-dir frontend/src/module_bindings --module-path x-followers-db
```

Then, from `backend/`:

```sh
uv run python -m creative seed-brand-kits
uv run python -m creative worker
```

And from `frontend/`:

```sh
npm install
npm run dev
```

The frontend defaults to `ripple-mhacks` on maincloud. Override it with `VITE_SPACETIMEDB_URI` and `VITE_SPACETIMEDB_DATABASE`; the worker uses `STDB_URL` and `STDB_DATABASE`. The worker requires the database publisher/admin's SpacetimeDB token (`spacetime login` or `SPACETIME_TOKEN`). Clerk login and the browser's SpacetimeDB identity are separate. Campaign history and mutations belong to the browser identity; preserve its local storage to resume a campaign.

Brand kits are hand-authored in `backend/creative/brand_kits.py`. Add only brand-owned HTTPS product screenshots to `reference_image_urls` and reseed to enable reference branching. Raycast's demo kit starts with no reference images.

## Demo

1. Choose an audience, click **New campaign**, enter a goal, and create a brief. One segment and two concepts are the defaults.
2. Review the brief, optionally edit it, then click **Generate concepts**.
3. Use **Edit** to change copy or request an image edit. Image prompts, formats, regeneration, and previous versions live under **More options**.
4. Select two concepts and click **Open in Lab v2**. Images, briefs, and segments stay attached to the editable drafts.
5. Click **Run in Lab** to submit the two draft texts through main’s existing `request_lab_experiment` reducer. Main Lab opens the new experiment and handles its real simulation, replay, and results.

Lab v2 retains the original local comparison under **Sample tools**: two or three drafts, 50/200/500 sample runs, distributions, sample network playback, history, and JSON export. These results remain labeled illustrative. A real Lab run compares two texts across the full brand audience; image content and segment filtering are not simulation inputs. Those would be future extensions rather than changes to main.

**Saved demo** in the campaign options loads actual saved Grok images without generation calls. Select two concepts to rehearse the complete Lab v2 handoff. Clicking **Run in Lab** still submits a real experiment.

Main’s simulation needs `CLAUDE_API_KEY` on the machine running `uv run python -m twins lab-worker` (from `backend/`), plus the database publisher/admin token and its existing audience data. Creative generation separately needs `XAI_API_KEY` and `python -m creative worker`. If main’s Lab worker is already hosted and working, the browser reuses it and needs no new Claude key.

The existing ASI:One orchestrator now accepts “Make 3 ads for @raycast.com's developer-tools audience about Raycast AI.” The creative director and image specialists use the same persisted job worker. Agent-created campaigns return image links for review; browser edits/approval require a campaign created by that browser identity. Run `uv run python -m ripple_agents` from `backend/`. Optional specialist seeds are `AGENT_SEED_CREATIVE_DIRECTOR` and `AGENT_SEED_IMAGE_GEN`; otherwise they derive stable, distinct seeds from the existing orchestrator seed.

## Verification

Open `/logs` on the local frontend to see the latest SpacetimeDB and creative worker logs, refreshed every three seconds. The page shows provider request durations and whether the worker is online. `python -m creative worker` automatically captures timestamped output in ignored `data/logs/`; start or restart the worker once to enable capture. The logs endpoint is available on the Vite development server from localhost only and uses the frontend's configured database.

Normal checks do not make paid provider calls:

```sh
cd backend
uv run pytest -q
cd ../frontend
npm run build
npm test
```

Local reducer integration requires a seeded test database on port 3100. From the root:

```sh
spacetime start --listen-addr 127.0.0.1:3100 --data-dir /tmp/ripple-campaign-stdb --in-memory --non-interactive
spacetime publish ripple-campaign-test --server http://127.0.0.1:3100 --module-path x-followers-db --no-config --delete-data=never --yes
CREATIVE_STDB_TEST_URL=http://127.0.0.1:3100 PYTHONPATH=backend uv run --project backend pytest -q backend/tests/test_creative_stdb.py
```

`scripts/seed_creative_test.py` loads a read-only audience cache into the local database only. It does not fetch or mutate the live audience. Seed the Raycast brand kit with the worker's local connection overrides. To exercise real Grok calls, start the frontend with `VITE_SPACETIMEDB_URI=ws://127.0.0.1:3100 VITE_SPACETIMEDB_DATABASE=ripple-campaign-test`, then run `RIPPLE_LIVE_CREATIVE_TEST=1 npm test -- studio-live.spec.ts` from `frontend/`. That test explicitly spends about $0.13 on two images and one edit, plus text synthesis. `scripts/export_creative_rehearsal.py <campaign-id>` saves a completed campaign's real images and anonymized briefs for rehearsal without further image generation.
