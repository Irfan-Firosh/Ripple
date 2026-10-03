import re
from types import SimpleNamespace

from twins.stdb import StdbError


class FakeClient:
    """Mimics anthropic.Anthropic().messages.create for tool-forced calls.

    Each response is the dict the model "returns" as tool input, or None for a
    reply with no tool_use block. Thread-safe enough for workers=1 tests.
    """

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        payload = self._responses.pop(0)
        content = [SimpleNamespace(type="text", text="ok")]
        if payload is not None:
            content.append(SimpleNamespace(type="tool_use", name=kwargs["tool_choice"]["name"], input=payload))
        return SimpleNamespace(content=content)


_SELECT = re.compile(r"SELECT (?P<cols>.+?) FROM (?P<table>\w+)(?: WHERE (?P<col>\w+) = '(?P<val>(?:[^']|'')*)')?$")


class FakeStdb:
    """In-memory stand-in for StdbClient. Supports `SELECT cols FROM t [WHERE c = 'v']`."""

    def __init__(self, tables=None):
        self.tables = {k: list(v) for k, v in (tables or {}).items()}
        self.calls = []
        self.queries = []
        self.fail_on = set()

    def sql(self, query):
        self.queries.append(query)
        m = _SELECT.match(query.strip())
        assert m, f"FakeStdb cannot parse: {query}"
        rows = self.tables.get(m["table"], [])
        if m["col"]:
            val = m["val"].replace("''", "'")
            rows = [r for r in rows if str(r.get(m["col"])) == val]
        if m["cols"].strip() != "*":
            cols = [c.strip() for c in m["cols"].split(",")]
            rows = [{c: r[c] for c in cols} for r in rows]
        return [dict(r) for r in rows]

    def call(self, reducer, *args):
        self.calls.append((reducer, args))
        if reducer in self.fail_on:
            raise StdbError(f"{reducer} -> HTTP 530: boom")

    def reducers(self, name):
        return [args for r, args in self.calls if r == name]


def user_row(user_id, username, **kw):
    return {"user_id": user_id, "username": username, "name": username.title(), "description": None,
            "location": None, "followers_count": 10, "following_count": 5, "verified": False, **kw}


def post_row(post_id, author_user_id, text="hello", **kw):
    return {"post_id": post_id, "author_user_id": author_user_id, "text": text,
            "created_at": "2026-10-01T15:00:00.000Z", "is_reply": False, "is_quote": False,
            "impression_count": 100, "like_count": 5, "reply_count": 1, "quote_count": 0, "repost_count": 1, **kw}
