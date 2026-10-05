# Lab audience spread

The approved audience graphs live inside Lab's **Analysis**, above the existing recorded engagement-over-time graphs and checkpoint tables. The standalone spread preview route has been removed. The embedded graphs omit counts, ratios, percentages and the interest legend.

## Audience and campaign context

`loadSpreadAudience` reads the selected experiment's brand using the existing live audience helpers and prepares the same 3D network as the dashboard. Brands outside the built-in catalog are supported. A stable subset of at most 112 real profiles preserves each interest group's proportion with largest-remainder allocation, with less than one profile of rounding error per group. Bridge actors are selected to retain connections to as many neighboring groups as the sample budget permits. A and B share the same people and positions.

Names, handles, photos and profile links come from those audience records. Source nodes show the selected brand's actual logo and the labels A and B. Missing images fall back to initials. An unavailable audience shows Retry rather than borrowing another brand's map. All requests are read-only; opening analysis never starts a new experiment or paid inference.

## Reaction provenance and reach

**Audience profiles are real; spread reactions are illustrative frontend events.** The illustration is not a report of actual published reposts or recorded Lab reaction events. The section and popup actions state that distinction. Recorded engagement charts remain independent. Existing bridges include recorded reply/mention connections and estimated shared-interest overlap; scraped profiles awaiting analysis retain the dashboard's existing estimated group placement.

Each draft starts in an interest group relevant to its text and branches through available real bridges. A bridge's source actor makes an illustrative repost before the destination activates. One person's repost can hand off to multiple connected groups without inventing duplicate reposts. Likes highlight people but never trigger handoffs. Connected leaf groups, including Crypto/Web3 when connected, can be reached; disconnected groups stay unreached. Both drafts use the same rules, with independently seeded timing and engagement. Neither draft is assigned a winner.

## Popups, controls and layout

The shared notice schedule includes every bridge repost and at least 40% of each draft's illustrative repost events, rounded up. It prioritizes reposts over likes and staggers A/B notices chronologically. The illustration now runs twice as fast as the previous presentation. Each popup lasts 900ms, followed by a 125ms gap, with 100ms entry/exit transitions. The base event time scale is 0.8; each draft's event, arrival and handoff timestamps are retimed together so a selected repost popup starts exactly when that repost and its outgoing connection start. Other events interpolate between those anchors. Selected notices are never dropped or shown early, and the illustration finishes after the last notice. If a draft has no reposts, it can show one featured like.

Clicking a person pins their real profile details; clicking again or pressing Escape while focused dismisses them. Hover and focus also reveal details. Pause/restart affects only the illustration and reuses the loaded audience. Reduced motion shows the final still view without automatic popups.

The analysis dialog is 1160px wide where space permits. Graph panels stack on phones. Popups measure their actual stage and content dimensions and clamp inside an 18px gutter, leaving space for entry/exit motion and avoiding clipping at the panel boundary. Resizing updates the bounds.

## Verification

`npm run build` checks strict TypeScript and the production bundle. `npm test -- tests/lab-spread.spec.ts tests/lab-interactions.spec.ts` checks proportional sampling, real actor membership, connected and disconnected reach, repost causality, 40% notice coverage, staggered timing, both drafts, existing charts, desktop/mobile popup bounds, light mode, new brands, reduced motion and read-error recovery. Test fixtures intercept database requests and never submit paid inference.

After the user restored visibility, a read-only TryCua smoke check loaded 223 profiles. Both illustrative drafts reached all six connected interest groups, including Crypto/Web3. The checked variation scheduled 13 of 32 A reposts and 10 of 25 B reposts as popups; every selected event began exactly with its popup. No database rows or recorded results were changed.
