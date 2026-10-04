import json

import pytest

from conftest import FakeClient
from test_builder import PERSONA
from test_sync import audience_db, twin_db
from twins.cli import main


def test_build_prints_summary(capsys):
    code = main(["build", "--brand", "spacetimedb", "--workers", "1", "--min-posts", "3"], stdb=audience_db(),
                client=FakeClient([{**PERSONA, "evidence_post_ids": ["a2"]}, None, None]))
    out = capsys.readouterr().out
    assert code == 0 and "ready 1, failed 1, skipped 1 (partial)" in out


def test_ask_by_username_prints_json(capsys):
    db = twin_db()
    client = FakeClient([{"action": "like", "confidence": 0.5, "answer": "Nice.", "cited_post_ids": ["p2"]}])
    assert main(["ask", "--username", "@Alice", "--draft", "hello"], stdb=db, client=client) == 0
    assert json.loads(capsys.readouterr().out)["action"] == "like"


def test_ask_unknown_username(capsys):
    assert main(["ask", "--username", "ghost", "--draft", "x"], stdb=twin_db(), client=FakeClient([])) == 1
    assert "no twin for @ghost" in capsys.readouterr().err


def test_worker_runs_bounded_loops():
    db = twin_db()
    db.tables["twin_question"] = []
    assert main(["worker", "--poll", "0", "--max-loops", "2"], stdb=db, client=FakeClient([])) == 0


@pytest.mark.parametrize("args", [["--workers", "0"], ["--workers", "33"], ["--limit", "0"], ["--min-posts", "-1"]])
def test_build_rejects_out_of_range_numbers(args):
    with pytest.raises(SystemExit) as exc:
        main(["build", "--brand", "spacetimedb", *args], stdb=audience_db(), client=FakeClient([]))
    assert exc.value.code == 2


def test_lab_worker_runs_bounded_loops():
    db = twin_db()
    db.tables["lab_experiment"] = []
    assert main(["lab-worker", "--poll", "0", "--max-loops", "2"], stdb=db, client=FakeClient([])) == 0
