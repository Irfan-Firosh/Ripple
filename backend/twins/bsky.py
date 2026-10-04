"""Public Bluesky reads (no auth): a brand's original posts and who liked/reposted/replied/quoted each one."""
from pydantic import BaseModel
import requests

BSKY = "https://public.api.bsky.app/xrpc/"
TIMEOUT = 20


class BrandPost(BaseModel):
    uri: str
    cid: str
    text: str
    created_at: str
    like_count: int
    repost_count: int
    reply_count: int
    quote_count: int


def _get(session, method: str, **params) -> dict:
    resp = (session or requests).get(BSKY + method, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _pages(session, method: str, key: str, **params):
    cursor = None
    while True:
        data = _get(session, method, **params, **({"cursor": cursor} if cursor else {}))
        items = data.get(key, [])
        yield from items
        cursor = data.get("cursor")
        if not cursor or not items:
            return


def fetch_brand_posts(handle: str, *, since: str | None = None, session=None, brand_did: str | None = None) -> list[BrandPost]:
    did = brand_did or _get(session, "app.bsky.actor.getProfile", actor=handle)["did"]
    out = []
    for item in _pages(session, "app.bsky.feed.getAuthorFeed", "feed", actor=handle, limit=100, filter="posts_no_replies"):
        p = item["post"]
        if p["author"]["did"] != did or "reason" in item:
            continue  # someone else's post, or a repost
        if since and p["indexedAt"] < since:
            break
        out.append(BrandPost(uri=p["uri"], cid=p["cid"], text=p["record"].get("text", ""), created_at=p["indexedAt"],
                             like_count=p.get("likeCount", 0), repost_count=p.get("repostCount", 0),
                             reply_count=p.get("replyCount", 0), quote_count=p.get("quoteCount", 0)))
    return out


def fetch_engagers(uri: str, *, session=None) -> dict[str, set[str]]:
    likes = {x["actor"]["did"] for x in _pages(session, "app.bsky.feed.getLikes", "likes", uri=uri, limit=100)}
    reposts = {x["did"] for x in _pages(session, "app.bsky.feed.getRepostedBy", "repostedBy", uri=uri, limit=100)}
    quotes = {x["author"]["did"] for x in _pages(session, "app.bsky.feed.getQuotes", "posts", uri=uri, limit=100)}
    thread = _get(session, "app.bsky.feed.getPostThread", uri=uri, depth=1).get("thread", {})
    replies = {r["post"]["author"]["did"] for r in thread.get("replies", []) if "post" in r}
    return {"like": likes, "repost": reposts, "reply": replies, "quote": quotes}
