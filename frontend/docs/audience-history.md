# Live audiences and history

The Audience screen renders the complete prepared 3D graph. It has no company
node, origin-to-cluster lines, reveal simulation, or 2D switch. Live and saved audience maps show one aggregated edge per connected cluster pair.
Recorded replies/mentions and shared niche interests contribute to connectivity;
more unique connections produce a thicker, more visible line. Unconnected pairs
receive no edge. Recorded ties remain in the data model for layout and simulations. Orbit, zoom, niche focus, cached sprites, reduced motion and the
existing graph size limits remain available.

The live map reads Scweet profiles and audience membership every five seconds.
Profiles appear before their twins are built, in a “Building profiles” group.
Pending profiles do not display inferred engagement or affinity scores. Layout
preparation runs in a worker only when the audience data changes. An unchanged
poll leaves the current graph and cached assets intact.

## History

The History button in both Audience and Lab opens the same searchable drawer,
with Audience maps and Lab experiments tabs, date groups, keyboard focus trapping,
Escape dismissal, and mobile layout. It reads real SpacetimeDB records. Empty audience snapshots are hidden. Lab history
excludes companies that have neither live audience membership nor a populated saved
audience; failed experiments for companies with real audience data remain visible.

An audience version opens `/dashboard?brand=<handle>&snapshot=<id>`. Its saved
payload is immutable and is not polled or replaced with current profiles. The
Live audience link returns to the current scrape. Lab entries open their original
experiment IDs, retaining drafts, trial results, comments and profile imagery.
`archived_profile` provides profiles after their source imports are removed.
Historical audiences can also support read-only Lab niche filters and the islands
visualization when their active source profiles no longer exist. Historical data
is never substituted into the live Audience map.

Brand controls list actual Scweet audience membership. The Lab defaults to the
X handle `raycast`; retired brands remain reachable through History and explicit
experiment links.

## Worker and archive operations

Run the worker from `backend/`:

```sh
uv run python -m twins onboarding-worker
```

The worker archives an existing audience before refresh, saves the ready version,
and saves the completed backfill version. Each new ingestion run uses a separate
Scweet cache directory; backfill can reuse that same run's cache.

Before an intentional reset, stop ingestion writers and let active Lab and twin
jobs finish. Create a private backup and archive maps with:

```sh
uv run python -m twins.audience_history --backup /absolute/private/backup.json --reset
```

The reset reducer refuses active builds and unarchived audiences or profiles.
It removes active imported source data, build jobs, old twins and graph inputs,
while preserving audience snapshots, archived profiles, onboarding briefs and all
Lab/simulation records. It queues fresh runs for the previously onboarded X brands.
The admin-only `retry_onboarding` reducer creates a new attempt for a failed job,
keeping its brief and failed attempt. `retire_archived_audience` removes stale
archived-only twin links without disturbing fresh Scweet memberships; it refuses
active experiments and audiences that still have source posts or live membership.

On 2026-10-04, all imported platforms, including Bluesky, were reset after ten
snapshots and 1,944 profiles were archived. Ten existing Lab experiments were
retained. Private backups are outside the repo under
`~/.local/share/ripple/backups/imports-before-reset-20261004-{01,final}.json`.
Fresh Scweet runs for raycast, spacetimedb, supermemory and linear reached ready.
Backfill continues under the scraper's account budgets and rate limits.

Onboarding uses one small breathing orb on the right of the currently active
Followers, Twins or Audience map row. Completed and waiting stages have no orb;
ready/failed states stop loading, and reduced motion freezes the orb.

Cluster badges show each niche’s percentage of the whole audience. The badges and niche index share the same largest-remainder percentage calculation so displayed shares sum to 100%. The index uses larger type inside a bordered panel; connectivity remains aggregated by cluster pair.
