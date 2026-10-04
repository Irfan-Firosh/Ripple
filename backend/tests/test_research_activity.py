import json
import pytest
from creative import research_activity as activity


def test_records_live_call_before_request_and_preserves_results(tmp_path, monkeypatch):
    monkeypatch.setattr(activity, "ACTIVITY", tmp_path)
    result = [{"url": "https://raycast.com/blog"}]
    def request():
        event = json.loads((tmp_path / "raycast.jsonl").read_text())
        assert event["status"] == "running"
        return result
    assert activity.traced_search("@Raycast", "Raycast launch", request) is result
    events = [json.loads(line) for line in (tmp_path / "raycast.jsonl").read_text().splitlines()]
    assert [row["status"] for row in events] == ["running", "done"]
    assert events[0]["id"] == events[1]["id"] and events[1]["results"] == 1


def test_failure_records_no_request_secrets_and_rethrows(tmp_path, monkeypatch):
    monkeypatch.setattr(activity, "ACTIVITY", tmp_path)
    def request():
        raise RuntimeError("Authorization: secret-value")
    with pytest.raises(RuntimeError):
        activity.traced_search("raycast", "Raycast blog", request)
    text = (tmp_path / "raycast.jsonl").read_text()
    assert "secret-value" not in text and json.loads(text.splitlines()[-1])["status"] == "failed"


def test_unwritable_journal_does_not_block_generation(tmp_path, monkeypatch):
    path = tmp_path / "file"
    path.write_text("not a directory")
    monkeypatch.setattr(activity, "ACTIVITY", path)
    assert activity.traced_search("raycast", "Raycast blog", lambda: [1, 2]) == [1, 2]


def test_company_context_records_existing_searches_and_cache_reuse_costs_no_calls(tmp_path, monkeypatch):
    from datetime import date
    from creative import company
    monkeypatch.setattr(company, "CACHE", tmp_path)
    monkeypatch.setattr(activity, "ACTIVITY", tmp_path / "activity")
    queries = []
    def search(query, since):
        queries.append(query)
        return [{"title": "Launch", "url": "https://raycast.com/blog", "publishedDate": date.today().isoformat(), "summary": "New feature"}]
    monkeypatch.setattr(company, "_exa", search)
    monkeypatch.setattr(company, "homepage", lambda name: None)
    class Database:
        def sql(self, query):
            return []
    first = company.company_context(Database(), "raycast", "Raycast", shots=False)
    assert len(first["news"]) == 1 and len(queries) == 3
    assert company.company_context(Database(), "raycast", "Raycast", shots=False) == first
    assert len(queries) == 3
    events = [json.loads(line) for line in (tmp_path / "activity/raycast.jsonl").read_text().splitlines()]
    assert len(events) == 8
    assert [event["query"] for event in events[::2]] == queries + ["Raycast official website"]


def test_video_research_records_the_actual_request(tmp_path, monkeypatch):
    from video import research
    monkeypatch.setattr(activity, "ACTIVITY", tmp_path)
    monkeypatch.setattr(research, "exa_key", lambda: "test-only-key")
    class Response:
        def raise_for_status(self):
            pass
        def json(self):
            return {"results": [{"title": "Feature", "url": "https://raycast.com/blog", "text": "Verified feature"}]}
    class Session:
        def post(self, url, **kwargs):
            assert url == "https://api.exa.ai/search" and kwargs["json"]["query"] == "raycast new shortcut"
            return Response()
    assert len(research.research("raycast", "new shortcut", session=Session())) == 1
    journal = (tmp_path / "raycast.jsonl").read_text()
    assert "test-only-key" not in journal
    assert json.loads(journal.splitlines()[-1])["results"] == 1
