# Codex prompt: Ripple onboarding (Typeform-style)

Paste everything below the line into Codex. The backend is already live; Codex only builds the frontend.

---

## Task

Build Ripple's onboarding at the route **`/onboarding`** in `frontend/` (Vite + React 19 + TypeScript, no Next.js).
A brand's social lead enters their brand's X handle; while Ripple scrapes their real followers and builds AI
twins + the audience graph **live in the background**, the user answers a few short questions (the campaign brief).
When the build is ready they land on their audience graph.

The backend, database tables and reducers below already exist and are deployed. Do not change anything outside
`frontend/`. Do not edit existing Lab files (`src/lab/*`, `src/lab-game/*`).

## Look: match the reference form exactly, one group per screen (Typeform flow)

Visual reference (the attached "Registration form" screenshot). Match it closely:

- Page background `#f5f5f5`; a centered white sheet (`#ffffff`, no shadow, no radius), ~675px wide on desktop,
  content column ~295px wide, left-aligned inside the sheet, generous top padding (~48px). Full-width on mobile with 16px gutters.
- Font: **Public Sans** (Google Fonts) for everything. Title 30px / 700, black `#000`. Group question 16px / 700, black.
- Inputs: 32px tall, `2px solid #c4c4c4` border, radius 3px, white fill, 14px text, placeholder `#b0b0b0`,
  8px gap between stacked inputs, 12px padding-left. Focus: border `#000`, no glow.
- Required fields show a tiny **asterisk badge**: an 8px light-gray circle (`#e8e8e8`) with a black `*`, sitting on the
  input's top-right corner (overlapping the border), exactly like the reference.
- Primary button: black `#000` fill, white 13px / 700 text, radius 3px, ~26px tall, label followed by a `→` arrow
  (lucide `ArrowRight`, 14px). Disabled: `#c4c4c4` fill.
- No other color except the gold mascot (below). Minimal copy: if a word isn't needed, remove it. No helper paragraphs.

Typeform behaviour on top of that look:
- **One group per screen.** The group slides up and fades in (framer-motion, 250ms, `y: 24 → 0`); the previous one slides out up.
- **Enter** submits the current group (Shift+Enter for a newline in the textarea). Autofocus the first field.
- A 2px black progress bar pinned to the very top of the page (width = step / total).
- Choice questions show options as bordered rows with a key hint box (`A`, `B`, `C`, `D`), Typeform-style; pressing the
  letter selects the option. Selected row: black border + check icon.
- Back: small `↑` / `↓` chevron pair in the bottom-right corner (black on `#f5f5f5`, 28px squares) to move between groups.

## Mascot: the gold flower ("Bloom")

An inline SVG component `Bloom` (no image files): a 6-petal flower, petals with a gold gradient `#F3D9A4 → #E6BC88 → #C9963F`,
a dark center `#1a1a1a` with two small white eye dots. It is the onboarding agent:
- Sits top-left of the sheet, 40px, beside the title. Idle: slow 4s sway (rotate ±4°) and a gentle petal "breathe".
- On the build screen it grows to 96px and **one petal lights up per completed stage** (unlit petals `#ececec`);
  at `ready` all petals are gold and it does one quick spin.
- Respect `prefers-reduced-motion` (no sway/spin).
- Use the existing `RippleMark` (exported from `src/App.tsx`) as the small black wordmark logo in the sheet's top-right, 20px.

## Screens (exact copy, keep it this short)

| # | Title / question | Fields | On continue |
|---|---|---|---|
| 1 | **Connect your brand** / "Your brand on X" | `@handle` (required) | call `request_onboarding` (below). Show the reducer's error text under the field in 12px `#d00` if it throws. Then go to 2 immediately — scraping runs while they answer. |
| 2 | "Who are you?" | Name (required), Role (e.g. placeholder "Social lead") | — |
| 3 | "What are you launching?" | Campaign name (required), "The news" textarea (required, 3 rows) | — |
| 4 | "What matters most?" | choice: A Reposts · B Likes · C Replies · D Views | call `update_onboarding_brief`, go to 5 |
| 5 | Build screen (title = brand name from X, e.g. "Raycast") | none | button **See your audience →** enabled when status is `ready`; navigates to `/dashboard?brand=<handle>` |

A thin live status line is visible at the bottom of the sheet on screens 2–4 (12px, `#777`): e.g. `Reading followers · 300`
→ `Building twins · 34/60` → `Mapping the graph` → `Ready`. This is the "it's working while you type" moment.

**Build screen (5):** large Bloom; under it, three rows (one per stage) each with a 16px circle that fills black when done:
`Followers` (show `followers_discovered`), `Twins` (`ready/requested`), `Graph`. Below, a row of up to 24 follower avatars
(28px circles, 2px white ring, overlapping by 8px) that pop in as their profiles are scraped. If `status = failed`, show the
`error` text and a **Try again →** button that returns to screen 1.

## Data contract (live on SpacetimeDB maincloud, database `ripple-mhacks`)

Base URL `https://maincloud.spacetimedb.com`. Reuse the helpers that already exist:
- `sql(query)` from `src/audience/liveAudience.ts` (POST SQL, returns rows as objects with **snake_case** keys).
- Identity: copy the `token()` pattern from `src/lab/labData.ts` (POST `/v1/identity`, cache the token in localStorage under
  `ripple-onboarding-token`). Reducer calls are `POST /v1/database/ripple-mhacks/call/<reducer>` with
  `Authorization: Bearer <token>` and a **JSON array** of positional args. On non-2xx, show the text after `SenderError:`
  (same cleanup as `requestExperiment` in labData.ts).

### Reducers

| Reducer | Args (JSON array, in order) | Errors to show |
|---|---|---|
| `request_onboarding` | `[handle]` — with or without `@` | `enter a valid X handle`, `an onboarding is already running` |
| `update_onboarding_brief` | `[onboarding_id (number), owner_name, role, campaign_name, campaign_news, goal]` — goal is one of `reposts`, `likes`, `replies`, `views` | `not your onboarding`, length errors (short answers ≤ 80 chars, news ≤ 600) |

After `request_onboarding` succeeds, find the row: `SELECT * FROM onboarding WHERE handle = '<lowercased handle>'`
and take the one with the highest `onboarding_id`. Handles are stored lowercased without `@`.

### Tables to poll (every 1.5s while screens 2–5 are open; stop when `ready`/`failed`)

`onboarding` row:
`onboarding_id, handle, brand_user_id ('' until scraped), status, ingestion_run_id, twin_run_id, owner_name, role,
campaign_name, campaign_news, goal, error, created_at, updated_at`

`status` goes `queued → scraping → twins → graph → ready` (or `failed`, with `error`). Today a full run takes ~90 seconds.

Live counters (only once the ids are non-empty):
- `SELECT * FROM x_ingestion_run WHERE ingestion_run_id = '<ingestion_run_id>'` →
  `followers_discovered` (followers found, ~300), `posts_saved`.
- `SELECT * FROM twin_build_run WHERE run_id = '<twin_run_id>'` → `requested`, `ready`, `failed`.
- Brand profile for the title and avatar: `SELECT * FROM x_user WHERE user_id = '<brand_user_id>'` → `name`,
  `username`, `profile_image_url`, `followers_count`.
- Follower avatars: `SELECT follower_user_id FROM audience_membership WHERE brand_user_id = '<brand_user_id>'`, then
  `SELECT user_id, username, profile_image_url FROM x_user` filtered client-side to those ids (take the first 24 with an image).

Option columns (`error`) arrive on the wire as `[0, "text"]` (some) / `[1, []]` (none); the existing `sql()` helper
already decodes them to the value or `null`, so always go through `sql()`.

### Dashboard handoff

`/dashboard?brand=<handle>` currently only accepts the two hard-coded entries in `BRANDS`
(`src/audience/liveAudience.ts`). Make it also accept any onboarded X handle: if `brand` is not in `BRANDS`, use
`{ handle, label: '@' + handle, platform: 'x', maxNiches: 6 }`. Do not change the existing two entries.

## Routing

Add `/onboarding` in `src/main.tsx`, lazy-loaded like the Lab, **outside** the Clerk provider branch (no sign-in needed),
with a `Suspense` fallback. Put the code in `src/onboarding/` (`OnboardingPage.tsx`, `Bloom.tsx`, `onboardingData.ts`,
`onboarding.css`). Keep files under ~200 lines.

## Tests

Add `frontend/tests/onboarding.spec.ts` (Playwright, already configured). Mock SpacetimeDB with `page.route` — never hit
the real database in tests:
1. Typing a handle + Enter calls `request_onboarding` with `["raycast"]` and advances to "Who are you?".
2. An invalid handle shows `enter a valid X handle` and stays on screen 1.
3. Answering 2–4 calls `update_onboarding_brief` with the six args in order (goal `reposts` when pressing `A`).
4. Build screen: mocked statuses `scraping → twins → ready` light the stages, and the button navigates to
   `/dashboard?brand=raycast`.
5. `status = failed` shows the error and **Try again** returns to screen 1.

Run `npm run build` and `npx playwright test tests/onboarding.spec.ts` and make both pass.

## Running it for real

The onboarding worker must be running for real handles to progress:
`cd backend && uv run python -m twins onboarding-worker` (it scrapes X with Scweet, builds 60 twins live, then backfills
the rest in the background). Try handle `raycast`.
