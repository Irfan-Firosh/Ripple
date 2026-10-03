import json
from types import SimpleNamespace

import pytest

from twins.stdb import StdbClient, StdbError, decode, opt, sql_str

OPT_STR = {"Sum": {"variants": [{"name": {"some": "some"}, "algebraic_type": {"String": []}},
                                {"name": {"some": "none"}, "algebraic_type": {"Product": {"elements": []}}}]}}
TS = {"Product": {"elements": [{"name": {"some": "__timestamp_micros_since_unix_epoch__"}, "algebraic_type": {"I64": []}}]}}
TOPIC = {"Product": {"elements": [{"name": {"some": "topic"}, "algebraic_type": {"String": []}},
                                  {"name": {"some": "affinity"}, "algebraic_type": {"F64": []}}]}}


def test_decode_option_timestamp_array_product():
    assert decode([0, "hi"], OPT_STR) == "hi"
    assert decode([1, []], OPT_STR) is None
    assert decode([1791061278537025], TS) == 1791061278537025
    assert decode([["db", 0.5]], {"Array": TOPIC}) == [{"topic": "db", "affinity": 0.5}]
    assert decode(7, {"U64": []}) == 7


def test_opt_and_sql_str():
    assert opt(None) == {"none": []} and opt(0) == {"some": 0}
    assert sql_str("o'brien") == "'o''brien'"


class FakeSession:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.posts = []

    def post(self, url, data=None, headers=None, timeout=None):
        self.posts.append((url, data, headers))
        status, body = self.responses.pop(0)
        return SimpleNamespace(status_code=status, text=json.dumps(body), json=lambda: body)


def test_sql_decodes_rows_and_sends_auth():
    body = [{"schema": {"elements": [{"name": {"some": "user_id"}, "algebraic_type": {"String": []}},
                                     {"name": {"some": "location"}, "algebraic_type": OPT_STR}]},
             "rows": [["1", [1, []]], ["2", [0, "NYC"]]]}]
    session = FakeSession((200, body))
    client = StdbClient("https://h", "db", token="tok", session=session)
    assert client.sql("SELECT * FROM x_user") == [{"user_id": "1", "location": None}, {"user_id": "2", "location": "NYC"}]
    url, data, headers = session.posts[0]
    assert url == "https://h/v1/database/db/sql" and data == b"SELECT * FROM x_user"
    assert headers["Authorization"] == "Bearer tok"


def test_call_sends_json_array_and_raises_on_reducer_error():
    session = FakeSession((200, {}), (530, {"error": "not authorized"}))
    client = StdbClient("https://h", "db", token="tok", session=session)
    client.call("ask_twin", "1", "draft", "")
    assert session.posts[0][0] == "https://h/v1/database/db/call/ask_twin"
    assert json.loads(session.posts[0][1]) == ["1", "draft", ""]
    with pytest.raises(StdbError, match="530"):
        client.call("publish_twin", "x")


def test_network_errors_are_wrapped():
    import requests

    class Boom:
        def post(self, *a, **k):
            raise requests.ConnectionError("dns down")

    client = StdbClient("https://h", "db", session=Boom())
    with pytest.raises(StdbError, match="dns down"):
        client.sql("SELECT * FROM x_user")
    with pytest.raises(StdbError, match="dns down"):
        client.call("ask_twin", "1")
