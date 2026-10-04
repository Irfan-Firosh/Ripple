import pytest

from conftest import FakeStdb
from twins.ops_pause import PauseWatch, guarded, is_paused


def db(paused):
    return FakeStdb({"ops_state": [{"key": "global", "paused": paused, "hidden": False}]})


def test_is_paused_reads_the_flag_and_defaults_to_running():
    assert is_paused(db(True)) and not is_paused(db(False)) and not is_paused(FakeStdb())


def test_flip_to_paused_interrupts_once():
    stdb, hits = db(False), []
    w = PauseWatch(stdb, interrupt=lambda: hits.append(1))
    stdb.tables["ops_state"][0]["paused"] = True
    assert w.check() and w.check()
    assert hits == [1]


def test_guarded_skips_while_paused_and_swallows_the_ops_interrupt():
    ran = []
    w = PauseWatch(db(True), interrupt=lambda: None)
    guarded(w, lambda: ran.append(1))
    assert ran == []

    def interrupted():
        raise KeyboardInterrupt
    w.paused = False
    with pytest.raises(KeyboardInterrupt):  # a real Ctrl-C still stops the worker
        guarded(w, interrupted)

    def paused_mid_job():
        w.paused = True
        raise KeyboardInterrupt
    guarded(w, paused_mid_job)  # the ops pause does not
