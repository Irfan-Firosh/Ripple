"""Pause switch from the hidden /ops page (ops_state.paused). Workers skip polling while paused, and the moment it
flips on, the job running in the worker's main thread is interrupted (KeyboardInterrupt) so it stops right away.
SpacetimeDB also refuses worker writes while paused, so a worker that misses the flip still cannot finish."""
import _thread
import logging
import threading
import time
from typing import Callable

log = logging.getLogger(__name__)
WATCH_SECONDS = 3.0


def is_paused(stdb) -> bool:
    try:
        rows = stdb.sql("SELECT * FROM ops_state WHERE key = 'global'")
    except Exception:  # noqa: BLE001 - an unreachable flag never stops the workers
        return False
    return bool(rows and rows[0].get("paused"))


class PauseWatch:
    def __init__(self, stdb, *, interrupt: Callable[[], None] = _thread.interrupt_main):
        self.stdb, self.interrupt = stdb, interrupt
        self.paused = is_paused(stdb)

    def check(self) -> bool:
        now = is_paused(self.stdb)
        if now and not self.paused:
            log.warning("paused from ops: stopping the running job")
            self.interrupt()
        self.paused = now
        return now

    def start(self, every: float = WATCH_SECONDS) -> "PauseWatch":
        def loop():
            while True:
                time.sleep(every)
                self.check()
        threading.Thread(target=loop, name="ops-pause", daemon=True).start()
        return self


def guarded(watch: PauseWatch, step: Callable[[], None]) -> None:
    """One worker iteration: skipped while paused; an ops interrupt is swallowed, a real Ctrl-C is not."""
    try:
        if not watch.paused:
            step()
    except KeyboardInterrupt:
        if not watch.paused:
            raise
        log.info("job stopped: paused from ops")


def nap(watch: PauseWatch, sleep: Callable[[float], None], seconds: float) -> None:
    """Sleep between polls; an ops interrupt that lands here is swallowed too."""
    try:
        sleep(seconds)
    except KeyboardInterrupt:
        if not watch.paused:
            raise
