import pytest

from conftest import FakeStdb
from video.config import DEFAULT_VOICE, VideoLimits, limits, load_video_limits, use_limits
from video.director import director_system
from video.models import Brief


def beats(words_each):
    return [{"on_screen": "Hi", "voiceover": " ".join(["word"] * words_each), "visual": "x"} for _ in range(4)]


def brief(words_each):
    return {"title": "T", "promise": "P", "reference_style": "Linear launch film", "accent_hex": "#FF6363",
            "background_hex": "#111111", "beats": beats(words_each), "thumbnail_prompt": "t"}


def test_defaults_are_twenty_seconds_and_the_new_voice():
    assert DEFAULT_VOICE == "y0s2ExEMuum3muUnA6Zd"
    assert limits() == VideoLimits() and limits().max_seconds == 20 and limits().max_words == 48


def test_settings_row_drives_length_and_voice():
    db = FakeStdb({"video_settings": [{"key": "global", "max_seconds": 10, "voice_id": "abcDEF1234567890"}]})
    got = load_video_limits(db)
    assert got.max_seconds == 10 and got.voice_id == "abcDEF1234567890" and got.max_words == 21
    assert load_video_limits(FakeStdb()) == VideoLimits()


def test_word_limit_and_director_prompt_follow_the_active_limits():
    Brief.model_validate(brief(10))  # 40 words fits 20 s
    with use_limits(VideoLimits(max_seconds=10)):
        assert "at most 10 seconds" in director_system() and "under 21 spoken words" in director_system()
        with pytest.raises(ValueError, match="under 21"):
            Brief.model_validate(brief(10))
    assert "at most 20 seconds" in director_system()


def test_each_tracked_video_runs_under_the_ops_settings():
    from video.sync import make_tracked
    db = FakeStdb({"video_settings": [{"key": "global", "max_seconds": 12, "voice_id": "voiceXYZ123456"}]})
    seen = {}

    def maker(*a, **kw):
        seen["limits"] = limits()
        return {"title": "t", "video_url": "/v.mp4", "thumbnail_url": "/t.png", "duration_s": 11.0, "script": {}, "review": {}}
    make_tracked(db, maker, "Raycast", "news", "", "", video_id="v1")
    assert seen["limits"] == VideoLimits(max_seconds=12, voice_id="voiceXYZ123456")
    assert limits() == VideoLimits()  # restored after the job


def test_each_draft_video_gets_its_own_direction_and_differs_from_its_sibling():
    from video.sync import FILM_DIRECTIONS, _direction
    db = FakeStdb({"campaign_draft_video": [{"campaign_id": "c1", "draft": "A", "video_id": "va"},
                                            {"campaign_id": "c1", "draft": "B", "video_id": "vb"}],
                   "campaign_video": [{"video_id": "va", "status": "done", "script_json": '{"title": "Half the memory"}'}]})
    b = _direction(db, "vb", "c1")
    assert b["draft"] == "B" and b["style"] == FILM_DIRECTIONS["B"] and "Half the memory" in b["differ_from"]
    assert _direction(db, "va", "c1")["style"] == FILM_DIRECTIONS["A"]
    assert FILM_DIRECTIONS["A"] != FILM_DIRECTIONS["B"]
    assert _direction(db, "vx", "") is None


def test_the_director_sees_the_direction():
    import json
    from video import director
    sent = {}

    def fake(client, system, prompt, model, name, **kw):
        sent.setdefault("prompt", prompt)
        raise ValueError("stop")
    orig = director._tool_call
    director._tool_call = fake
    try:
        with pytest.raises(ValueError):
            director.write_brief(None, "Raycast", "news", "", "", [], direction={"style": "STORY", "differ_from": "X"})
    finally:
        director._tool_call = orig
    body = json.loads(sent["prompt"])
    assert body["creative_direction"] == "STORY" and body["sibling_film_to_differ_from"] == "X"
