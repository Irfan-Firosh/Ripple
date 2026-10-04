"""Lab worker: runs A/B experiments that browsers queue with request_lab_experiment."""
import logging
import time

from .simulate import run_lab
from .stdb import StdbError

log = logging.getLogger(__name__)
MAX_ERROR = 300


def run_pending_labs(stdb, client, *, runner=run_lab) -> int:
    handled = 0
    for row in stdb.sql("SELECT * FROM lab_experiment WHERE status = 'queued'"):
        exp_id = row["experiment_id"]
        try:
            stdb.call("claim_lab_experiment", exp_id)
        except StdbError:
            continue  # another worker took it, or it is no longer queued
        try:
            out = runner(stdb, client, row["brand"], row["draft_a"], row["draft_b"],
                         on_runs=lambda a, b: stdb.call("attach_lab_runs", exp_id, a, b))
            stdb.call("finish_lab_experiment", exp_id, out.winner, out.lift)
        except Exception as exc:  # noqa: BLE001 - every failure is recorded on the experiment
            try:
                stdb.call("fail_lab_experiment", exp_id, f"{type(exc).__name__}: {exc}"[:MAX_ERROR])
            except StdbError as fail_exc:
                log.error("experiment %s stuck in running: %s", exp_id, fail_exc)
        handled += 1
    return handled


def run_lab_worker(stdb, client, *, poll_seconds: float = 2.0, max_loops: int | None = None, sleep=time.sleep) -> None:
    loops = 0
    while max_loops is None or loops < max_loops:
        try:
            if run_pending_labs(stdb, client):
                log.info("lab worker finished a batch")
        except Exception as exc:  # noqa: BLE001 - keep polling through transient errors
            log.warning("lab worker poll failed: %s: %s", type(exc).__name__, exc)
        loops += 1
        sleep(poll_seconds)
