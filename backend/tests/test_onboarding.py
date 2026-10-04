from conftest import FakeStdb
from twins.onboarding import LIVE_TIMELINES, LIVE_TWINS, run_pending_onboardings


def onboarding_db(*rows):
    return FakeStdb({"onboarding": [dict(onboarding_id=i, handle=h, status=s) for i, h, s in rows]})


class Recorder:
    def __init__(self, fail=None):
        self.calls, self.fail = [], fail

    def ingest(self, handle, **kw):
        self.calls.append(("ingest", handle, kw))
        if self.fail == "ingest":
            raise RuntimeError("@nope not found on X")
        return {"brand_user_id": "42", "status": "partial", "pending": 120}

    def build(self, stdb, client, handle, **kw):
        self.calls.append(("build", handle, kw))

    def edges(self, stdb, handle):
        self.calls.append(("edges", handle))

    def after_ready(self, row, summary):
        self.calls.append(("after_ready", row["handle"], summary["pending"]))


def run(db, rec):
    return run_pending_onboardings(db, None, ingest=rec.ingest, build=rec.build, edges=rec.edges,
                                   after_ready=rec.after_ready)


def test_onboarding_scrapes_builds_graphs_then_marks_ready():
    db, rec = onboarding_db((7, "raycast", "queued"), (8, "linear", "ready")), Recorder()
    assert run(db, rec) == 1
    assert db.reducers("claim_onboarding") == [(7, 2)]  # (id, worker version)
    stages = [a[1] for a in db.reducers("set_onboarding_progress")]
    assert stages == ["scraping", "twins", "graph", "ready"]
    run_id = db.reducers("set_onboarding_progress")[0][3]
    assert run_id == "onboard-7-raycast"
    assert db.reducers("set_onboarding_progress")[1][2] == "42"
    (_, handle, kw), (_, _, bkw), edges, after = rec.calls
    assert handle == "raycast" and kw["run_id"] == run_id and kw["max_new_timelines"] == max(LIVE_TIMELINES, LIVE_TWINS)
    assert bkw["limit"] == LIVE_TWINS and bkw["richest_first"] and bkw["skip_existing"]
    assert edges == ("edges", "raycast") and after == ("after_ready", "raycast", 120)


def test_onboarding_failure_is_recorded_and_stops_the_pipeline():
    db, rec = onboarding_db((3, "nope", "queued")), Recorder(fail="ingest")
    run(db, rec)
    [(oid, err)] = db.reducers("fail_onboarding")
    assert oid == 3 and "not found" in err
    assert [c[0] for c in rec.calls] == ["ingest"]


def test_lost_claim_is_skipped():
    db, rec = onboarding_db((1, "raycast", "queued")), Recorder()
    db.fail_on.add("claim_onboarding")
    assert run(db, rec) == 0 and rec.calls == []
