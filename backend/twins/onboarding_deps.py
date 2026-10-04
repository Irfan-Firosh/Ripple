"""Real dependencies for the onboarding worker: the Scweet ingest (x-followers-db/ingest) and a backfill thread."""
import logging
import sys
import threading
from pathlib import Path

from .graph import publish_edges
from .onboarding import LIVE_POSTS, run_id_for
from .settings import load_settings
from .stdb import sql_str
from .sync import run_build

log = logging.getLogger(__name__)
INGEST_DIR = Path(__file__).resolve().parents[2] / "x-followers-db" / "ingest"
RATE_WAIT = 15 * 60


def scweet_ingest():
    if str(INGEST_DIR) not in sys.path:
        sys.path.insert(0, str(INGEST_DIR))
    from ingest_scweet import ingest  # noqa: PLC0415 - lives beside the SpacetimeDB module, not in this package
    return ingest


def backfill(stdb, client, ingest):
    """After the live phase: fetch the remaining timelines (sitting out rate limits), twin everyone, regraph."""
    def run(row: dict, summary: dict) -> None:
        handle = row["handle"]
        try:
            settings = load_settings(stdb)
            if summary.get("pending"):
                ingest(handle, followers=settings.followers_scraped, posts=LIVE_POSTS, run_id=run_id_for(row),
                       wait_seconds=RATE_WAIT)
            have = len(stdb.sql(f"SELECT user_id FROM twin_audience WHERE brand_user_id = {sql_str(summary['brand_user_id'])}"))
            if have < settings.twins_per_brand:  # backfill up to the /ops twins-per-brand setting, never past it
                run_build(stdb, client, handle, run_id=f"twins-{run_id_for(row)}-backfill", skip_existing=True,
                          limit=settings.twins_per_brand - have, richest_first=True)
            publish_edges(stdb, handle)
            from .audience_history import capture_audience
            capture_audience(stdb, handle, f'twins-{run_id_for(row)}-backfill', 'ready')
        except Exception:  # noqa: BLE001 - the brand is already usable; log and move on
            log.exception("backfill for @%s failed", handle)

    def start(row: dict, summary: dict) -> None:
        threading.Thread(target=run, args=(row, summary), name=f"backfill-{row['handle']}", daemon=True).start()
    return start
