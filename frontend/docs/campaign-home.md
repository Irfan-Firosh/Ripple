# Campaign Home

`/home` is the signed-in landing page's Open workspace destination and the workspace navigation's Home destination. It displays real onboarding campaign records belonging to the browser's existing onboarding database identity, newest first. It refreshes every five seconds; completed campaigns open their audience map, and unfinished or failed campaigns reopen their build. Empty workspaces offer a new campaign action.

`/onboarding?flow=campaign` reuses onboarding with two screens: an X handle plus an optional campaign name, then the live audience build. It calls the existing request_onboarding and update_onboarding_brief reducers, with reposts as the default goal. The campaign flow skips personal details and the longer campaign brief. Its build URL includes `build=<onboarding_id>` so reloading or returning from Home resumes the build. First-login onboarding keeps its original question flow.

The visible analysis stage is “Analyzing your audience”; backend twin tables and statuses keep their original names. Followers, analysis and audience-map stages retain the breathing loader beside the active stage. The audience map remains `/dashboard?brand=<handle>` and shows one aggregated edge per connected cluster pair, with stronger connections drawn thicker.

Campaign ownership uses the existing SpacetimeDB onboarding token, obtained through the SDK's authenticated identity handshake; the query is filtered by requested_by. This follows the app's existing browser database identity model. It does not provide cross-device Clerk-to-SpacetimeDB account linking. Clearing browser storage starts a new database identity and therefore a new workspace view.

Tests intercept Clerk and SpacetimeDB boundaries. Campaign-flow tests verify ordered reducer arguments, omitted personal questions, resume and failure recovery without making real scraping or analysis requests.

## Stats layout

Home uses the login cloud artwork in a themed banner, an audience stats panel and a recent campaigns sidebar on desktop. The sidebar stacks below the graph on mobile. The shared RippleLogo component supplies the same gold asterisk, capitalized wordmark, typography and spacing for Home, onboarding, campaign flow and Campaign Studio.

The graph compares current profiles found and analyzed for each connected audience. It is not an invented historical growth or engagement series. Profile totals deduplicate people across brands; analyzed totals include only people still present in audience_membership. Empty audiences do not become chart bars. Owned campaign_flow records from the existing creative database identity appear in the recent sidebar with links to resume their campaign, alongside owned audience builds. New campaign preserves the current /campaign flow for ready audiences; Add a brand opens the short onboarding flow. Data refreshes every five seconds.

Campaign now opens with the same dark/light login cloud artwork as Home. The primary entry is **Generate new campaign**, using the real audience's largest eligible niche; the second entry imports two drafts or existing posts. A compact guide explains the concept, media and Lab stages. Imported drafts use full-width post composers; the existing backend generation, per-draft video requests, testing and launch flow remain wired up. New campaign returns an existing campaign to the choice screen without deleting it or automatically requesting inference.

Workspace headers share one geometry: 32px desktop / 16px mobile gutters, a 24px gold Ripple mark, 9px wordmark gap and 25px text. Home, Audience, Campaign, Studio and Lab reuse that wordmark. Only the workspace capsule and mobile menu turn white in light mode; the landing navigation retains its own styling. Lab comparison and resimulation controls use clean text labels instead of decorative icons.

Home presentation: at the user’s request, Home displays every discovered profile as analyzed in its total and per-brand chart. This is a presentation override only; `loadHomeStats`, processing state and database counts remain accurate and unchanged.

## Campaign research features

The Campaign page includes an **In progress** sidebar for the current brand’s owned campaigns. Drafting, Lab and launch-ready campaigns can be resumed without creating new work. The list refreshes every three seconds and retains data through transient errors.

**Behind the campaign** shows the saved brief’s message angle, audience niche, audience size/share and key interests as a short rationale. Imported drafts are identified as user supplied. Missing briefs remain pending, and failed creative jobs surface their actual error rather than an invented explanation.

**Brand research** links to the real Exa sources cached by `creative.company.company_context`, showing article titles, dates and summaries. An expandable **Search activity** log shows actual query starts, completions, result counts, durations and failures. The panel polls every three seconds; observing research never triggers paid provider calls. Daily cache reuse displays saved sources without pretending new searches occurred.

`backend/creative/research_activity.py` observes existing company-context and video Exa requests, recording credential-free JSONL in `data/research/activity/<handle>.jsonl`. Restart the creative/video workers when idle to load this instrumentation; earlier cached research has source cards but no retroactively invented call logs. The local Vite dev/preview endpoint `/api/campaign-research?brand=<handle>` reads only that brand’s cache and journal and rejects traversal and non-GET requests. Research is brand-scoped, not a claim that every displayed article was cited by the selected draft. The selected draft rationale comes from its own persisted brief.

For a hosted static frontend, serve the same endpoint contract from the application backend: Vite middleware exists only in local dev/preview. Until then, the hosted UI keeps saved brief rationale and a retryable research-unavailable state.

Validation uses mocked provider/database boundaries for browser tests and temporary files for the research reader. Python tests verify request-start visibility, completion counts, credential-free failure records and failure isolation. No real scraping, generation or research calls are made by these tests.
