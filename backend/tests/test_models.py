import pytest
from pydantic import ValidationError

from twins.models import TwinAnswer, TwinPersona
from twins.niches import NICHE_SLUGS

BASE = {"topics": [{"topic": "backend_infra", "affinity": 0.5}], "tone": "dry", "format_prefs": [], "hot_buttons": [],
        "ignores": [], "persona_summary": "s", "evidence_post_ids": []}


def test_overlong_prose_is_clipped_at_a_word_boundary():
    p = TwinPersona.model_validate({**BASE, "tone": "word " * 60, "persona_summary": "long sentence here " * 60})
    assert len(p.tone) <= 160 and p.tone.endswith("…") and "wor…" not in p.tone
    assert len(p.persona_summary) <= 500


def test_overlong_lists_are_trimmed():
    p = TwinPersona.model_validate({**BASE, "topics": [{"topic": slug, "affinity": 0.1} for slug in NICHE_SLUGS[:12]],
                                    "hot_buttons": [f"h{i}" for i in range(9)], "evidence_post_ids": [str(i) for i in range(15)]})
    assert len(p.topics) == 8 and len(p.hot_buttons) == 6 and len(p.evidence_post_ids) == 10


def test_hard_constraints_still_reject():
    with pytest.raises(ValidationError):
        TwinPersona.model_validate({**BASE, "topics": [{"topic": "x", "affinity": 2}]})
    with pytest.raises(ValidationError):
        TwinPersona.model_validate({**BASE, "topics": []})
    with pytest.raises(ValidationError):
        TwinAnswer.model_validate({"action": "dance", "confidence": 0.5, "answer": "a", "cited_post_ids": []})


def test_answer_clipped():
    a = TwinAnswer.model_validate({"action": "like", "confidence": 0.5, "answer": "yes " * 400, "cited_post_ids": []})
    assert len(a.answer) <= 800


from twins.models import Topic


def test_topic_must_be_a_catalog_niche():
    with pytest.raises(ValidationError):
        Topic.model_validate({"topic": "Developer Tooling", "affinity": 0.5})


def test_topic_accepts_label_or_any_case_and_maps_to_slug():
    assert Topic.model_validate({"topic": "CRYPTO_WEB3", "affinity": 0.5}).topic == "crypto_web3"
    assert Topic.model_validate({"topic": "Crypto, DeFi & web3", "affinity": 0.5}).topic == "crypto_web3"


def test_duplicate_niches_merge_keeping_highest_affinity():
    p = TwinPersona.model_validate({**BASE, "topics": [{"topic": "gaming", "affinity": 0.2},
                                                       {"topic": "game_dev", "affinity": 0.5},
                                                       {"topic": "Gaming", "affinity": 0.4}]})
    assert [(t.topic, t.affinity) for t in p.topics] == [("game_dev", 0.5), ("gaming", 0.4)]


def test_list_fields_sent_as_strings_are_parsed():
    # Seen live from Haiku: lists arrive as a JSON-encoded string or a comma-separated string.
    p = TwinPersona.model_validate({**BASE, "format_prefs": '["Direct replies", "Short threads"]',
                                    "hot_buttons": "Brief replies, casual comments, emoji usage", "ignores": ""})
    assert p.format_prefs == ["Direct replies", "Short threads"]
    assert p.hot_buttons == ["Brief replies", "casual comments", "emoji usage"]
    assert p.ignores == []
