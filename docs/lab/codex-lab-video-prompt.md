# Codex prompt: campaign video in the Lab tweet

Paste everything below the line into Codex. The backend and SpacetimeDB tables are live; build only the frontend.

---

## Task
Show a campaign video as the media of a Lab draft, exactly where an X post shows its video (under the tweet text,
above the action counts), and let the user make or attach one from the Lab composer. Keep the existing Lab layout,
two tweet columns and live counts. Touch only `frontend/src/lab/*` and a new test file.

## Data (SpacetimeDB maincloud `ripple-mhacks`; read with the existing `sql()` helper, write like `requestExperiment`)
- `campaign_video` row: `video_id, brand, campaign_id, news, goal, status, progress (0..1), title, video_url,
  thumbnail_url, duration_s, script_json, review_json, error, created_at, updated_at`.
  `status`: `queued -> research -> brief -> voice -> film -> stills -> (revise) -> render -> thumbnail -> done | failed`.
  `video_url` / `thumbnail_url` are app paths (e.g. `/generated/videos/raycast-v2/video.mp4`), served by Vite.
- `lab_draft_media` row: `media_id ("<experiment_id>:<A|B>"), experiment_id, draft, video_id, created_at`.
- Reducers (HTTP JSON array args, same token pattern as `requestExperiment`):
  - `request_campaign_video [brand, news, goal, campaign_id]` queues a video (errors: `a video is already being
    made`, `describe the news in 1..600 characters`). The `python -m video worker` process makes it (~5 min).
  - `attach_lab_draft_media [experiment_id, "A"|"B", video_id]` (only the experiment's requester; `video_id = ""`
    detaches). Errors: `the video is not finished yet`, `not your experiment`.

## UI
1. **Tweet media**: in the Lab tweet, if the draft has a `lab_draft_media` row whose video is `done`, render a 16:9
   `<video>` with `poster={thumbnail_url}`, `controls`, `muted`, `playsInline`, `preload="metadata"`, rounded 16px,
   1px border like X's media card; clicking unmutes. No autoplay with sound. Keep counts and comments below it.
2. **Composer**: next to each draft, a small "Video" control: pick a finished video for this brand (thumbnail grid
   from `campaign_video WHERE brand = ...`, newest first) or "Make one" (news prefilled from the draft text) which
   calls `request_campaign_video` and shows a thin progress bar with the stage name while polling every 3 s.
3. After the experiment exists, attach the chosen videos with `attach_lab_draft_media`.
4. Failed video: show `error` inline with a retry. Empty state: "No videos yet. Make one."

## Tests
`frontend/tests/lab-video.spec.ts` with `page.route` mocks (never the real database): media renders under the right
draft with its poster; composer request sends the 4 args; progress text follows `status`; attach sends
`[id, "B", video_id]`; failed video shows its error. `npm run build` must pass.

## Note
The twins do not yet react to the video itself (they score the text). Don't label counts as video-aware.
