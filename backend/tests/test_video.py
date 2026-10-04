"""Campaign video pipeline: the pure pieces (no network, no browser)."""
import pytest
from pydantic import ValidationError

from video.film import extract_html
from video.models import Beat, Brief
from video.render import allowed_url
from video.timeline import beat_starts, words_from_alignment


def beat(i, vo="Raycast is on Windows now."):
    return {"voiceover": vo, "on_screen": f"Line {i}", "visual": "a launcher opens"}


def brief(**kw):
    base = dict(title="Raycast for Windows", promise="Your shortcut to everything, now on Windows",
                reference_style="Linear launch film", accent_hex="#FF6363", background_hex="#0B0B0C",
                beats=[beat(i) for i in range(4)], thumbnail_prompt="a glowing launcher window on a desk",
                facts_used=[{"claim": "Raycast v2 is out of beta", "source_url": "https://x.com/raycast/status/1"}])
    base.update(kw)
    return Brief.model_validate(base)


def test_brief_accepts_four_to_six_beats_and_hex_colours():
    assert len(brief().beats) == 4
    with pytest.raises(ValidationError):
        brief(beats=[beat(i) for i in range(3)])
    with pytest.raises(ValidationError):
        brief(beats=[beat(i) for i in range(7)])
    with pytest.raises(ValidationError):
        brief(accent_hex="red")


def test_brief_rejects_a_voiceover_too_long_for_twenty_seconds():
    long_line = " ".join(["word"] * 20)
    with pytest.raises(ValidationError, match="voiceover"):
        brief(beats=[beat(i, long_line) for i in range(4)])  # 80 words is ~30 s of speech


def test_words_from_alignment_groups_characters_into_timed_words():
    chars = list("Hi you.")
    starts = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    ends = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]
    words = words_from_alignment({"characters": chars, "character_start_times_seconds": starts,
                                  "character_end_times_seconds": ends})
    assert [(w.text, w.start, w.end) for w in words] == [("Hi", 0.0, 0.2), ("you.", 0.3, 0.7)]


def test_beat_starts_land_on_each_lines_first_word():
    lines = ["Stop alt tabbing.", "Raycast is on Windows."]
    chars = list(" ".join(lines))
    t = [i * 0.05 for i in range(len(chars))]
    words = words_from_alignment({"characters": chars, "character_start_times_seconds": t,
                                  "character_end_times_seconds": [x + 0.05 for x in t]})
    starts = beat_starts(lines, words)
    assert starts[0] == 0.0 and starts[1] == pytest.approx(len("Stop alt tabbing. ") * 0.05)


def test_extract_html_from_fenced_reply_and_require_seek_and_ready():
    page = "<!doctype html><html><body><div id=stage></div><script>window.seek=async t=>true;window.ready=true</script></body></html>"
    assert extract_html(f"Here you go:\n```html\n{page}\n```\n") == page
    with pytest.raises(ValueError, match="seek"):
        extract_html("```html\n<html><script>window.ready=true</script></html>\n```")


def test_render_sandbox_allows_only_the_film_folder_and_inline_data():
    root = "file:///tmp/film"
    assert allowed_url("file:///tmp/film/film.html", root) and allowed_url("file:///tmp/film/core.js", root)
    assert allowed_url("data:image/png;base64,AAAA", root)
    assert not allowed_url("https://evil.example/x.js", root)
    assert not allowed_url("file:///etc/passwd", root)
    assert not allowed_url("file:///tmp/film-other/x", root)


def test_thumbnail_overlay_makes_a_1280x720_jpeg(tmp_path):
    from PIL import Image
    from video.thumbnail import overlay_title
    src = tmp_path / "raw.png"
    Image.new("RGB", (1792, 1024), "#223344").save(src)
    out = overlay_title(src, tmp_path / "thumb.jpg", "Raycast for Windows", "#FF6363")
    img = Image.open(out)
    assert img.size == (1280, 720) and img.format == "JPEG"


def test_reporter_mirrors_stages_and_finishes_with_urls_and_script():
    from conftest import FakeStdb
    from video.sync import VideoReporter
    db = FakeStdb()
    rep = VideoReporter(db, "raycast-1")
    rep.stage("brief", 0.1)
    rep.stage("render", 0.75)
    rep.stage("done", 1.0)  # "done" is not a progress stage: finish() records it
    rep.finish({"brief": {"title": "Raycast v2", "beats": [{"on_screen": "Out of beta"}]},
                "video": "/generated/videos/raycast-1/video.mp4", "thumbnail": "/generated/videos/raycast-1/thumbnail.jpg",
                "duration": 16.2, "review_1": {"scores": {"hook": 8}}})
    assert db.reducers("set_campaign_video_progress") == [("raycast-1", "brief", 0.1), ("raycast-1", "render", 0.75)]
    [(vid, title, url, thumb, dur, script, review)] = db.reducers("finish_campaign_video")
    assert (vid, title, url, thumb, dur) == ("raycast-1", "Raycast v2", "/generated/videos/raycast-1/video.mp4",
                                             "/generated/videos/raycast-1/thumbnail.jpg", 16.2)
    assert "Out of beta" in script and '"hook": 8' in review


def test_worker_claims_queued_videos_and_records_failures():
    from conftest import FakeStdb
    from video.sync import run_pending_videos
    db = FakeStdb({"campaign_video": [
        {"video_id": "v1", "brand": "Raycast", "news": "v2 is out", "goal": "reposts", "campaign_id": "", "status": "queued"},
        {"video_id": "v2", "brand": "Linear", "news": "x", "goal": "", "campaign_id": "", "status": "done"}]})
    made = []

    def maker(company, news, goal, audience, *, video_id, on_stage):
        made.append((company, news, video_id))
        raise RuntimeError("ElevenLabs quota exceeded")
    assert run_pending_videos(db, maker=maker) == 1
    assert db.reducers("start_campaign_video") == [("v1", "Raycast", "v2 is out", "reposts", "")]
    assert made == [("Raycast", "v2 is out", "v1")]
    assert "quota" in db.reducers("fail_campaign_video")[0][1]


def test_thumbnail_title_wraps_inside_the_frame(tmp_path):
    from PIL import Image, ImageDraw
    from video.thumbnail import _fit
    draw = ImageDraw.Draw(Image.new("RGB", (1280, 720)))
    lines, font = _fit(draw, "Raycast v2: Same Shortcut. New Everything.", max_width=1100)
    assert 1 <= len(lines) <= 2 and all(draw.textlength(line, font=font) <= 1100 for line in lines)


def test_finished_video_is_attached_to_its_campaigns_lab_experiment():
    from conftest import FakeStdb
    from video.sync import make_tracked
    db = FakeStdb({"campaign_flow": [{"campaign_id": "c1", "experiment_id": 11}]})

    def maker(company, news, goal, audience, *, video_id, on_stage):
        return {"brief": {"title": "T"}, "video": "/v.mp4", "thumbnail": "/t.jpg", "duration": 15.0}
    make_tracked(db, maker, "raycast", "news", "", "", video_id="v1", campaign_id="c1")
    assert db.reducers("attach_lab_draft_media") == [(11, "A", "v1"), (11, "B", "v1")]


def test_video_without_a_tested_campaign_attaches_nothing():
    from conftest import FakeStdb
    from video.sync import make_tracked
    db = FakeStdb({"campaign_flow": [{"campaign_id": "c1", "experiment_id": 0}]})
    make_tracked(db, lambda *a, **k: {"brief": {}}, "raycast", "n", "", "", video_id="v1", campaign_id="c1")
    assert db.reducers("attach_lab_draft_media") == []


def test_brand_colors_use_the_kit_palette_accent_and_a_neutral_background():
    from video.style import brand_colors
    assert brand_colors(["#FF6363", "#111111", "#F4F4F5"]) == ("#FF6363", "#111111")
    assert brand_colors(["#00E0B8"]) == ("#00E0B8", "#0B0B0C")
    assert brand_colors([]) is None


def test_beat_edits_replace_text_and_flag_voice_changes():
    from video.style import apply_beat_edits
    b = brief()
    edited, voice_changed = apply_beat_edits(b, [{"on_screen": "New words", "voiceover": b.beats[0].voiceover}])
    assert edited.beats[0].on_screen == "New words" and not voice_changed and edited.beats[1] == b.beats[1]
    edited, voice_changed = apply_beat_edits(b, [{}, {"voiceover": "Different line."}])
    assert voice_changed and edited.beats[1].voiceover == "Different line."


def test_each_draft_gets_its_own_video_in_the_lab():
    from conftest import FakeStdb
    from video.sync import make_tracked
    db = FakeStdb({"campaign_flow": [{"campaign_id": "c1", "experiment_id": 11}],
                   "campaign_draft_video": [{"campaign_id": "c1", "draft": "A", "video_id": "va"},
                                            {"campaign_id": "c1", "draft": "B", "video_id": "vb"}]})
    make_tracked(db, lambda *a, **k: {"brief": {}}, "raycast", "n", "", "", video_id="vb", campaign_id="c1")
    assert db.reducers("attach_lab_draft_media") == [(11, "B", "vb")]


def test_worker_passes_the_edit_and_brand_palette_to_the_maker():
    from conftest import FakeStdb
    from video.sync import run_pending_videos
    db = FakeStdb({"campaign_video": [{"video_id": "v2", "brand": "raycast", "news": "n", "goal": "", "campaign_id": "c1",
                                       "status": "queued"}],
                   "video_edit": [{"video_id": "v2", "parent_id": "v1", "instruction": "punchier", "beats_json": "[]"}],
                   "x_user": [{"user_id": "7", "username": "raycast"}],
                   "brand_kit": [{"brand_user_id": "7", "palette": ["#FF6363", "#111111"]}]})
    seen = {}

    def maker(company, news, goal, audience, *, video_id, on_stage, palette=None, edit=None):
        seen.update(palette=palette, edit=edit)
        return {"brief": {}}
    run_pending_videos(db, maker=maker)
    assert seen["palette"] == ["#FF6363", "#111111"]
    assert seen["edit"] == {"parent_id": "v1", "instruction": "punchier", "beats": []}


def test_ensure_working_repairs_a_crashing_page_once():
    from video.pipeline import ensure_working
    checks = iter([["TypeError: null"], []])
    page = ensure_working("<bad>", check=lambda p: next(checks), fix=lambda p, err: "<fixed>")
    assert page == "<fixed>"


def test_ensure_working_falls_back_to_the_last_good_page():
    from video.pipeline import ensure_working
    page = ensure_working("<bad>", check=lambda p: [] if p == "<good>" else ["boom"], fix=lambda p, err: "<still bad>",
                          fallback="<good>")
    assert page == "<good>"


def test_ensure_working_without_a_fallback_raises_the_page_error():
    import pytest
    from video.pipeline import ensure_working
    with pytest.raises(RuntimeError, match="boom"):
        ensure_working("<bad>", check=lambda p: ["boom"], fix=lambda p, err: "<bad again>")


def test_film_spec_lists_real_screenshots_as_assets():
    from video.film import film_request
    import json
    spec = json.loads(film_request(brief(), [0.0, 2.0, 4.0, 6.0], [], 10.0, assets=["shot-1.png"]))
    assert spec["assets"] == [{"file": "shot-1.png", "what": "screenshot of the brand's real website"}]


def test_worker_passes_company_context_to_the_maker(monkeypatch):
    from conftest import FakeStdb
    import video.sync as sync
    monkeypatch.setattr(sync, "_company", lambda stdb, brand: {"news": [{"title": "v2"}], "screenshots": []})
    seen = {}

    def maker(company, news, goal, audience, *, video_id, on_stage, context=None, **kw):
        seen["context"] = context
        return {"brief": {}}
    sync.make_tracked(FakeStdb(), maker, "raycast", "n", "", "", video_id="v1")
    assert seen["context"]["news"][0]["title"] == "v2"
