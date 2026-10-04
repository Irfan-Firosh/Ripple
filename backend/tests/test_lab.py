from types import SimpleNamespace

from conftest import FakeStdb
from twins.lab import run_pending_labs
from twins.stdb import StdbError


def lab_db(*rows):
    return FakeStdb({"lab_experiment": [dict(experiment_id=i, brand="raycast.com", draft_a="a", draft_b="b",
                                             status=s) for i, s in rows]})


def ok_runner(stdb, client, brand, a, b, *, on_runs=None, **kw):
    on_runs("ra", "rb")
    return SimpleNamespace(winner="B", lift=0.4)


def test_claims_runs_attaches_and_finishes_queued_experiments():
    db = lab_db((1, "queued"), (2, "done"))
    assert run_pending_labs(db, client=None, runner=ok_runner) == 1
    assert [r for r, _ in db.calls] == ["claim_lab_experiment", "attach_lab_runs", "finish_lab_experiment"]
    assert db.reducers("finish_lab_experiment")[0] == (1, "B", 0.4)


def test_lost_claim_race_is_skipped_quietly():
    db = lab_db((1, "queued"))
    db.fail_on.add("claim_lab_experiment")
    assert run_pending_labs(db, client=None, runner=ok_runner) == 0


def test_failed_experiment_is_marked_failed():
    def boom(*a, **kw):
        raise RuntimeError("Claude scored only 10 of 999 twins")
    db = lab_db((1, "queued"))
    run_pending_labs(db, client=None, runner=boom)
    assert db.reducers("fail_lab_experiment")[0][0] == 1 and "scored only" in db.reducers("fail_lab_experiment")[0][1]


def stale_db(created_at):
    db = lab_db((5, "running"))
    db.tables["lab_experiment"][0].update(run_a="ra", run_b="rb", created_at=created_at)
    db.tables["sim_run"] = [{"run_id": "ra", "status": "scoring", "created_at": created_at},
                            {"run_id": "rb", "status": "scoring", "created_at": created_at}]
    return db


def test_stale_running_experiment_is_reaped_with_its_runs():
    from twins.lab import STALE_SECONDS, reap_stale
    now = 10_000 * 1_000_000
    db = stale_db(now - (STALE_SECONDS + 5) * 1_000_000)
    assert reap_stale(db, now_micros=now) == 1
    assert db.reducers("fail_lab_experiment")[0][0] == 5
    assert sorted(a[0] for a in db.reducers("fail_sim_run")) == ["ra", "rb"]


def test_fresh_running_experiment_is_left_alone():
    from twins.lab import reap_stale
    now = 10_000 * 1_000_000
    assert reap_stale(stale_db(now - 30 * 1_000_000), now_micros=now) == 0


def test_interrupt_still_marks_the_experiment_failed():
    import pytest

    def interrupted(*a, **kw):
        raise KeyboardInterrupt
    db = lab_db((1, "queued"))
    with pytest.raises(KeyboardInterrupt):
        run_pending_labs(db, client=None, runner=interrupted)
    assert db.reducers("fail_lab_experiment")[0][0] == 1
