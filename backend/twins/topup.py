"""'Build N more twins for @brand' requests from the hidden /ops page (twin_topup rows)."""
import logging
from typing import Callable

from .stdb import StdbError

log = logging.getLogger(__name__)
MAX_ERROR = 300


def run_pending_topups(stdb, client, *, build: Callable, edges: Callable) -> int:
    handled = 0
    for row in stdb.sql("SELECT * FROM twin_topup WHERE status = 'queued'"):
        tid, brand = row["topup_id"], row["brand"]
        try:
            stdb.call("set_twin_topup", tid, "running", "")
        except StdbError:
            continue  # another worker took it
        try:
            build(stdb, client, brand, limit=row["count"], skip_existing=True, richest_first=True,
                  run_id=f"topup-{tid}-{brand}")
            edges(stdb, brand)
            stdb.call("set_twin_topup", tid, "done", "")
        except Exception as exc:  # noqa: BLE001 - the /ops page shows the error
            log.exception("twin top-up %s failed", tid)
            stdb.call("set_twin_topup", tid, "failed", f"{type(exc).__name__}: {exc}"[:MAX_ERROR])
        handled += 1
    return handled
