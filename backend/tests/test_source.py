import pytest

from conftest import FakeStdb, post_row, user_row
from twins.source import load_audience


def db():
    return FakeStdb({
        "x_user": [user_row("100", "spacetimedb"), user_row("1", "alice"), user_row("2", "bob"), user_row("3", "stranger")],
        "audience_membership": [{"brand_user_id": "100", "follower_user_id": "2"},
                                {"brand_user_id": "100", "follower_user_id": "1"},
                                {"brand_user_id": "100", "follower_user_id": "999"}],  # no x_user row
        "x_post": [post_row("p1", "1"), post_row("p2", "1"), post_row("p3", "2"), post_row("p9", "3")],
        "x_post_entity": [{"post_id": "p1", "entity_type": "mention", "value": "@SpacetimeDB"},
                          {"post_id": "p1", "entity_type": "hashtag", "value": "gamedev"}],
        "x_context_annotation": [{"post_id": "p1", "entity_name": "Databases"}],
    })


def test_load_audience_joins_rows():
    brand, accounts = load_audience(db(), "@SpacetimeDB")
    assert brand.user_id == "100"
    assert [a.user.username for a in accounts] == ["alice", "bob"]  # sorted by user_id, unknown 999 dropped
    alice = accounts[0]
    assert [p.post_id for p in alice.posts] == ["p1", "p2"]
    assert alice.mentions == {"p1": ["@SpacetimeDB"]}  # hashtags excluded
    assert alice.annotations == {"p1": ["Databases"]}


def test_unknown_brand():
    with pytest.raises(ValueError, match="not in x_user"):
        load_audience(db(), "nobody")


def test_invalid_brand_username():
    with pytest.raises(ValueError, match="invalid"):
        load_audience(db(), "x' OR '1'='1")
