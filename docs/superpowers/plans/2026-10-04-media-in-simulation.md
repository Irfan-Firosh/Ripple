# Images and Video in the Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Lab draft can carry images or a video. Claude-built twins react to the whole post (text plus visuals), and the tweet columns show the media the way X does.

**Architecture:**
- **Browser:** resizes images and samples video keyframes.
- **SpacetimeDB:** stores them as data URLs in `lab_media`, using a three-phase submit.
- **Worker:** writes one media brief per draft (a Claude vision call), then scores every twin with the images in a prompt-cached prefix.
- **Cascade:** unchanged.

**Tech Stack:** SpacetimeDB 2.10 TS module; Python 3.12 (`anthropic` content blocks with `cache_control`, Pillow for agent-side resizing); React 19 + Vite + Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-media-in-simulation-design.md`

## Global Constraints

- **Model:** `claude-haiku-4-5-20251001`. Images are sent as base64 `image` content blocks. Never log image data or secrets.
- **Limits:**
  - per draft: 0–4 images **or** 1 video (poster plus up to 6 keyframes from the first 120 s);
  - images resized in the browser to a 1024 px long side, JPEG at quality 0.82;
  - a stored data URL is ≤ 400 KB;
  - alt text ≤ 200 chars, transcript ≤ 1,000 chars.
- **SpacetimeDB:**
  - module changes are **additive only**: smoke-test on a scratch DB, publish without clearing data, compare row counts;
  - object fields are snake_case on the wire.
- **No media, no change:** with no media, the scoring prompt must be byte-identical to today's (pinned by a test).
- **The cascade is unchanged.**
- **Ownership:** the Lab UI files under `frontend/src/lab/` belong to whoever owns that folder when this runs (currently Codex). Check `git status` first and never overwrite another agent's uncommitted files.
- **Commits:** conventional commits, no attribution. The user confirms pushes.

## Review Focus

1. **A 5 MB phone photo, HEIC, or animated GIF:**
   - the photo is resized under 400 KB;
   - HEIC is rejected with "convert to JPEG";
   - a GIF uses its first frame.

   Covered in Task 5.
2. **The user closes the tab mid-upload:** the experiment stays `uploading`, is never claimed, and is reaped after 15 minutes. Covered in Task 1 (smoke) and Task 3.
3. **Claude rejects an image:** the brief fails gracefully, scoring runs on text plus "media could not be analysed", and the draft shows a warning. Covered in Task 2.
4. **Someone attaches media to another person's draft, or after submit:** rejected. Covered in Task 1 (smoke).
5. **A 1,000-twin A/B with 4 images per draft:** images are cached once per draft (`cache_control` on the last image block), and the run stays within the 300 s Lab deadline. Covered in Task 2 (`test_images_sit_in_one_cached_prefix`) and Task 6 (live).

---

## File Structure

```
x-followers-db/src/index.ts       # + lab_media, lab_media_brief; create_lab_draft / attach_lab_media / submit_lab_experiment / set_lab_media_brief
x-followers-db/smoke-media.sh     # new scratch-DB smoke
backend/twins/media.py            # new: MediaItem, MediaSet, load_media, image_blocks, write_brief
backend/twins/llm.py              # call_tool(..., images=...) → content blocks with cache_control
backend/twins/policy.py           # score_signals(..., media=MediaSet | None)
backend/twins/comments.py         # brief passed into the comment prompt
backend/twins/simulate.py         # run_lab loads media, writes briefs, passes media through
backend/twins/lab.py              # reaper also fails stale 'uploading' drafts
backend/agents/contracts.py       # SimulateRequest.image_urls (additive)
backend/agents/fetch_media.py     # new: safe URL fetch + Pillow resize for agent requests
frontend/src/lab/media.ts         # new: resizeImage, sampleVideo, validateFiles (pure browser helpers)
frontend/src/lab/labData.ts       # + LabMedia types, loadMedia, three-phase requestExperiment
frontend/src/lab/<owner's tweet + composer components>   # media grid + attach UI (owner of the folder)
tests: backend/tests/test_media.py test_llm_images.py test_policy_media.py test_fetch_media.py; frontend/tests/lab-media.spec.ts
```

---

### Task 1: SpacetimeDB media tables and three-phase submit

**Files:** modify `x-followers-db/src/index.ts`; create `x-followers-db/smoke-media.sh`; README rows.

**Interfaces:**
- Produces these reducers:
  - `create_lab_draft(brand, title, draftA, draftB)` (public): status `uploading`;
  - `attach_lab_media(experimentId: u64, items: array<{draft, kind, mime, data_url, width, height, order, alt, at_seconds, video_seconds, transcript}>)` (public, requester only, `uploading` only);
  - `submit_lab_experiment(experimentId: u64)` (public, requester only): `uploading` → `queued`;
  - `set_lab_media_brief(experimentId: u64, draft: string, text: string)` (admin).
- Produces these tables:
  - `lab_media(media_id, experiment_id, draft, kind, mime, data_url, width, height, order, alt, at_seconds, video_seconds, transcript)`;
  - `lab_media_brief(brief_id, experiment_id, draft, text)`.

- [ ] **Step 0: Probe the row-size limit.** On a scratch DB, insert data URLs of 100 KB, 400 KB and 1 MB through a temporary reducer. Record the largest that succeeds. If 400 KB fails, lower the browser JPEG quality or the resize target in Task 5 until a 4-image draft fits, and record the ruling.

- [ ] **Step 1: Failing smoke test** (`smoke-media.sh`, the same harness as `smoke-lab.sh`; brand setup copied from it):

```bash
call create_lab_draft '"brandx"' '"With media"' '"Draft A"' '"Draft B"'
expect "$(sql "SELECT status FROM lab_experiment WHERE experiment_id = 1")" 'uploading'
IMG='"data:image/jpeg;base64,'"$(head -c 3000 /dev/urandom | base64 | tr -d '\n')"'"'
call attach_lab_media 1 "[{\"draft\":\"A\",\"kind\":\"image\",\"mime\":\"image/jpeg\",\"data_url\":$IMG,\"width\":1024,\"height\":768,\"order\":0,\"alt\":{\"none\":[]},\"at_seconds\":{\"none\":[]},\"video_seconds\":{\"none\":[]},\"transcript\":{\"none\":[]}}]"
must_fail claim_lab_experiment 1                                       # worker can't take an uploading draft
for i in 1 2 3 4; do ITEMS=...; done                                   # 5th image on A → must_fail attach_lab_media
must_fail attach_lab_media 1 '<image + video_poster on the same draft>'
must_fail attach_lab_media 1 '<data_url over the limit>'
call submit_lab_experiment 1
expect "$(sql "SELECT status FROM lab_experiment WHERE experiment_id = 1")" 'queued'
must_fail attach_lab_media 1 '<any item>'                              # media is frozen after submit
call set_lab_media_brief 1 '"A"' '"A laptop showing the Raycast launcher"'
expect "$(sql "SELECT text FROM lab_media_brief WHERE brief_id = '1:A'")" 'Raycast launcher'
```

Run: `./smoke-media.sh`. Expected: `FAIL: create_lab_draft` (the reducer doesn't exist yet).

The "other sender" case needs a second identity: create it with `curl -X POST .../v1/identity` and call `attach_lab_media` with that token. It must fail. Put this in the smoke script with curl.

- [ ] **Step 2: Implement the tables and reducers.**
  - `create_lab_draft` reuses `request_lab_experiment`'s validation through a shared `validateLabRequest(ctx, …)` helper, then inserts with status `uploading`.
  - `attach_lab_media` enforces:
    - the sender equals `requestedBy`;
    - status is `uploading`;
    - per draft: ≤ 4 images, or exactly one `video_poster` plus ≤ 6 `video_frame`, never both;
    - `data_url` starts with `data:image/` and is within the Step 0 limit;
    - alt ≤ 200, transcript ≤ 1,000.
  - `submit_lab_experiment` checks the sender and status, then sets `queued`.
  - `set_lab_media_brief` (admin) clips text to 600 chars.

- [ ] **Step 3: Build, smoke, publish additively, commit.**

Run: `spacetime build && ./smoke-media.sh && ./smoke-lab.sh && ./smoke-sim.sh`
Expected: all OK. Then publish with the row-count check, and commit `feat(spacetime): lab media tables and three-phase submit`.

---

### Task 2: Images in Claude calls (`call_tool`, media brief, scoring)

**Files:**
- modify `backend/twins/llm.py` and `backend/twins/policy.py`;
- create `backend/twins/media.py`;
- tests `backend/tests/test_llm_images.py` and `backend/tests/test_policy_media.py`.

**Interfaces:**
- `MediaItem(kind: str, mime: str, data_b64: str, alt: str = "", at_seconds: float | None = None)`
- `MediaSet(items: dict[str, list[MediaItem]], briefs: dict[str, str], transcripts: dict[str, str])`, keyed by draft id `"A"`/`"B"`
- `image_blocks(items) -> list[dict]`: Anthropic `{"type":"image","source":{"type":"base64","media_type":mime,"data":b64}}`, each preceded by a text label block
- `call_tool(client, *, system, user, ..., images: list[dict] | None = None)`: when `images` is set, `content = [*images (last one carries "cache_control": {"type": "ephemeral"}), {"type": "text", "text": user}]`; otherwise `content = user` (unchanged)
- `write_brief(client, draft_text, items, transcript) -> str` (≤ 600 chars; returns `"media could not be analysed"` on failure)
- `score_signals(client, twins, drafts, *, media: MediaSet | None = None, …)`

- [ ] **Step 1: Failing tests**

```python
# backend/tests/test_llm_images.py
from types import SimpleNamespace
from pydantic import BaseModel
from conftest import FakeClient
from twins.llm import call_tool

class Out(BaseModel):
    ok: bool

def test_without_images_the_request_is_unchanged():
    c = FakeClient([{"ok": True}])
    call_tool(c, system="s", user="u", tool_name="t", description="d", output_model=Out)
    assert c.calls[0]["messages"][0]["content"] == "u"

def test_images_sit_in_one_cached_prefix():
    c = FakeClient([{"ok": True}])
    imgs = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "AAA"}},
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "BBB"}}]
    call_tool(c, system="s", user="u", tool_name="t", description="d", output_model=Out, images=imgs)
    content = c.calls[0]["messages"][0]["content"]
    assert [b["type"] for b in content] == ["image", "image", "text"] and content[-1]["text"] == "u"
    assert "cache_control" not in content[0] and content[1]["cache_control"] == {"type": "ephemeral"}
```

```python
# backend/tests/test_policy_media.py
from conftest import FakeClient
from test_graph import bt
from test_policy_signals import entry
from twins.media import MediaItem, MediaSet
from twins.policy import score_signals

def media():
    return MediaSet(items={"B": [MediaItem(kind="image", mime="image/jpeg", data_b64="QUJD", alt="launcher screenshot")]},
                    briefs={"B": "Screenshot of the Raycast launcher on Windows"}, transcripts={})

def test_no_media_prompt_is_byte_identical():
    a, b = FakeClient([{"scores": [entry("a", (0.1, 0, 0, 0), (0.1, 0, 0, 0))]}]), FakeClient([{"scores": [entry("a", (0.1, 0, 0, 0), (0.1, 0, 0, 0))]}])
    score_signals(a, [bt("a", "x", 1)], ["A", "B"], workers=1)
    score_signals(b, [bt("a", "x", 1)], ["A", "B"], workers=1, media=None)
    assert a.calls[0]["messages"] == b.calls[0]["messages"] and isinstance(a.calls[0]["messages"][0]["content"], str)

def test_media_images_and_briefs_reach_every_batch():
    c = FakeClient([{"scores": [entry(f"u{i}", (0.1, 0, 0, 0), (0.2, 0, 0, 0)) for i in range(10)]}] * 2)
    score_signals(c, [bt(f"u{i}", "x", 1) for i in range(20)], ["A", "B"], workers=1, media=media())
    for call in c.calls:
        content = call["messages"][0]["content"]
        assert any(b.get("type") == "image" for b in content)
        assert "Screenshot of the Raycast launcher" in content[-1]["text"] and "[Draft B image 1]" in str(content)
```

Also a `write_brief` test: a `FakeClient([None, None])` returns `"media could not be analysed"` without raising, and a `FakeClient([{"brief": "A laptop…"}])` returns the text clipped to 600 chars.

Run: `uv run pytest tests/test_llm_images.py tests/test_policy_media.py -v`. Expected: FAIL (`images` is an unexpected keyword / no `twins.media`).

- [ ] **Step 2: Implement.**
  - `call_tool`: add `images` exactly per the interface.
  - `media.py`:
    - `image_blocks` labels each image with a text block (`[Draft B image 1] alt: …` or `[Draft A video frame at 12s]`) followed by the image block;
    - `write_brief` makes one forced-tool call (`_Brief(brief: Text(600))`) with system text: "Describe what a social media user sees in this post's media: subjects, on-screen text, branding, mood, quality, anything off-putting. ≤ 600 characters."
  - `policy._signal_batch`: when `media` is set, put the drafts' briefs and transcripts into the text after the twin lines (`<media draft="B">brief…</media>`). Pass `images=[*image_blocks(A items), *image_blocks(B items)]` to `call_tool`, in a deterministic order, so every batch has the identical cacheable prefix.
  - Update `SIGNAL_SYSTEM`: "Some drafts include images or video frames (shown before the twins); judge the whole post."

- [ ] **Step 3: Full suite green, commit:** `feat(twins): images and video frames in Claude scoring with a cached media prefix`.

---

### Task 3: Worker loads media, writes briefs, passes media through; reaper handles uploads

**Files:**
- modify `backend/twins/simulate.py`, `backend/twins/lab.py` and `backend/twins/comments.py`;
- tests in `test_simulate_lab.py`, `test_lab.py` and `test_comments.py`.

**Interfaces:**
- `load_media(stdb, experiment_id) -> MediaSet` (reads `lab_media` and decodes the data URLs to base64 plus mime)
- `run_lab(..., experiment_id: int | None = None)`:
  - when it's set, load the media, write the briefs (in parallel, with `set_lab_media_brief`), then score with `media=`;
  - pass the brief to `write_comments(..., media_brief=…)`.
- `reap_stale` also fails `uploading` experiments older than `STALE_SECONDS`.

- [ ] **Step 1: Failing tests.**
  - `run_lab` with a FakeStdb holding `lab_media` rows for B:
    - `set_lab_media_brief` is called once, for B only;
    - the scoring calls carry an image block;
    - `write_comments` receives the brief.
  - `reap_stale` fails a 20-minute-old `uploading` row and leaves a 1-minute-old one alone.
  - `run_pending_labs` passes `experiment_id` to the runner.
- [ ] **Step 2: Implement.** `lab.run_pending_labs` calls the runner with `experiment_id=row["experiment_id"]`. `run_lab` calls `load_media`, writes the briefs with a `ThreadPoolExecutor(2)`, then continues as today.
- [ ] **Step 3: Suite green, commit:** `feat(lab): worker analyses draft media and scores twins on the whole post`.

---

### Task 4: Agents accept image URLs safely

**Files:**
- `backend/agents/contracts.py` (`SimulateRequest.image_urls: list[str] = []`);
- create `backend/agents/fetch_media.py`;
- `backend/agents/handlers.py`;
- test `backend/tests/test_fetch_media.py`;
- `uv add pillow`.

**Interfaces:** `fetch_images(urls, *, get=requests.get, max_items=4, max_bytes=10_000_000, timeout=10) -> tuple[list[MediaItem], list[str]]` returns the items plus the skipped URLs with reasons. It allows only http/https, a public host (it rejects localhost and private IP ranges, to block SSRF), and an `image/*` content type. Images are resized with Pillow to a 1024 px long side, JPEG at quality 0.82.

- [ ] **Step 1: Failing tests:**
  - `file://` and `http://127.0.0.1/` URLs are skipped;
  - a 12 MB body is skipped;
  - a 3000×2000 PNG becomes a ≤ 1024 px JPEG;
  - a 5th URL is ignored;
  - a skipped URL is reported in `SimulateResult.summary`.
- [ ] **Step 2: Implement.** `handle_simulate` builds a `MediaSet(items={"A": items}, briefs={"A": write_brief(...)})` when `image_urls` is set, and passes it to `run_simulation(..., media=)`. Extend `run_simulation` with the same `media=` keyword.
- [ ] **Step 3: Suite green, commit:** `feat(agents): simulate drafts with images from URLs (SSRF-safe fetch)`.

---

### Task 5: Browser media helpers and the data contract

**Files:** create `frontend/src/lab/media.ts`; modify `frontend/src/lab/labData.ts`; test `frontend/tests/lab-media.spec.ts`.

**Interfaces:**
- `validateFiles(files: File[]) -> { ok: File[]; error: string | null }`: applies the limits table, rejects HEIC, rejects mixing images with a video, and allows at most 4 images or 1 video.
- `resizeImage(file: File) -> Promise<{ dataUrl: string; width: number; height: number; mime: 'image/jpeg' }>`: draws the image onto a canvas at a 1024 px long side and exports JPEG at quality 0.82. If the result exceeds the Task 1 limit, it retries at 0.7, then at 800 px.
- `sampleVideo(file: File) -> Promise<{ poster: Frame; frames: Frame[]; seconds: number }>`: loads `<video>` from an object URL, seeks to 0.5 s for the poster and to evenly spaced times within the first 120 s (up to 6), and draws each frame onto a canvas.
- `labData.requestExperiment(input & { media?: { A?: DraftMedia; B?: DraftMedia } })`:
  - with media: `create_lab_draft`, then one `attach_lab_media` call per draft, then `submit_lab_experiment`, returning the experiment id (read back by the sender identity's newest `uploading` row);
  - without media: unchanged.
- `loadMedia(experimentId) -> Promise<{ A: LabMedia[]; B: LabMedia[]; briefs: Record<'A' | 'B', string> }>`

- [ ] **Step 1: Failing Playwright tests** (`page.evaluate` importing `/src/lab/media.ts`):
  - a generated 4000×3000 PNG resizes to 1024×768 under the limit;
  - a 1×1 HEIC-named file is rejected;
  - images mixed with a video are rejected;
  - a 2-second WebM made with `MediaRecorder` on a canvas yields a poster and ≤ 6 frames;
  - `loadMedia` on the Task 6 seeded experiment returns B's image.
- [ ] **Step 2: Implement the helpers and the labData changes.**
- [ ] **Step 3: `npx tsc -b && npx playwright test tests/lab-media.spec.ts` green, commit:** `feat(lab): browser media resize/sampling and three-phase upload`.

---

### Task 6: Tweet media grid and composer attachments (owner of `frontend/src/lab/`), plus a live check

**Files:**
- the tweet component and the composer in `frontend/src/lab/`, whichever files the folder's owner uses at the time;
- `frontend/tests/lab-media.spec.ts` (UI cases).

**Behaviour:**
- **Image grid**, under the tweet text and above the counters, with a 16 px radius and a 2 px gap:
  - 1 image: full width, 16:9 crop, at most 510 px tall;
  - 2 images: side by side;
  - 3 images: one tall image on the left and two stacked on the right;
  - 4 images: a 2×2 grid.

  Alt text becomes the `alt` attribute.
- **Video:** the poster with a centred play glyph and a `0:45` badge in the bottom-left. Clicking it plays the local file if this tab created the experiment; otherwise it opens a lightbox that steps through the keyframes.
- **"What the twins saw":** a muted, collapsible line under the media showing the draft's media brief.
- **Composer:** each draft gets an attach button (image and video icons), thumbnail previews with remove (×), alt-text inputs, and the optional transcript field for videos. Errors come from `validateFiles`, and the upload shows progress ("Uploading 3/5…").

**Steps:**

- [ ] **Step 1: Failing UI tests:**
  - an experiment with one image on B renders `img[alt="launcher screenshot"]` inside Draft B's article, and none in A;
  - the composer rejects a 5th image with the limits message.
- [ ] **Step 2: Implement it in the owner's components.** Check `git status` first.
- [ ] **Step 3: Live check:**
  - start the worker;
  - in the browser, queue a Raycast experiment with identical text, where B has a real product screenshot (e.g. `frontend/public/` assets) and A has none;
  - expect B's brief to describe the screenshot, B's probabilities to differ from A's, both to finish within 300 s, and the grid to render.

  Commit `feat(lab): X-style media in tweets and attachments in the composer`.

---

## Self-review notes

- **Spec coverage:**

  | Spec requirement | Task |
  |---|---|
  | Images as real inputs | 2 |
  | Video keyframes | 5 and 2 |
  | Briefs | 2 and 3 |
  | Cached prefix | 2 |
  | Storage and three-phase submit | 1 and 5 |
  | Limits | 1 and 5 |
  | Reaper | 3 |
  | Agents' `image_urls` | 4 |
  | UI grid and composer | 6 |
  | No-media prompt unchanged | 2 |
  | Cascade unchanged | no task; intentional |
- **Type consistency:**
  - `MediaSet` keys `"A"`/`"B"` match the `lab_media.draft` values;
  - `attach_lab_media` item fields are snake_case, matching what the TS helper sends;
  - `write_brief` returns `str` everywhere.
- **Known unknown:** the SpacetimeDB row-size limit. Task 1 Step 0 measures it first, and Task 5's resize targets follow from it.
