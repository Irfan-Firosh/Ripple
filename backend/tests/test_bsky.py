from twins.bsky import fetch_brand_posts, fetch_engagers


class FakeResp:
    def __init__(self, data):
        self.data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self.data


class FakeSession:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url.rsplit("/", 1)[-1], dict(params or {})))
        key = url.rsplit("/", 1)[-1] + ("#" + params["cursor"] if params and params.get("cursor") else "")
        return FakeResp(self.routes[key])


def post(uri, did="did:brand", text="t", when="2026-09-01T00:00:00Z", likes=1):
    return {"post": {"uri": uri, "cid": "c", "author": {"did": did}, "indexedAt": when, "record": {"text": text},
                     "likeCount": likes, "repostCount": 0, "replyCount": 0, "quoteCount": 0}}


def test_brand_posts_are_original_paginated_and_cut_at_since():
    s = FakeSession({
        "app.bsky.feed.getAuthorFeed": {"feed": [post("p1"), {**post("rp", did="did:other")}, {**post("p2"), "reason": {}}],
                                        "cursor": "c2"},
        "app.bsky.feed.getAuthorFeed#c2": {"feed": [post("p3", when="2024-01-01T00:00:00Z")]},
    })
    out = fetch_brand_posts("brand.com", since="2025-01-01", session=s, brand_did="did:brand")
    assert [p.uri for p in out] == ["p1"]


def test_engagers_cover_all_four_signals_with_pagination():
    s = FakeSession({
        "app.bsky.feed.getLikes": {"likes": [{"actor": {"did": "a"}}], "cursor": "n"},
        "app.bsky.feed.getLikes#n": {"likes": [{"actor": {"did": "b"}}]},
        "app.bsky.feed.getRepostedBy": {"repostedBy": [{"did": "c"}]},
        "app.bsky.feed.getQuotes": {"posts": [{"author": {"did": "d"}}]},
        "app.bsky.feed.getPostThread": {"thread": {"replies": [{"post": {"author": {"did": "e"}}}]}},
    })
    assert fetch_engagers("p1", session=s) == {"like": {"a", "b"}, "repost": {"c"}, "quote": {"d"}, "reply": {"e"}}
