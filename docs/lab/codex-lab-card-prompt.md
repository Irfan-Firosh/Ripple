# Codex prompt: Ripple "Lab" card + experiment dock

Paste everything below the line into Codex. Run it **after** Lab plan Tasks 1–7 (`docs/superpowers/plans/2026-10-04-lab-signals.md`): the data contract `frontend/src/lab/labData.ts` and the seeded experiments must exist. If the plan found different SQL column names (Task 1 Step 5), they are already handled inside `labData.ts`; nothing here changes.

---

You are working in the Ripple repo (`frontend/` is Vite + React 19 + TypeScript, Playwright for tests, lucide-react icons, `motion` for animation). Ripple tests a social post on Claude-built digital twins of a brand's real audience before it is posted. Build the **Lab**: a page where a user compares two drafts (A and B) and watches simulated engagement fill in live, plus a **dock** to move between experiments.

## Hard rules
- The feature is called **"Lab"**. Never write "wind tunnel" anywhere (code, copy, comments, test names).
- Show exactly four signals, in this order: **Likes, Reposts, Replies, Quotes**. Do **not** add "likes on reposts", "bookmarks", "views" or any other metric.
- **No mock or sample data.** All data comes from `frontend/src/lab/labData.ts` (already implemented; import it, don't modify it). If there are no experiments, show an empty state that invites the user to create one.
- Do **not** modify these files (teammates are editing them): `frontend/src/visuals/**`, `frontend/src/NetworkTestPage.tsx`, `frontend/src/network-test.css`, `frontend/src/audience/**`, `frontend/src/lab/labData.ts`. You may import from them.
- New code goes in `frontend/src/lab/` plus one route in `frontend/src/main.tsx` and one test file `frontend/tests/lab.spec.ts`.
- TypeScript strict, no `any` in new code, named exports for components (the page itself may be a default export for `lazy()` like the other pages).

## Data contract (from `frontend/src/lab/labData.ts`)
```ts
export const SIGNALS = ['like','repost','reply','quote'] as const; export type Signal = (typeof SIGNALS)[number];
export const SIGNAL_LABEL: Record<Signal,string>; // Likes, Reposts, Replies, Quotes
export type SignalRange = { p10:number; p50:number; p90:number; mean:number };
export type LabEvent = { userId:string; handle:string; name:string; avatar:string; signal:Signal; tick:number; draft:'A'|'B' };
export type LabRun = { runId:string; status:'scoring'|'replaying'|'done'|'failed'; replayTick:number; replayMaxTick:number; people:number;
  signals:Record<Signal,SignalRange>|null; events:LabEvent[]; shares:Map<string,Record<Signal,number>> };
export type LabExperimentSummary = { id:string; brand:string; title:string; status:'queued'|'running'|'done'|'failed'; winner:''|'A'|'B'|'tie'; lift:number; createdAt:number };
export type LabExperiment = LabExperimentSummary & { draftA:string; draftB:string; error:string|null; a:LabRun|null; b:LabRun|null };
export type LabNiche = { slug:string; label:string; members:Set<string> };
export type BacktestHeadline = { metric:string; value:number; baseline:number; n:number; note:string } | null;
listExperiments(brand, signal?) => Promise<LabExperimentSummary[]>   // newest first
loadExperiment(id, signal?) => Promise<LabExperiment>
loadLabNiches(brand, signal?) => Promise<LabNiche[]>                  // ≤7 (Raycast) / ≤10 (spacetimedb), real niches only
loadBacktestHeadline(brand, signal?) => Promise<BacktestHeadline>     // null until the backtest has run
requestExperiment({brand,title,draftA,draftB}) => Promise<void>        // throws Error(message) from the server on bad input
countsAt(run, members?) => Record<Signal,number>        // live counts from the replayed trial up to run.replayTick
expectedCounts(run, members?) => Record<Signal,number>  // expected counts (sum of per-person shares), 1 decimal
useLabExperiment(id|null) => { experiment, error }      // polls every 500 ms until both runs are done or it failed
```
Brands come from `BRANDS` in `frontend/src/audience/liveAudience.ts`: `spacetimedb` (X, label `@spacetimedb`) and `raycast.com` (Bluesky, label `Raycast`). Default brand: `raycast.com`.

## Page: `/lab` (`frontend/src/lab/LabPage.tsx`)
- Route: in `main.tsx`, add `path === "/lab"` → `lazy(() => import("./lab/LabPage"))` inside a `Suspense` fallback `Opening the Lab…`, placed next to the `/test` branch (outside Clerk, like `/test`).
- URL state: `?brand=<handle>&exp=<id>`. Changing brand or experiment updates the URL with `history.replaceState`; reading the page with those params restores the view. If `exp` is missing, select the newest experiment for the brand.
- Header (reuse the look of the existing dashboard header, but your own CSS): Ripple mark + "Lab" + a brand switcher (`@spacetimedb` / `Raycast · Bluesky`, `aria-current="page"` on the active one) + theme toggle that sets `document.documentElement.dataset.theme` (`dark`/`light`, persisted in `localStorage['ripple-theme']` inside try/catch).
- Below the card, a small chip `LAB`, a heading **"Pre-test before anything hits your feed."**, and one line: "Claude-built twins of @{brand}'s real followers react to both drafts. See the winner before you post for real."
- Under that, both drafts shown in full, labelled **A** (A colour) and **B** (B colour).

## The Lab card (`frontend/src/lab/LabCard.tsx`) — match this mock
```
┌───────────────────────────────────────────────────────────┐
│ ● ● ●                                         ripple · lab │   window chrome: three muted dots, mono label right
├───────────────────────────────────────────────────────────┤
│ ● simulating · 999 twins                 All niches ▾      │   status left (dot pulses while running), niche <select> right
│ ─────────────────────────────────────────────────────────  │   thin progress line: replayTick / replayMaxTick (both runs)
│ 14                    LIKES                            29  │   A count left, label centre, B count right
│        ████████████████|█████████████████████████          │   diverging bar: A grows LEFT from centre, B grows RIGHT
│ 6                    REPOSTS                            9  │
│                  ██████|████████                           │
│ 5                    REPLIES                            9  │
│ 2                    QUOTES                             4  │
│ (avatar) @priya_cs26  reposted                        [B]  │   latest event line; badge in that draft's colour
│ B wins · +42% expected engagement · range 3–9 vs 5–14      │   only when experiment.status === 'done'
└───────────────────────────────────────────────────────────┘
```
- Colours: **A = `var(--accent)`** (Ripple's warm gold/orange), **B = a blue**, defined once as CSS variables in your stylesheet: dark `--lab-a: var(--accent); --lab-b: #5ec8f2;` light `--lab-b: #1f77b4;`. Use existing tokens for everything else: `--bg --fg --muted --line --panel --frame --soft`. Fonts: numbers and labels in `"Space Mono", monospace` (tabular-nums), prose in `"DM Sans"`.
- Numbers per row:
  - While a run is `scoring`: show `—` and a shimmer on the bar; status text `scoring 999 twins with Claude…`.
  - While `replaying`: `countsAt(run, members)` — the bars visibly fill tick by tick.
  - When `done`: show `signals[s].p50` for "All niches", or `expectedCounts(run, members)` (1 decimal, drop `.0`) when a niche is selected. Put the p10–p90 range in the row's `title`/tooltip and in the summary line.
- Bar widths: normalise every row against the **largest value across all four signals and both drafts** (min denominator 1), so rows are comparable; animate width changes ≤ 300 ms (respect `prefers-reduced-motion`: no animation).
- Niche selector: `<select aria-label="Niche">` with "All niches" + `loadLabNiches(brand)` labels; selection filters counts via `members`.
- Latest event line: the most recent event across both runs with `tick <= that run's replayTick` (avatar 20 px circle with `referrerPolicy="no-referrer"`, fallback initials; `@handle`; verb `liked / reposted / replied / quoted`; badge `A`/`B`). Hide when there are none.
- Status text: `queued…` → `scoring {people} twins with Claude…` → `simulating · {people} twins` → `done · {people} twins`. Failed: show `experiment.error` in a calm error row with a "Try another draft" button that opens the composer.
- Summary line (done): `A wins`/`B wins`/`Too close to call` + `{+/-}{round(lift*100)}% expected engagement`. If `loadBacktestHeadline(brand)` returns a value **and** its note's lower CI bound is above 0.5 (parse `95% CI x-y`), add a muted line: `Backtest: picks the better post {round(value*100)}% of the time (coin flip 50%, n={n})`. Otherwise add nothing about accuracy.
- Accessibility: each row has `role="group"` and `aria-label="Likes: draft A 14, draft B 29"`; the status has `aria-live="polite"`. Colour is never the only cue (A/B letters are always shown).

## The dock (`frontend/src/lab/LabDock.tsx`)
- Fixed at the bottom centre (16 px from the bottom), a translucent glass bar (`color-mix(in srgb, var(--bg) 85%, transparent)`, `backdrop-filter: blur(16px)`, 1px `--line` border, radius 16 px).
- Contents left→right: a **"+" New** tile, then one tile per experiment for the current brand (`listExperiments`, newest first; refresh every 5 s while any is `queued`/`running`).
- Each experiment tile (44 px tall, max 160 px wide): status dot (queued = muted, running = pulsing accent, done = winner colour, failed = red), truncated title, and a small `A`/`B`/`=` winner badge when done. Native `title` shows the full title + date.
- The active tile is highlighted (`aria-current="true"`). Tiles are buttons in a `nav aria-label="Experiments"`. Keyboard: `←`/`→` move focus between tiles, `Enter` opens; the page also supports `[` and `]` to go to the previous/next experiment.
- Overflow: horizontally scrollable with scroll-snap; the active tile scrolls into view. On phones (≤ 640 px) the dock spans the width with 16 px side gutters; no horizontal page scroll anywhere.
- Hover magnification is optional and must be disabled under `prefers-reduced-motion`.

## Composer (`frontend/src/lab/LabComposer.tsx`)
- Opened by the "+" tile: a dialog (`role="dialog"`, `aria-modal`, focus trapped, Esc closes) with: brand (pre-filled, switchable), title (optional, ≤ 80), **Draft A** and **Draft B** textareas (each 1–1000 characters, live counters), "Run in Lab" button.
- Client-side validation mirrors the server (empty or > 1000 chars → inline error, button disabled). On submit call `requestExperiment`; show server errors (e.g. "at most 2 experiments can run at once") inline. On success close, poll `listExperiments` until a new newest experiment appears, then select it.

## States
- Loading: reuse `Loader` from `frontend/src/components/ui/loader.tsx` (`shape="ripple" variant="dither" size="lg" color="var(--accent)"`).
- Empty brand (no experiments): centred message "No experiments for @{brand} yet" + primary "New experiment" button (opens composer).
- Read errors: message + "Try again".

## Files to create
- `frontend/src/lab/LabPage.tsx`, `LabCard.tsx`, `SignalRow.tsx`, `LabDock.tsx`, `LabComposer.tsx`, `lab.css`
- `frontend/tests/lab.spec.ts`
- edit `frontend/src/main.tsx` (one route branch + lazy import only)

## Tests (`frontend/tests/lab.spec.ts`, Playwright, against the live data — no mocks)
1. `/lab?brand=raycast.com` shows the dock with ≥ 1 experiment tile; the card has exactly four rows labelled Likes, Reposts, Replies, Quotes; the page contains no text matching `/wind tunnel|bookmark|likes on reposts/i`.
2. Selecting a done experiment shows a summary line matching `/(A wins|B wins|Too close to call)/` and each row's `aria-label` matches `/draft A \d+(\.\d)?, draft B \d+(\.\d)?/`.
3. Niche selector: choosing a niche changes at least one row's numbers or leaves them ≤ the "All niches" numbers.
4. Composer validation: empty Draft A disables "Run in Lab"; a 1001-character draft shows the length error. (Do not submit — real submissions cost Claude calls.)
5. Dock keyboard: focusing the dock and pressing `→` then `Enter` changes `?exp=` in the URL.
6. Mobile (390×844): no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`), dock visible.
Run `npx tsc -b && npx playwright test tests/lab.spec.ts` until green, then the full `npx playwright test` to prove nothing else broke.

## Done means
- `/lab` works in dark and light themes, desktop and phone widths, with real experiments from SpacetimeDB.
- `npx tsc -b` clean; `npx playwright test` all green.
- No changes outside the allowed files; no new dependencies.
