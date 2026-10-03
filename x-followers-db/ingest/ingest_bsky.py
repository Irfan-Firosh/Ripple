"""One-time Bluesky -> SpacetimeDB import of a brand's most recent followers.

Uses Bluesky's public AppView (no account or API key needed) and writes into the same raw
tables as ingest_x.py. Bluesky rows are recognisable by their ids: users are DIDs (did:...),
posts are at:// URIs, and ingestion runs are prefixed `bsky-`.

Calls made: 1 getFollowers per 100 followers scanned, 1 getProfiles per 25 of them, then
1-3 getAuthorFeed calls per kept follower. Requests are throttled and every response is
cached under data/bsky_raw/<handle>/, so re-running only fetches what is missing.

  python ingest_bsky.py --handle raycast.com --followers 1000 --posts 30
  python ingest_bsky.py --handle raycast.com --followers 1000 --offline   # cache only
"""
import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from ingest_x import ROOT, call, opt

BSKY = "https://public.api.bsky.app/xrpc"
MIN_INTERVAL = 0.25  # seconds between Bluesky requests (~4 req/s), well under the public AppView limits
# Users who set this self-label asked not to be shown to logged-out viewers; treat them like protected X accounts.
NO_UNAUTH_LABEL = "!no-unauthenticated"

OFFLINE = False
_last_request = 0.0
session = requests.Session()


# ---------- Bluesky API (sequential, throttled, cached) ----------

class BskyError(Exception):
    pass


def bsky_get(method, params):
    global _last_request
    if OFFLINE:
        raise BskyError(f"--offline: refusing to call {method} (not in cache)")
    for attempt in range(8):
        wait = MIN_INTERVAL - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        try:
            r = session.get(f"{BSKY}/{method}", params=params, timeout=30)
        except requests.RequestException:
            time.sleep(min(2 ** attempt, 60))
            continue
        if r.status_code == 429:
            reset = int(r.headers.get("ratelimit-reset", time.time() + 60))
            pause = min(max(reset - time.time(), 5), 15 * 60)
            print(f"  rate limited on {method}, sleeping {pause:.0f}s")
            time.sleep(pause)
            continue
        if r.status_code >= 500:
            time.sleep(min(2 ** attempt, 60))
            continue
        if r.status_code != 200:
            raise BskyError(f"{method} -> HTTP {r.status_code}: {r.text[:200]}")
        return r.json()
    raise BskyError(f"{method}: gave up after retries")


def cached(path: Path, fetch):
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def fetch_followers_page(cache: Path, did, page):
    """Page `page` (0-based) of followers, newest first, with full profiles (counts included)."""
    cursor = None
    if page > 0:
        cursor = fetch_followers_page(cache, did, page - 1).get("cursor")
        if not cursor:
            return {}

    def fetch():
        params = {"actor": did, "limit": 100}
        if cursor:
            params["cursor"] = cursor
        res = bsky_get("app.bsky.graph.getFollowers", params)
        # getFollowers omits follower/post counts; hydrate them 25 at a time.
        dids = [f["did"] for f in res.get("followers", [])]
        profiles = {}
        for i in range(0, len(dids), 25):
            batch = bsky_get("app.bsky.actor.getProfiles", {"actors": dids[i:i + 25]})
            profiles.update({p["did"]: p for p in batch.get("profiles", [])})
        res["followers"] = [profiles.get(f["did"], f) for f in res.get("followers", [])]
        return res

    return cached(cache / f"followers_p{page}.json", fetch)


def fetch_posts(cache: Path, did, n):
    """The user's latest <= n own posts and replies (reposts dropped), up to 3 feed pages."""
    def fetch():
        posts, cursor = [], None
        for _ in range(3):
            params = {"actor": did, "limit": 100, "filter": "posts_with_replies"}
            if cursor:
                params["cursor"] = cursor
            res = bsky_get("app.bsky.feed.getAuthorFeed", params)
            posts += [i["post"] for i in res.get("feed", [])
                      if "reason" not in i and i["post"]["author"]["did"] == did]
            cursor = res.get("cursor")
            if len(posts) >= n or not cursor:
                break
        return posts
    return cached(cache / "posts" / f"{did.replace(':', '_')}.json", fetch)[:n]


# ---------- Bluesky JSON -> reducer args ----------

def user_args(p):
    v = p.get("verification")
    verified = v.get("verifiedStatus") == "valid" if v else None
    return [
        p["did"], p["handle"], p.get("displayName") or p["handle"], opt(p.get("description")), opt(None),
        opt(p.get("createdAt")), opt(None), opt(p.get("avatar")),
        opt(False), opt(verified), opt("bluesky" if verified else None),
        opt(p.get("followersCount")), opt(p.get("followsCount")), opt(None),
        opt(p.get("postsCount")), opt(None), opt(None),
    ]


def did_of(uri):
    return uri.split("/")[2]


def quoted_uri(record_embed):
    t = (record_embed or {}).get("$type", "")
    if t == "app.bsky.embed.record":
        uri = record_embed["record"]["uri"]
    elif t == "app.bsky.embed.recordWithMedia":
        uri = record_embed["record"]["record"]["uri"]
    else:
        return None
    return uri if "/app.bsky.feed.post/" in uri else None  # embeds can also be lists or feeds


def post_calls(p):
    """Every reducer call needed to store one Bluesky post and its metadata."""
    rec, uri = p["record"], p["uri"]
    text = rec.get("text", "")
    raw = text.encode("utf-8")
    reply = rec.get("reply")
    quote = quoted_uri(rec.get("embed"))
    langs = rec.get("langs") or []
    none = opt(None)

    calls = [("upsert_x_post", [
        uri, p["author"]["did"], text, rec.get("createdAt") or p["indexedAt"], opt(langs[0] if langs else None),
        opt(did_of(reply["parent"]["uri"]) if reply else None), reply is not None, quote is not None,
        none, opt(p.get("likeCount")), opt(p.get("replyCount")),
        opt(p.get("quoteCount")), opt(p.get("repostCount")), opt(p.get("bookmarkCount")),
    ])]
    if reply:
        calls.append(("upsert_post_reference", [uri, reply["parent"]["uri"], "replied_to"]))
    if quote:
        calls.append(("upsert_post_reference", [uri, quote, "quoted"]))

    # Facet offsets are UTF-8 byte positions; store character positions like X does.
    def char_at(b):
        return len(raw[:b].decode("utf-8", "ignore"))

    links = {}
    for facet in rec.get("facets") or []:
        start, end = facet["index"]["byteStart"], facet["index"]["byteEnd"]
        cs, ce = char_at(start), char_at(end)
        for f in facet.get("features", []):
            kind = f.get("$type", "")
            if kind.endswith("#mention"):
                handle = raw[start:end].decode("utf-8", "ignore").lstrip("@")
                calls.append(("upsert_post_entity", [uri, "mention", handle, cs, ce, opt(f["did"]), none, none]))
            elif kind.endswith("#tag"):
                calls.append(("upsert_post_entity", [uri, "hashtag", f["tag"], cs, ce, none, none, none]))
            elif kind.endswith("#link"):
                links[f["uri"]] = [uri, "url", f["uri"], cs, ce, none, none, none]

    view = p.get("embed") or {}
    media = view.get("media") if view.get("$type", "").startswith("app.bsky.embed.recordWithMedia") else view
    media = media or {}
    mtype = media.get("$type", "")
    if mtype.startswith("app.bsky.embed.external"):
        ext = media["external"]
        # Link cards have no position in the text; unmatched ones are stored at the end-of-text offset.
        entity = links.get(ext["uri"]) or [uri, "url", ext["uri"], len(text), len(text), none, none, none]
        entity[6], entity[7] = opt(ext.get("title")), opt(ext.get("description"))
        links[ext["uri"]] = entity
    elif mtype.startswith("app.bsky.embed.images"):
        for i, img in enumerate(media.get("images", [])):
            calls.append(("upsert_post_media", [uri, str(i), "photo", opt(img.get("fullsize")),
                                                opt(img.get("alt")), none]))
    elif mtype.startswith("app.bsky.embed.video"):
        calls.append(("upsert_post_media", [uri, "0", "video", opt(media.get("thumbnail")),
                                            opt(media.get("alt")), none]))
    calls += [("upsert_post_entity", e) for e in links.values()]
    return calls


# ---------- main ----------

def main():
    global OFFLINE
    ap = argparse.ArgumentParser()
    ap.add_argument("--handle", default="raycast.com")
    ap.add_argument("--followers", type=int, default=1000, help="keep this many usable followers")
    ap.add_argument("--posts", type=int, default=30, help="max posts per follower")
    ap.add_argument("--max-pages", type=int, default=50, help="max follower pages (100 each) to scan")
    ap.add_argument("--min-posts", type=int, default=10, help="skip accounts with fewer lifetime posts")
    ap.add_argument("--min-followers", type=int, default=1, help="skip accounts with fewer followers")
    ap.add_argument("--offline", action="store_true", help="only use cached Bluesky data")
    args = ap.parse_args()
    OFFLINE = args.offline

    cache = ROOT / "data" / "bsky_raw" / args.handle
    target = cached(cache / "target.json", lambda: bsky_get("app.bsky.actor.getProfile", {"actor": args.handle}))
    did = target["did"]
    run_id = f"bsky-{args.handle}-recent{args.followers}"
    print(f"target {target['handle']} ({did}): {target.get('followersCount')} followers")

    def protected(u):
        return any(lbl.get("val") == NO_UNAUTH_LABEL for lbl in u.get("labels", []))

    def usable(u):
        is_bot = any(lbl.get("val") == "bot" for lbl in u.get("labels", []))
        return (u["did"] != did and not protected(u) and not is_bot and u.get("postsCount", 0) >= args.min_posts
                and u.get("followersCount", 0) >= args.min_followers)

    followers, page = [], 0
    while page < args.max_pages and sum(map(usable, followers)) < args.followers:
        batch = fetch_followers_page(cache, did, page).get("followers", [])
        if not batch:
            break
        followers += batch
        page += 1
    keep = [u for u in followers if usable(u)][: args.followers]
    skipped_protected = sum(map(protected, followers))
    print(f"scanned {page} page(s), {len(followers)} followers; keeping {len(keep)} "
          f"({skipped_protected} opted out of logged-out view, rest <{args.min_posts} posts / "
          f"<{args.min_followers} followers)")

    call("start_ingestion_run", run_id, args.handle, args.followers)
    call("upsert_x_user", *user_args(target))

    posts_by_user, failed = {}, 0
    for i, u in enumerate(keep, 1):
        try:
            posts_by_user[u["did"]] = fetch_posts(cache, u["did"], args.posts)
        except BskyError as e:
            failed += 1
            print(f"  [{i}/{len(keep)}] {u['handle']} skipped: {e}")
        if i % 50 == 0:
            print(f"fetched feeds {i}/{len(keep)}")

    saved = posts_saved = 0

    def checkpoint(last):
        call("update_ingestion_run", run_id, opt(did), args.followers, len(followers), saved,
             skipped_protected, failed, posts_saved, opt(last), opt(None))

    def write_user(u):
        try:
            posts = posts_by_user[u["did"]]
            call("upsert_x_user", *user_args(u))
            call("upsert_audience_membership", did, u["did"], run_id, "follower")
            for p in posts:
                for reducer, a in post_calls(p):
                    call(reducer, *a)
            return len(posts)
        except Exception as e:  # keep going; the run is marked partial
            print(f"  {u['handle']} FAILED: {e}")
            return None

    users = [u for u in keep if u["did"] in posts_by_user]
    with ThreadPoolExecutor(16) as pool:
        for i, (u, n) in enumerate(zip(users, pool.map(write_user, users)), 1):
            if n is None:
                failed += 1
                continue
            saved += 1
            posts_saved += n
            if i % 50 == 0:
                print(f"saved {i}/{len(users)} users, {posts_saved} posts")
                checkpoint(u["did"])

    checkpoint(users[-1]["did"] if users else None)
    status = "completed" if failed == 0 else "partial"
    call("complete_ingestion_run", run_id, status, opt(f"{failed} feeds unavailable" if failed else None))
    print(f"done: {status}, {saved} followers, {posts_saved} posts")


if __name__ == "__main__":
    sys.exit(main())
