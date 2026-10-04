import json
import logging

from creative.logs import capture_worker_logs


def test_worker_logs_capture_activity_redact_credentials_and_set_offline(tmp_path):
    logger = logging.getLogger("creative.worker")
    before = list(logging.getLogger("creative").handlers)
    with capture_worker_logs("local-db", "http://127.0.0.1:3100", directory=tmp_path):
        status = json.loads((tmp_path / "creative-local-db.json").read_text())
        assert status["state"] == "running" and status["pid"] > 0
        logger.info("Brief request started; token=private-token Authorization: Bearer private-key")
        log = (tmp_path / "creative-local-db.log").read_text()
        assert "Brief request started" in log and "UTC INFO" in log
        assert "private-token" not in log and "private-key" not in log
    assert json.loads((tmp_path / "creative-local-db.json").read_text())["state"] == "offline"
    assert "Worker stopped" in (tmp_path / "creative-local-db.log").read_text()
    assert list(logging.getLogger("creative").handlers) == before


def test_worker_exception_is_logged_without_exception_payload(tmp_path):
    try:
        with capture_worker_logs("local-db", "local", directory=tmp_path):
            raise RuntimeError("private request body")
    except RuntimeError:
        pass
    log = (tmp_path / "creative-local-db.log").read_text()
    assert "Worker stopped unexpectedly" in log and "private request body" not in log
    assert json.loads((tmp_path / "creative-local-db.json").read_text())["state"] == "offline"
