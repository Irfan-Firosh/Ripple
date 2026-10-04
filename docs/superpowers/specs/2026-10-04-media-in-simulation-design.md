# Images and video in the Lab simulation: design

**Status:** draft for review (2026-10-04).
**Asked for by the user:**
- "marketing campaigns involve pictures and actual video content";
- "be aware in the plans that images can be included in the simulation and make sure that simulation can handle it".

**Builds on:**
- the current simulator: everyone sees the post, per-signal Claude scores, reposts compound beyond the audience, comments;
- the Lab data contract (`frontend/src/lab/labData.ts`).

## What the user gets

A draft in the Lab, and later in the agents, can carry media:
- up to 4 images, or
- 1 video, which can be any length the browser can decode; the browser keeps the first 2 minutes for sampling.

The twins react to the **whole post**: text plus what is actually in the pictures or the video. The tweet columns show the media the way X does: an image grid, or a video poster with a play badge and its duration. Comments can refer to the visuals.

## Decisions (and why)

| Decision | Why |
| --- | --- |
| **Images go to Claude as real image inputs.** Haiku 4.5 is multimodal. | Twins judge the actual picture, not a caption. |
| **Video becomes up to 6 keyframes plus the duration**, extracted in the browser (`<video>` + `<canvas>`). | Claude can't take video, and keyframes carry most of the signal. |
| **No audio transcription in v1.** If the video has speech, the user can paste it into an optional "What's said in the video" field, which goes in as text. | Keeps the build browser-only, with no new speech API. |
| **Each draft gets one media brief:** a single Claude call per draft, producing what's shown, on-screen text, branding, mood, and anything off-putting (≤ 600 chars). It is stored and shown on the card. | Agents and comments get text context cheaply. The UI can say "what the twins saw". |
| **Scoring batches include the actual images** (resized) in a **prompt-cached prefix**, plus the brief. | ~100 batches per Raycast run would otherwise re-pay for the images on every call. With caching, the image tokens are billed once per draft and then read at about 10% cost. |
| **Media is resized in the browser** to a 1024 px long side, JPEG at quality 0.82 (about 80–250 KB each), and stored in SpacetimeDB as data URLs in a new `lab_media` table. | SpacetimeDB already stores images as data URLs (`x_user.profile_image`). There is no new storage service. The 1024 px size matches Claude's recommended input size. |
| **The video file itself is never uploaded.** Only the poster and keyframes are stored. The page that created the experiment can play the local file; everyone else sees the poster with a duration badge. | Video files are too large for database rows, and the simulation only needs frames. |
| **Two-phase submission:** `create_lab_draft` (status `uploading`), then one `attach_lab_media` call per item, then `submit_lab_experiment` (status `queued`). | One request carrying 8 × 250 KB is fragile. The worker only claims `queued` rows, so it never starts on half-uploaded media. |
| **The cascade model is unchanged.** Media changes Claude's per-person probabilities, and so likes, reposts, replies, quotes and reach. | One source of truth; the existing tests keep their meaning. |
| **Agents:** `SimulateRequest` gains an optional `image_urls: list[str] = []` (additive). The Simulation agent fetches the images (≤ 4, ≤ 10 MB each, http/https only) and resizes them server-side. | Lets the teammate's orchestrator forward ASI:One attachments later without breaking anything today. |

## Limits and validation

These apply in the browser and are mirrored in the reducers. Every rejection gets a clear message.

| Rule | Limit |
| --- | --- |
| Media per draft | 0–4 images, **or** 1 video. Not both. |
| Image types | JPEG, PNG, WebP, GIF (first frame only), HEIC is rejected with "convert to JPEG" |
| Image file size before resizing | ≤ 20 MB |
| Stored data URL | ≤ 400 KB |
| Video types | MP4, WebM, MOV (whatever the browser can decode) |
| Video sampling | the first 120 s; keyframes at evenly spaced times (6 frames, or fewer for short clips) plus a poster at 0.5 s |
| Optional alt text | ≤ 200 chars per image |
| Optional "What's said in the video" | ≤ 1,000 chars |

Media cannot be changed after submitting. A failed upload leaves the draft in `uploading`; the existing reaper deletes it after 15 minutes. It never reaches the worker.

## Data model (SpacetimeDB, additive)

- **`lab_media`:**
  - columns: `media_id` (PK `${experimentId}:${draft}:${order}`), `experiment_id`, `draft` (A|B), `kind` (image|video_poster|video_frame), `mime`, `data_url`, `width`, `height`, `order`, `alt`, `at_seconds` (frames only);
  - plus `video_seconds` and `transcript` on the poster row.
- **`lab_media_brief`:** `brief_id` (PK `${experimentId}:${draft}`), `text`.
- **`lab_experiment`:** unchanged columns. The new `uploading` status is set by `create_lab_draft`.
- **New reducers:**
  - `create_lab_draft` (public): same checks as `request_lab_experiment`, status `uploading`.
  - `attach_lab_media` (public, sender must be the draft's requester, status must be `uploading`, limits enforced).
  - `submit_lab_experiment` (public, requester only; moves `uploading` to `queued`).
  - `set_lab_media_brief` (admin).

## Pipeline

1. **Browser:** pick files, then resize or extract frames, then preview (an X-style grid with remove buttons), then submit in the three phases.
2. **Worker:** claim the experiment and load `lab_media` for A and B. For each draft with media, write the media brief (1 Claude call with the images) and store it.
3. **Scoring:** `score_signals(..., media=MediaSet(a=..., b=...))`. Every batch's user message starts with a cached block:
   - the images, labelled `[Draft A image 1]`, …;
   - each draft's brief;
   - the twin lines and the draft texts after it.

   Without media, the prompt is byte-for-byte what it is today.
4. **Comments:** `write_comments` gets the brief, so replies can mention the visuals.
5. **Cascade and replay:** unchanged.

## Cost and latency (Raycast, 999 twins, A/B with 4 images each)

- **Brief calls:** 2 calls, each with about 4 × ~1.2k image tokens.
- **Scoring:** 100 batches. The cached image prefix is about 10k tokens; it's written once per cache window and then read at about 10% of the input price. So each batch adds about 1k effective input tokens.
- **Estimate:** about $0.30–0.60 extra per experiment, and about 10–20 s more latency (the briefs run in parallel). The 300 s Lab deadline stays.

## Error handling

- **Image-input failures:** a Claude error on image input (unsupported, too large) fails that draft's brief with a clear message. Scoring then continues with text plus "media could not be analysed", and the UI shows a warning on that draft.
- **Missing media:** if media rows are missing when the worker claims the experiment (a race should be impossible after `submit`), the experiment fails with "media missing; please re-run".
- **Bad image URLs from agents:** an agent `image_urls` entry that isn't http/https, times out (10 s), or is too big is skipped. The skip is reported in `SimulateResult.summary`.

## Testing

- **Backend unit tests (pytest, FakeClient / FakeStdb):**
  - image blocks are built correctly and sit in a cached prefix;
  - the brief call happens once per draft;
  - no media means an unchanged prompt;
  - brief failures are tolerated;
  - agent URL validation.
- **Reducer smoke (scratch DB):**
  - the upload, attach and submit flow;
  - the worker can't claim `uploading` rows;
  - a non-requester cannot attach;
  - limits (5th image, image plus video, oversized data URL) are rejected;
  - the reaper fails stale uploads.
- **Browser tests:** resize and keyframe helpers, using `page.evaluate` against generated canvases and a tiny bundled WebM; the composer flow; X-style grid rendering for 1, 2, 3 and 4 images and for a video poster.
- **Live:** one Raycast A/B with the same text, where A has a strong product screenshot and B has none. Expect the probabilities, and so the counts, to differ, and the brief to describe the screenshot.

## Out of scope (v1)

- audio transcription;
- uploading full video files;
- media in the dashboard network view;
- ASI:One attachment forwarding (the teammate's orchestrator change; our side accepts `image_urls`).

## Ownership note

The Lab UI files in `frontend/src/lab/` are being built by Codex. The frontend tasks in the plan name the exact files and contracts, so whoever owns that folder when the plan runs can do them. Nobody edits another agent's uncommitted files.
