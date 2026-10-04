"""Small local log capture for the /logs development page."""
import json
import logging
import os
import re
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler

from twins.config import REPO_ROOT


class SafeFormatter(logging.Formatter):
    converter = time.gmtime

    def format(self, record):
        text = super().format(record)
        text = re.sub(r"(?i)(Bearer\s+)[^\s\"']+", r"\1[redacted]", text)
        return re.sub(r"(?i)((?:api[_-]?key|token|authorization)[\s\"']*[:=][\s\"']*)[^\s\"',}]+", r"\1[redacted]", text)


@contextmanager
def capture_worker_logs(database, server, *, directory=None):
    directory = directory or REPO_ROOT / "data/logs"
    directory.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^a-zA-Z0-9_-]", "_", database)
    handler = RotatingFileHandler(directory / f"creative-{name}.log", maxBytes=1_000_000, backupCount=1, encoding="utf-8")
    handler.setFormatter(SafeFormatter("%(asctime)s UTC %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    logger = logging.getLogger("creative")
    previous_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    stop = threading.Event()
    status_file = directory / f"creative-{name}.json"

    def status(state="running"):
        value = {"pid": os.getpid(), "state": state, "database": database, "server": server,
                 "updatedAt": datetime.now(timezone.utc).isoformat()}
        temporary = status_file.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(value))
        temporary.replace(status_file)

    def heartbeat():
        while not stop.wait(10):
            status()

    status()
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    logger.info("Worker started for %s; waiting for queued creative jobs", database)
    try:
        yield
    except Exception:
        logger.error("Worker stopped unexpectedly; check credentials and database connectivity")
        raise
    finally:
        stop.set()
        thread.join(timeout=1)
        status("offline")
        logger.info("Worker stopped")
        logger.removeHandler(handler)
        handler.close()
        logger.setLevel(previous_level)
