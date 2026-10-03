from conftest import FakeClient, FakeStdb, post_row, user_row
from test_ask import TWIN
from test_builder import PERSONA
from twins.stdb import StdbError
from twins.sync import answer_pending, load_twin, run_build


def audience_db():
    return FakeStdb({
        "x_user": [user_row("100", "spacetimedb"), user_row("1", "alice"), user_row("2", "bob"), user_row("3", "carol")],
        "audience_membership": [{"brand_user_id": "100", "follower_user_id": u} for u in ("1", "2", "3")],
        "x_post": ([post_row(f"a{i}", "1", like_count=i) for i in range(3)]
                   + [post_row(f"b{i}", "2") for i in range(3)] + [post_row("c0", "3")]),
        "x_post_entity": [], "x_context_annotation": [],
    })


def test_run_build_publishes_skips_and_fails_through_reducers():
    db = audience_db()
    client = FakeClient([{**PERSONA, "evidence_post_ids": ["a2"]}, None, None])  # alice ok, bob invalid twice
    summary = run_build(db, client, "spacetimedb", workers=1, run_id="run1")
    assert (summary.ready, summary.failed, summary.skipped, summary.status) == (1, 1, 1, "partial")
    assert db.reducers("start_twin_build_run") == [("run1", "100", 3)]
    statuses = [(a[2], a[3]) for a in db.reducers("set_twin_job_status")]
    assert ("alice", "queued") in statuses and ("alice", "building") in statuses
    assert ("bob", "failed") in statuses and ("carol", "skipped") in statuses
    [pub] = db.reducers("publish_twin")
    assert pub[:4] == ("run1", "1", "alice", "100")
    assert pub[12] == [{"topic": "databases", "affinity": 0.8}] and pub[18] == ["a2"]
    assert db.reducers("complete_twin_build_run") == [("run1", "partial")]


def test_run_build_marks_failed_when_publish_rejected():
    db = audience_db()
    db.fail_on.add("publish_twin")
    summary = run_build(db, FakeClient([PERSONA, None, None]), "spacetimedb", workers=1, run_id="r", limit=1)
    assert (summary.ready, summary.failed, summary.status) == (0, 1, "failed")


def twin_db():
    s, p = TWIN.stats, TWIN.persona
    return FakeStdb({
        "twin": [{"user_id": "1", "username": "alice", "brand_user_id": "100", "post_count": s.post_count,
                  "reply_share": s.reply_share, "quote_share": s.quote_share, "mention_rate": s.mention_rate,
                  "avg_likes": s.avg_likes, "avg_impressions": s.avg_impressions, "engagement_rate": s.engagement_rate,
                  "active_hours_utc": s.active_hours_utc, "topics": [t.model_dump() for t in p.topics], "tone": p.tone,
                  "persona_summary": p.persona_summary, "hot_buttons": p.hot_buttons, "ignores": p.ignores,
                  "format_prefs": p.format_prefs, "evidence_post_ids": p.evidence_post_ids, "model": "m"}],
        "x_post": [post_row("p2", "1", text="bench!")],
        "twin_question": [{"question_id": 7, "user_id": "1", "draft": "10x faster", "question": "", "status": "pending"},
                          {"question_id": 8, "user_id": "1", "draft": "other", "question": "", "status": "pending"}],
    })


def test_load_twin_round_trips_row():
    twin = load_twin(twin_db(), "1")
    assert twin.persona == TWIN.persona and [p.post_id for p in twin.evidence] == ["p2"]


def test_answer_pending_claims_answers_and_skips_lost_claims():
    db = twin_db()
    original_call = db.call

    def call(reducer, *args):  # question 8 was claimed by another worker first
        if reducer == "claim_twin_question" and args == (8,):
            db.calls.append((reducer, args))
            raise StdbError("claim_twin_question -> HTTP 530: already claimed")
        return original_call(reducer, *args)

    db.call = call
    client = FakeClient([{"action": "reply", "confidence": 0.7, "answer": "Show me.", "cited_post_ids": ["p2"]}])
    assert answer_pending(db, client) == 1
    assert db.reducers("answer_twin_question") == [(7, "reply", 0.7, "Show me.", ["p2"])]
    assert db.reducers("fail_twin_question") == []


def test_answer_pending_fails_question_on_llm_error():
    db = twin_db()
    db.tables["twin_question"] = db.tables["twin_question"][:1]
    assert answer_pending(db, FakeClient([None, None])) == 1
    [(qid, err)] = db.reducers("fail_twin_question")
    assert qid == 7 and "emit_answer" in err
