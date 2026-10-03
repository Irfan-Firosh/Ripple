import pytest
from pydantic import ValidationError

from twins.models import TwinAnswer, TwinPersona

BASE = {"topics": [{"topic": "databases", "affinity": 0.5}], "tone": "dry", "format_prefs": [], "hot_buttons": [],
        "ignores": [], "persona_summary": "s", "evidence_post_ids": []}


def test_overlong_prose_is_clipped_at_a_word_boundary():
    p = TwinPersona.model_validate({**BASE, "tone": "word " * 60, "persona_summary": "long sentence here " * 60})
    assert len(p.tone) <= 160 and p.tone.endswith("…") and "wor…" not in p.tone
    assert len(p.persona_summary) <= 500


def test_overlong_lists_are_trimmed():
    p = TwinPersona.model_validate({**BASE, "topics": [{"topic": f"t{i}", "affinity": 0.1} for i in range(12)],
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
