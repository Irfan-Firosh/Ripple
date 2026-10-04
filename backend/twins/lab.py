"""Lab worker: runs A/B experiments that browsers queue with request_lab_experiment."""
import logging
import time

from .simulate import run_lab
from .stdb import StdbError

log = logging.getLogger(__name__)
MAX_ERROR = 300
STALE_SECONDS = 15 * 60  # a Raycast experiment takes ~2-5 min; past this its worker is gone


def _run_one(stdb, client, row: dict, runner) -> tuple[bool, object]:
    """Claim and run one queued experiment. Returns (claimed, outcome); outcome is None when it failed."""
    exp_id = row["experiment_id"]
    try:
        stdb.call("claim_lab_experiment", exp_id)
    except StdbError:
        return False, None  # another worker took it, or it is no longer queued
    try:
        out = runner(stdb, client, row["brand"], row["draft_a"], row["draft_b"],
                     on_runs=lambda a, b: stdb.call("attach_lab_runs", exp_id, a, b))
        stdb.call("finish_lab_experiment", exp_id, out.winner, out.lift)
        return True, out
    except BaseException as exc:  # noqa: BLE001 - record every failure, including Ctrl-C, then re-raise those
        try:
            stdb.call("fail_lab_experiment", exp_id, f"{type(exc).__name__}: {exc}"[:MAX_ERROR])
        except StdbError as fail_exc:
            log.error("experiment %s stuck in running: %s", exp_id, fail_exc)
        if not isinstance(exc, Exception):
            raise
        return True, None


def run_pending_labs(stdb, client, *, runner=run_lab) -> int:
    handled = 0
    for row in stdb.sql("SELECT * FROM lab_experiment WHERE status = 'queued'"):
        claimed, _ = _run_one(stdb, client, row, runner)
        handled += claimed
    return handled


def _experiments(stdb, brand: str, draft_a: str, draft_b: str) -> list[dict]:
    rows = stdb.sql("SELECT * FROM lab_experiment")
    return [r for r in rows if r["brand"].lower() == brand and r["draft_a"] == draft_a and r["draft_b"] == draft_b]


def run_experiment(stdb, client, brand: str, draft_a: str, draft_b: str, *, runner=run_lab,
                   poll_seconds: float = 2.0, wait_seconds: float = STALE_SECONDS, sleep=time.sleep) -> tuple[dict, object]:
    """Queue an experiment like the browser does (so the Lab page lists it), then run it here. If the Lab worker
    claims it first, wait for it. Returns (final lab_experiment row, LabOutcome or None)."""
    brand = brand.strip().lstrip("@").lower()
    known = {r["experiment_id"] for r in _experiments(stdb, brand, draft_a, draft_b)}
    stdb.call("request_lab_experiment", brand, "", draft_a, draft_b)
    fresh = [r for r in _experiments(stdb, brand, draft_a, draft_b) if r["experiment_id"] not in known]
    if not fresh:
        raise RuntimeError("the Lab experiment was queued but could not be found")
    row = max(fresh, key=lambda r: r["experiment_id"])
    claimed, outcome = _run_one(stdb, client, row, runner)
    for _ in range(int(wait_seconds / poll_seconds) + 1):
        row = next(r for r in _experiments(stdb, brand, draft_a, draft_b) if r["experiment_id"] == row["experiment_id"])
        if row["status"] in ("done", "failed"):
            return row, outcome
        if claimed:
            break
        sleep(poll_seconds)
    raise TimeoutError(f"Lab experiment {row['experiment_id']} did not finish")


def reap_stale(stdb, *, now_micros: int | None = None) -> int:
    """Fail experiments (and their runs) left 'running' by a worker that was killed, slept or lost a reply."""
    now = now_micros if now_micros is not None else int(time.time() * 1_000_000)
    runs = {r["run_id"]: r for r in stdb.sql("SELECT run_id, status, created_at FROM sim_run")}
    reaped = 0
    for row in stdb.sql("SELECT * FROM lab_experiment WHERE status = 'running'"):
        started = runs.get(row.get("run_a") or "", {}).get("created_at") or row.get("created_at") or now
        if now - started < STALE_SECONDS * 1_000_000:
            continue
        try:
            stdb.call("fail_lab_experiment", row["experiment_id"], "worker stopped before finishing; please run it again")
            for run_id in (row.get("run_a"), row.get("run_b")):
                if run_id and runs.get(run_id, {}).get("status") in ("scoring", "replaying"):
                    stdb.call("fail_sim_run", run_id, "lab worker stopped")
            reaped += 1
        except StdbError as exc:
            log.warning("could not reap experiment %s: %s", row["experiment_id"], exc)
    return reaped


def run_lab_worker(stdb, client, *, poll_seconds: float = 2.0, max_loops: int | None = None, sleep=time.sleep) -> None:
    loops = 0
    while max_loops is None or loops < max_loops:
        try:
            reap_stale(stdb)
            if run_pending_labs(stdb, client):
                log.info("lab worker finished a batch")
        except Exception as exc:  # noqa: BLE001 - keep polling through transient errors
            log.warning("lab worker poll failed: %s: %s", type(exc).__name__, exc)
        loops += 1
        sleep(poll_seconds)
