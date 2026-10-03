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
    summary = run_build(db, client, "spacetimedb", workers=1, run_id="run1", min_posts=3)
    assert (summary.ready, summary.failed, summary.skipped, summary.status) == (1, 1, 1, "partial")
    assert db.reducers("start_twin_build_run") == [("run1", "100", 3)]
    statuses = [(a[2], a[3]) for a in db.reducers("set_twin_job_status")]
    assert ("alice", "queued") in statuses and ("alice", "building") in statuses
    assert ("bob", "failed") in statuses and ("carol", "skipped") in statuses
    [pub] = db.reducers("publish_twin")
    assert pub[:4] == ("run1", "1", "alice", "100")
    assert pub[12] == [{"topic": "backend_infra", "affinity": 0.8}] and pub[18] == ["a2"]
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


def test_run_build_survives_status_reducer_failure_and_still_completes():
    db = audience_db()
    original_call = db.call

    def call(reducer, *args):  # SpacetimeDB hiccup only when bob goes to "building"
        if reducer == "set_twin_job_status" and args[2] == "bob" and args[3] == "building":
            db.calls.append((reducer, args))
            raise StdbError("set_twin_job_status -> HTTP 503: unavailable")
        return original_call(reducer, *args)

    db.call = call
    summary = run_build(db, FakeClient([{**PERSONA, "evidence_post_ids": ["a2"]}]), "spacetimedb",
                        workers=1, run_id="run1", min_posts=3)
    assert (summary.ready, summary.failed, summary.skipped, summary.status) == (1, 1, 1, "partial")
    assert db.reducers("complete_twin_build_run") == [("run1", "partial")]


def test_run_build_default_builds_everyone_including_postless_accounts():
    db = audience_db()
    db.tables["x_post"] = [p for p in db.tables["x_post"] if p["author_user_id"] != "3"]  # carol has no posts
    summary = run_build(db, FakeClient([PERSONA, PERSONA, PERSONA]), "spacetimedb", workers=1, run_id="r")
    assert (summary.ready, summary.failed, summary.skipped, summary.status) == (3, 0, 0, "completed")


def test_publish_committed_but_response_lost_still_counts_ready():
    db = audience_db()
    db.fail_on.add("publish_twin")
    db.tables["twin"] = [{"user_id": "1", "build_run_id": "r"}]  # the reducer did commit
    summary = run_build(db, FakeClient([PERSONA]), "spacetimedb", workers=1, run_id="r", limit=1)
    assert (summary.ready, summary.failed) == (1, 0)
    assert ("1", "alice", "failed") not in [(a[1], a[2], a[3]) for a in db.reducers("set_twin_job_status")]


def test_answer_pending_reports_non_race_claim_errors(capsys):
    db = twin_db()
    db.tables["twin_question"] = db.tables["twin_question"][:1]
    db.fail_on.add("claim_twin_question")
    assert answer_pending(db, FakeClient([])) == 0
    assert "claim_twin_question" in capsys.readouterr().err


def test_answer_pending_survives_fail_reducer_error():
    db = twin_db()
    db.tables["twin_question"] = db.tables["twin_question"][:1]
    db.fail_on.add("fail_twin_question")
    assert answer_pending(db, FakeClient([None, None])) == 1  # LLM fails, then marking failed also fails


def test_run_worker_survives_poll_errors(capsys):
    from twins.sync import run_worker

    class Flaky:
        def __init__(self):
            self.n = 0

        def sql(self, q):
            self.n += 1
            raise StdbError("sql -> HTTP 503")

    db = Flaky()
    run_worker(db, FakeClient([]), poll_seconds=0, max_loops=2, sleep=lambda s: None)
    assert db.n == 2 and "503" in capsys.readouterr().err


def test_load_twin_fetches_evidence_with_one_author_query():
    stdb = twin_db()
    load_twin(stdb, "1")
    assert [q for q in stdb.queries if "FROM x_post" in q] == ["SELECT * FROM x_post WHERE author_user_id = '1'"]


def test_run_build_publishes_the_niche_catalog_first():
    from twins.niches import NICHES
    db = audience_db()
    run_build(db, FakeClient([PERSONA, PERSONA, PERSONA]), "spacetimedb", workers=1, run_id="r")
    names = [r for r, _ in db.calls]
    assert names[:len(NICHES)] == ["upsert_niche"] * len(NICHES)
    assert db.reducers("upsert_niche")[0] == (NICHES[0].slug, NICHES[0].label, NICHES[0].description)
