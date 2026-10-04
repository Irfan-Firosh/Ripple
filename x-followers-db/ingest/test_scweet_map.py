"""Scweet records -> the X API v2 shapes ingest_x.post_calls / user_args already store."""
from scweet_map import post_v2, to_iso, user_v2

USER = {
    "user_id": "14275130", "username": "jamesm", "name": "James McDonald",
    "description": "I run a tiny design studio", "location": "UK",
    "created_at": "Tue Apr 01 14:38:39 +0000 2008", "followers_count": 113330,
    "following_count": 2105, "statuses_count": 76984, "favourites_count": 87109,
    "media_count": 8090, "listed_count": 0, "verified": False, "blue_verified": True,
    "protected": False, "url": "https://t.co/x",
    "profile_image_url": "https://pbs.twimg.com/profile_images/1/zha_normal.jpg",
}

TWEET = {
    "tweet_id": "209", "timestamp": "Wed Aug 19 13:24:47 +0000 2026", "text": "Raycast v2 #launch",
    "likes": 1191, "comments": 64, "retweets": 106, "quotes": 52, "bookmarks": 232, "views": 223563,
    "lang": "en", "is_retweet": False,
    "raw": {"legacy": {
        "user_id_str": "1198", "in_reply_to_user_id_str": "77", "in_reply_to_status_id_str": "55",
        "quoted_status_id_str": "66",
        "entities": {
            "hashtags": [{"text": "launch", "indices": [11, 18]}],
            "user_mentions": [{"screen_name": "glazeapp", "id_str": "9", "indices": [0, 9]}],
            "urls": [{"url": "https://t.co/a", "expanded_url": "https://ray.so", "indices": [20, 30]}],
        },
        "extended_entities": {"media": [
            {"media_key": "3_1", "type": "photo", "media_url_https": "https://pbs.twimg.com/media/a.jpg"},
        ]},
    }},
}


def test_to_iso_converts_twitter_timestamp():
    assert to_iso("Wed Aug 19 13:24:47 +0000 2026") == "2026-08-19T13:24:47.000Z"


def test_to_iso_passes_none_through():
    assert to_iso(None) is None


def test_user_v2_maps_metrics_and_upgrades_avatar():
    u = user_v2(USER)
    assert u["id"] == "14275130" and u["username"] == "jamesm"
    assert u["created_at"] == "2008-04-01T14:38:39.000Z"
    assert u["verified"] is True and u["verified_type"] == "blue"
    assert u["profile_image_url"].endswith("zha_400x400.jpg")
    assert u["public_metrics"] == {
        "followers_count": 113330, "following_count": 2105, "listed_count": 0,
        "tweet_count": 76984, "like_count": 87109, "media_count": 8090,
    }


def test_post_v2_maps_metrics_references_entities_and_media():
    p, media = post_v2(TWEET)
    assert p["id"] == "209" and p["author_id"] == "1198"
    assert p["created_at"] == "2026-08-19T13:24:47.000Z"
    assert p["in_reply_to_user_id"] == "77"
    assert {(r["type"], r["id"]) for r in p["referenced_tweets"]} == {("replied_to", "55"), ("quoted", "66")}
    assert p["public_metrics"] == {
        "impression_count": 223563, "like_count": 1191, "reply_count": 64,
        "quote_count": 52, "retweet_count": 106, "bookmark_count": 232,
    }
    assert p["entities"]["hashtags"] == [{"tag": "launch", "start": 11, "end": 18}]
    assert p["entities"]["mentions"] == [{"username": "glazeapp", "id": "9", "start": 0, "end": 9}]
    assert p["entities"]["urls"] == [{"url": "https://t.co/a", "expanded_url": "https://ray.so", "start": 20, "end": 30}]
    assert p["attachments"] == {"media_keys": ["3_1"]}
    assert media == {"3_1": {"media_key": "3_1", "type": "photo", "url": "https://pbs.twimg.com/media/a.jpg"}}


def test_post_v2_without_raw_still_maps_core_fields():
    p, media = post_v2({**TWEET, "raw": None, "user": {"screen_name": "raycast"}}, author_id="1198")
    assert p["author_id"] == "1198" and p["referenced_tweets"] == [] and media == {}
