import pytest

from conftest import FakeStdb, user_row
from twins.brand_twins import load_brand_twins


def twin_row(uid, username, **kw):
    return {"user_id": uid, "username": username, "post_count": 3, "tone": "dry", "persona_summary": f"{username} persona",
            "hot_buttons": ["benchmarks"], "ignores": ["memes"], **kw}


def db():
    return FakeStdb({
        "x_user": [user_row("B", "raycast.com"), user_row("1", "a.bsky.social", followers_count=50,
                   profile_image_url="https://cdn.bsky.app/a"), user_row("2", "b.bsky.social"), user_row("9", "other")],
        "twin": [twin_row("1", "a.bsky.social"), twin_row("2", "b.bsky.social"), twin_row("9", "other")],
        "twin_audience": [{"brand_user_id": "B", "user_id": "1"}, {"brand_user_id": "B", "user_id": "2"},
                          {"brand_user_id": "Z", "user_id": "9"}],
        "twin_niche": [{"user_id": "1", "niche": "dev_tools", "affinity": 0.3}, {"user_id": "1", "niche": "ai_llms", "affinity": 0.6}],
    })


def test_loads_only_the_brands_twins_with_profiles_and_sorted_niches():
    brand, twins = load_brand_twins(db(), "@raycast.com")
    assert brand.user_id == "B"
    assert [t.username for t in twins] == ["a.bsky.social", "b.bsky.social"]
    a = twins[0]
    assert a.niches == [("ai_llms", 0.6), ("dev_tools", 0.3)] and a.followers == 50 and a.avatar == "https://cdn.bsky.app/a"
    assert twins[1].niches == []


def test_unknown_brand_and_brand_without_twins():
    with pytest.raises(ValueError, match="not in x_user"):
        load_brand_twins(db(), "nobody")
    stdb = db()
    stdb.tables["twin_audience"] = []
    with pytest.raises(ValueError, match="No twins"):
        load_brand_twins(stdb, "raycast.com")
