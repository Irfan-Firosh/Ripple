from conftest import FakeStdb
from types import SimpleNamespace

from video.copywriter import STYLES, clean_tweet, make_writer, run_pending_copy


def test_clean_tweet_trims_quotes_hashtag_spam_and_length():
    assert clean_tweet('"Raycast 2.6 halves memory use. #raycast #mac #productivity"') == "Raycast 2.6 halves memory use. #raycast #mac #productivity"
    # At most three hashtags survive, at the end.
    assert clean_tweet("Raycast 2.6 is out. #a #b #c #d #e") == "Raycast 2.6 is out. #a #b #c"
    assert len(clean_tweet("word " * 100)) <= 280


def test_pending_copy_is_claimed_written_and_saved():
    db = FakeStdb({"draft_copy": [{"copy_id": "c1:A", "campaign_id": "c1", "draft": "A", "headline": "Cut memory use in half",
                                   "status": "queued"}],
                   "campaign_flow": [{"campaign_id": "c1", "brand": "raycast"}]})
    n = run_pending_copy(db, write=lambda brand, headline, **kw: f"{brand}: {headline}. Raycast 2.6 is out.")
    assert n == 1
    assert db.reducers("set_draft_copy") == [("c1:A", "writing", "", "", 2),
                                             ("c1:A", "done", "raycast: Cut memory use in half. Raycast 2.6 is out.", "", 2)]


def test_failed_writing_is_recorded():
    db = FakeStdb({"draft_copy": [{"copy_id": "c1:B", "campaign_id": "c1", "draft": "B", "headline": "h", "status": "queued"}],
                   "campaign_flow": [{"campaign_id": "c1", "brand": "raycast"}]})
    def boom(brand, headline, **kw):
        raise RuntimeError("rate limited")
    run_pending_copy(db, write=boom)
    assert db.reducers("set_draft_copy")[-1][:2] == ("c1:B", "failed") and "rate limited" in db.reducers("set_draft_copy")[-1][3]


def test_an_empty_tweet_is_a_failure_not_a_done_draft():
    db = FakeStdb({"draft_copy": [{"copy_id": "c1:B", "campaign_id": "c1", "draft": "B", "headline": "h", "status": "queued"}],
                   "campaign_flow": [{"campaign_id": "c1", "brand": "raycast"}]})
    run_pending_copy(db, write=lambda brand, headline, **kw: "  ")
    assert db.reducers("set_draft_copy")[-1][:2] == ("c1:B", "failed")


def test_draft_b_is_written_against_draft_a_so_the_two_differ():
    db = FakeStdb({"draft_copy": [{"copy_id": "c1:A", "campaign_id": "c1", "draft": "A", "headline": "h1", "status": "done",
                                   "text": "Raycast 2.6 halves memory use."},
                                  {"copy_id": "c1:B", "campaign_id": "c1", "draft": "B", "headline": "h2", "status": "queued"}],
                   "campaign_flow": [{"campaign_id": "c1", "brand": "raycast"}]})
    seen = {}
    run_pending_copy(db, write=lambda brand, headline, **kw: seen.update(kw) or "Ever lost a window? Spaces fixes that.")
    assert seen == {"draft": "B", "other": "Raycast 2.6 halves memory use."}


def test_each_draft_gets_its_own_format_and_must_avoid_the_other():
    assert STYLES["A"] != STYLES["B"]
    sent = []

    def create(**kw):
        sent.append(kw)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text="A totally different post.")])
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    db = FakeStdb({"brand_kit": [], "x_user": []})
    import video.copywriter as cw
    cw_ctx = cw.__dict__.get("company_context")
    import creative.company as company
    orig = company.company_context
    company.company_context = lambda *a, **k: {"news": [], "best_posts": []}
    try:
        make_writer(db, client)("raycast", "Cut memory in half", draft="B", other="Raycast 2.6 halves memory use.")
    finally:
        company.company_context = orig
    body = sent[0]["messages"][0]["content"]
    assert STYLES["B"] in body and "Raycast 2.6 halves memory use." in body


def test_the_writer_asks_for_hashtags():
    from video.copywriter import SYSTEM
    assert "hashtag" in SYSTEM.lower() and "No hashtags" not in SYSTEM


def test_copy_worker_writes_tweets_without_making_videos():
    from video.sync import run_copy_worker
    db = FakeStdb({"draft_copy": [{"copy_id": "c1:A", "campaign_id": "c1", "draft": "A", "headline": "h", "status": "queued"}],
                   "campaign_flow": [{"campaign_id": "c1", "brand": "raycast"}]})
    run_copy_worker(db, writer=lambda brand, headline, **kw: "A post. #Raycast", sleep=lambda s: None, max_loops=1)
    assert db.reducers("set_draft_copy")[-1][:3] == ("c1:A", "done", "A post. #Raycast")
    assert not db.reducers("start_campaign_video")
