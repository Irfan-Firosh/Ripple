"""Scweet (X web GraphQL) records -> the X API v2 dict shapes that ingest_x.user_args / post_calls store.

Keeping one storage path means scraped data lands in exactly the same SpacetimeDB rows as the paid API did.
"""
from datetime import datetime


def to_iso(ts: str | None) -> str | None:
    """'Wed Aug 19 13:24:47 +0000 2026' -> '2026-08-19T13:24:47.000Z' (the v2 format already stored)."""
    if not ts:
        return None
    return datetime.strptime(ts, "%a %b %d %H:%M:%S %z %Y").strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _avatar(url: str | None) -> str | None:
    # X serves 48px "_normal" avatars by default; the 400px variant keeps the network nodes crisp.
    return url.replace("_normal.", "_400x400.") if url else url


def user_v2(u: dict) -> dict:
    return {
        "id": u["user_id"],
        "username": u["username"],
        "name": u.get("name") or u["username"],
        "description": u.get("description"),
        "location": u.get("location"),
        "created_at": to_iso(u.get("created_at")),
        "url": u.get("url"),
        "profile_image_url": _avatar(u.get("profile_image_url")),
        "protected": bool(u.get("protected")),
        "verified": bool(u.get("verified") or u.get("blue_verified")),
        "verified_type": "blue" if u.get("blue_verified") else None,
        "public_metrics": {
            "followers_count": u.get("followers_count"),
            "following_count": u.get("following_count"),
            "listed_count": u.get("listed_count"),
            "tweet_count": u.get("statuses_count"),
            "like_count": u.get("favourites_count"),
            "media_count": u.get("media_count"),
        },
    }


def _span(e: dict) -> dict:
    start, end = e.get("indices", [0, 0])
    return {"start": start, "end": end}


def _entities(legacy: dict) -> dict:
    ents = legacy.get("entities") or {}
    return {
        "hashtags": [{"tag": h["text"], **_span(h)} for h in ents.get("hashtags", [])],
        "cashtags": [{"tag": s["text"], **_span(s)} for s in ents.get("symbols", [])],
        "mentions": [{"username": m["screen_name"], "id": m.get("id_str"), **_span(m)}
                     for m in ents.get("user_mentions", [])],
        "urls": [{"url": u["url"], "expanded_url": u.get("expanded_url"), **_span(u)} for u in ents.get("urls", [])],
    }


def _media(legacy: dict) -> dict[str, dict]:
    items = (legacy.get("extended_entities") or {}).get("media", [])
    return {
        m["media_key"]: {"media_key": m["media_key"], "type": m.get("type", "photo"), "url": m.get("media_url_https")}
        for m in items if m.get("media_key")
    }


def post_v2(t: dict, author_id: str | None = None) -> tuple[dict, dict[str, dict]]:
    """One Scweet tweet -> (v2 post dict, media_by_key). `author_id` is the fallback when raw is missing."""
    legacy = ((t.get("raw") or {}).get("legacy")) or {}
    refs = [{"type": "replied_to", "id": legacy["in_reply_to_status_id_str"]}] \
        if legacy.get("in_reply_to_status_id_str") else []
    if legacy.get("quoted_status_id_str"):
        refs.append({"type": "quoted", "id": legacy["quoted_status_id_str"]})
    media = _media(legacy)
    post = {
        "id": t["tweet_id"],
        "author_id": legacy.get("user_id_str") or author_id,
        "text": t.get("text") or "",
        "created_at": to_iso(t.get("timestamp")),
        "lang": t.get("lang"),
        "in_reply_to_user_id": legacy.get("in_reply_to_user_id_str"),
        "referenced_tweets": refs,
        "public_metrics": {
            "impression_count": t.get("views"),
            "like_count": t.get("likes"),
            "reply_count": t.get("comments"),
            "quote_count": t.get("quotes"),
            "retweet_count": t.get("retweets"),
            "bookmark_count": t.get("bookmarks"),
        },
        "entities": _entities(legacy),
    }
    if media:
        post["attachments"] = {"media_keys": list(media)}
    return post, media
