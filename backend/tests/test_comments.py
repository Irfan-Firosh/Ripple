from conftest import FakeClient, FakeStdb
from test_graph import bt
from twins.comments import write_comments


def events_db(*rows):
    return FakeStdb({"sim_event": [dict(run_id="r1", user_id=u, signal=s, tick=t) for u, s, t in rows]})


def test_repliers_and_quoters_get_comments_in_their_voice():
    db = events_db(("a", "reply", 0), ("b", "quote", 2), ("c", "like", 0))
    client = FakeClient([{"comments": [{"user_id": "a", "text": "Does it work offline?"},
                                       {"user_id": "b", "text": "Finally, local AI done right."},
                                       {"user_id": "zzz", "text": "not asked"}]}])
    n = write_comments(db, client, "r1", "Raycast AI runs locally", [bt("a", "x", 1), bt("b", "x", 1), bt("c", "x", 1)])
    assert n == 2
    [(run_id, comments)] = db.reducers("add_sim_comments")
    assert run_id == "r1"
    assert {(c["user_id"], c["kind"], c["tick"]) for c in comments} == {("a", "reply", 0), ("b", "quote", 2)}
    assert '<draft>Raycast AI runs locally</draft>' in client.calls[0]["messages"][0]["content"]


def test_no_repliers_means_no_claude_call():
    db = events_db(("c", "like", 0))
    client = FakeClient([])
    assert write_comments(db, client, "r1", "d", [bt("c", "x", 1)]) == 0 and client.calls == []


def test_a_failed_comment_call_never_breaks_the_run():
    db = events_db(("a", "reply", 0))
    assert write_comments(db, FakeClient([None, None]), "r1", "d", [bt("a", "x", 1)]) == 0
