"""Worker log format for /logs: timestamped INFO lines, without the HTTP clients' per-request chatter."""
import logging

QUIET = ("httpx", "httpcore", "urllib3", "anthropic", "requests")


def setup_worker_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        datefmt="%Y-%m-%d %H:%M:%S")
    for name in QUIET:
        logging.getLogger(name).setLevel(logging.WARNING)
