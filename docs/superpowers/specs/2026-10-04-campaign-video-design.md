# Campaign videos: Opus 5.5 writes the film (design)

Approved in chat 2026-10-04. Simple version of the open-source harness `howseen-ai/claude-motion-design` (MIT).

## Goal
For one brand + campaign news, produce a voiced 16:9 marketing video of at most 20 s plus a thumbnail, with no
video model and no fabricated facts.

## Pipeline (`backend/video/`)
1. **Research (Exa, `EXA_API_KEY`)**: search the company and the news; keep the top results' text with URLs.
2. **Director (Opus 5.5, `CLAUDE_API_KEY_2` only)**: structured brief: title, one-line promise, named reference
   style, accent + background hex, 4-6 beats (voiceover line, on-screen text, visual idea), thumbnail prompt,
   facts used (each with its source URL). On-screen numbers must come from the facts; anything else is labelled
   "Example".
3. **Voiceover (ElevenLabs, `ELEVENLABS_API_KEY`)**: one TTS call with character timestamps; the timeline is the
   voice: each beat starts at its first word; total <= 20 s (hard cap, the brief is rejected above 18 s of VO).
4. **Film (Opus 5.5)**: one self-contained HTML page implementing `window.seek(t)` (pure function of time) on top of
   `harness/core.js` (closed-form springs, easings, masked word rise, seeded PRNG). Anti "AI look" rules in the prompt.
5. **Stills check (Opus 5.5 vision)**: 4 stills on a contact sheet, scored 1-10; one revision pass if any score < 7.
6. **Render**: Playwright Chromium, 1920x1080, 30 fps, 2 subframes blended (tmix), network blocked except the film
   folder (the page is model-written code). Mux voiceover + synthesized whooshes, two-pass loudnorm -14 LUFS.
7. **Thumbnail (Grok Imagine, `X_API_KEY`)**: one 16:9 image, no text; title overlaid in code (1280x720 JPEG).

Output: `frontend/public/generated/videos/<video_id>/` with `video.mp4`, `thumbnail.jpg`, `film.html`, `meta.json`
(brief, facts, timings, scores, costs).

## Later (not in this pass)
`campaign_video` table + job worker (creative_job pattern) and a Video panel in Campaign Studio; Lab scoring of the
script + thumbnail by the twins; 9:16 from the same timeline.

## Testing
Unit: word timings from ElevenLabs alignment, beat start times, brief validation (beats, duration cap, hex),
HTML extraction/validation, network allow-list, thumbnail overlay size. Live: one real end-to-end render.
