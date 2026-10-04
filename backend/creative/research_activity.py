"""Record actual Exa request activity for the local Campaign research panel."""
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, TypeVar

ACTIVITY = Path(__file__).resolve().parents[2] / "data" / "research" / "activity"
T = TypeVar("T")
log = logging.getLogger(__name__)


def traced_search(brand: str, query: str, request: Callable[[], T]) -> T:
    """Observe an existing call; never start extra research or record credentials."""
    handle = re.sub(r"[^a-z0-9_.-]", "_", brand.lower().lstrip("@"))[:80]
    request_id, start = uuid.uuid4().hex, time.monotonic()

    def record(status: str, results: int | None = None) -> None:
        event = {"id": request_id, "query": query[:240], "status": status,
                 "at": datetime.now(timezone.utc).isoformat(),
                 "durationMs": round((time.monotonic() - start) * 1000), "results": results}
        try:
            ACTIVITY.mkdir(parents=True, exist_ok=True)
            with (ACTIVITY / f"{handle}.jsonl").open("a") as stream:
                stream.write(json.dumps(event) + "\n")
        except OSError:
            log.warning("Could not record research activity for %s", handle)

    record("running")
    try:
        result = request()
    except Exception:
        record("failed")
        raise
    record("done", len(result) if isinstance(result, list) else int(bool(result)))
    return result
