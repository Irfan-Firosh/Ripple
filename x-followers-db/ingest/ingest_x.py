"""One-time X -> SpacetimeDB import of a brand's most recent followers (official X API v2 only).

X calls made: 1 followers call (N users, $0.010 each) + 1 timeline call per public follower
(<= --posts posts, $0.005 each). Every response is cached under data/x_raw/<username>/, so
re-running never pays for data already fetched.

  python ingest_x.py --followers 95 --posts 25     # ~$13.90 worst case
  python ingest_x.py --followers 1 --offline       # reload from cache only, never calls X
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

X_API = "https://api.x.com/2"
STDB = os.environ.get("STDB_URL", "https://maincloud.spacetimedb.com")
DB = os.environ.get("STDB_DATABASE", "ripple-mhacks")

# No user expansions: pinned/most-recent post expansions bill extra posts per user.
USER_FIELDS = (
    "created_at,description,location,public_metrics,protected,verified,verified_type,url,profile_image_url"
)
TWEET_FIELDS = (
    "attachments,author_id,context_annotations,created_at,entities,in_reply_to_user_id,lang,"
    "public_metrics,referenced_tweets"
)
MEDIA_FIELDS = "media_key,type,url,preview_image_url,alt_text,public_metrics"

OFFLINE = False


class CreditsDepleted(Exception):
    """X returned 402: the developer account is out of API credits. Stop the whole run."""


# ---------- X API (sequential, rate-limit aware, cached) ----------

session = requests.Session()
session.headers["Authorization"] = f"Bearer {os.environ.get('X_BEARER_TOKEN', '')}"


def user_session():
    """liking_users requires user context (OAuth 1.0a), not the app bearer token."""
    from requests_oauthlib import OAuth1Session
    missing = [k for k in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET") if not os.environ.get(k)]
    if missing:
        sys.exit(f"--liked-post needs OAuth 1.0a user keys in .env; missing: {', '.join(missing)}")
    return OAuth1Session(
        os.environ["X_API_KEY"], os.environ["X_API_SECRET"],
        os.environ["X_ACCESS_TOKEN"], os.environ["X_ACCESS_SECRET"],
    )


def x_get(path, params, sess=None):
    if OFFLINE:
        raise RuntimeError(f"--offline: refusing to call X {path} (not in cache)")
    for attempt in range(8):
        r = (sess or session).get(f"{X_API}{path}", params=params, timeout=60)
        if r.status_code == 402:
            raise CreditsDepleted(r.text[:300])
        if r.status_code == 429:
            reset = int(r.headers.get("x-rate-limit-reset", time.time() + 60))
            wait = min(max(reset - time.time(), 1) + 2, 16 * 60)
            print(f"  rate limited on {path}, sleeping {wait:.0f}s")
            time.sleep(wait)
            continue
        if r.status_code >= 500:
            time.sleep(min(2 ** attempt, 60))
            continue
        if r.status_code != 200:
            raise RuntimeError(f"X {path} -> HTTP {r.status_code}: {r.text[:300]}")
        return r.json()
    raise RuntimeError(f"X {path}: gave up after retries")


def cached(path: Path, fetch):
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def fetch_target(cache: Path, username):
    return cached(cache / "target.json", lambda: x_get(
        f"/users/by/username/{username}", {"user.fields": USER_FIELDS}))["data"]


def fetch_recent_followers(cache: Path, target_id, n):
    """One call: the n most recent followers (X lists newest first)."""
    return cached(cache / f"recent_followers_{n}.json", lambda: x_get(
        f"/users/{target_id}/followers", {"max_results": n, "user.fields": USER_FIELDS},
    )).get("data", [])


def fetch_likers(cache: Path, post_id, n):
    """One call: up to n users who liked the post (X returns at most 100 per post, ever)."""
    return cached(cache / f"likers_{post_id}_{n}.json", lambda: x_get(
        f"/tweets/{post_id}/liking_users", {"max_results": n, "user.fields": USER_FIELDS}, user_session(),
    )).get("data", [])


def fetch_reposters_page(cache: Path, post_id, n, page):
    """Page `page` (0-based) of users who reposted the post. Each page is one call, cached."""
    name = f"reposters_{post_id}_{n}.json" if page == 0 else f"reposters_{post_id}_{n}_p{page}.json"
    params = {"max_results": n, "user.fields": USER_FIELDS}
    if page > 0:
        prev = fetch_reposters_page(cache, post_id, n, page - 1)
        token = prev.get("meta", {}).get("next_token")
        if not token:
            return {}
        params["pagination_token"] = token
    return cached(cache / name, lambda: x_get(f"/tweets/{post_id}/retweeted_by", params))


def fetch_reposters(cache: Path, post_id, n):
    """One call: up to n users who reposted the post (works with the app bearer token)."""
    return fetch_reposters_page(cache, post_id, n, 0).get("data", [])


def audience_ids(brand_id):
    r = stdb.post(f"{STDB}/v1/database/{DB}/sql", timeout=60,
                  data=f"SELECT follower_user_id FROM audience_membership WHERE brand_user_id = '{brand_id}'")
    r.raise_for_status()
    return {row[0] for row in r.json()[0]["rows"]}


def fetch_posts(cache: Path, user_id, n):
    """One call: latest <= n original posts + replies (retweets excluded)."""
    return cached(cache / "posts" / f"{user_id}.json", lambda: [x_get(f"/users/{user_id}/tweets", {
        "max_results": max(5, min(100, n)), "exclude": "retweets",
        "tweet.fields": TWEET_FIELDS, "expansions": "attachments.media_keys", "media.fields": MEDIA_FIELDS,
    })])


# ---------- SpacetimeDB (HTTP reducer API) ----------

def stdb_token():
    text = (Path.home() / ".config/spacetime/cli.toml").read_text()
    return re.search(r'spacetimedb_token\s*=\s*"([^"]+)"', text).group(1)


stdb = requests.Session()
stdb.headers.update({"Authorization": f"Bearer {stdb_token()}", "Content-Type": "application/json"})


def call(reducer, *args):
    for attempt in range(5):
        r = stdb.post(f"{STDB}/v1/database/{DB}/call/{reducer}", data=json.dumps(list(args)), timeout=60)
        if r.status_code == 200:
            return
        if r.status_code < 500 or r.status_code == 530:  # 530 = the reducer itself threw
            raise RuntimeError(f"{reducer} -> HTTP {r.status_code}: {r.text[:300]}")
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{reducer}: gave up after retries")


def opt(v):
    return {"none": []} if v is None or v == "" else {"some": v}


# ---------- X JSON -> reducer args ----------

def user_args(u):
    m = u.get("public_metrics", {})
    return [
        u["id"], u["username"], u["name"], opt(u.get("description")), opt(u.get("location")),
        opt(u.get("created_at")), opt(u.get("url")), opt(u.get("profile_image_url")),
        opt(u.get("protected")), opt(u.get("verified")), opt(u.get("verified_type")),
        opt(m.get("followers_count")), opt(m.get("following_count")), opt(m.get("listed_count")),
        opt(m.get("tweet_count")), opt(m.get("like_count")), opt(m.get("media_count")),
    ]


def post_calls(p, media_by_key):
    """Every reducer call needed to store one post and its X-provided metadata."""
    refs = p.get("referenced_tweets", [])
    types = {r["type"] for r in refs}
    m = p.get("public_metrics", {})
    calls = [("upsert_x_post", [
        p["id"], p["author_id"], p["text"], p["created_at"], opt(p.get("lang")),
        opt(p.get("in_reply_to_user_id")), "replied_to" in types, "quoted" in types,
        opt(m.get("impression_count")), opt(m.get("like_count")), opt(m.get("reply_count")),
        opt(m.get("quote_count")), opt(m.get("retweet_count")), opt(m.get("bookmark_count")),
    ])]
    for r in refs:
        calls.append(("upsert_post_reference", [p["id"], r["id"], r["type"]]))

    none = opt(None)
    ents = p.get("entities", {})
    for kind, key in (("hashtag", "hashtags"), ("cashtag", "cashtags")):
        for e in ents.get(key, []):
            calls.append(("upsert_post_entity", [p["id"], kind, e["tag"], e["start"], e["end"], none, none, none]))
    for e in ents.get("mentions", []):
        calls.append(("upsert_post_entity", [p["id"], "mention", e["username"], e["start"], e["end"],
                                             opt(e.get("id")), none, none]))
    for e in ents.get("urls", []):
        calls.append(("upsert_post_entity", [p["id"], "url", e.get("expanded_url") or e["url"], e["start"],
                                             e["end"], none, opt(e.get("title")), opt(e.get("description"))]))

    for a in p.get("context_annotations", []):
        d, e = a["domain"], a["entity"]
        calls.append(("upsert_context_annotation", [
            p["id"], d["id"], d.get("name", ""), e["id"], e.get("name", ""), opt(e.get("description")),
        ]))

    for key in p.get("attachments", {}).get("media_keys", []):
        md = media_by_key.get(key)
        if md:
            calls.append(("upsert_post_media", [
                p["id"], key, md["type"], opt(md.get("url") or md.get("preview_image_url")),
                opt(md.get("alt_text")), opt(md.get("public_metrics", {}).get("view_count")),
            ]))
    return calls


def run_parallel(calls, workers=16):
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(lambda c: call(c[0], *c[1]), calls))


# ---------- main ----------

def main():
    global OFFLINE
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", default="spacetimedb")
    ap.add_argument("--followers", type=int, default=95, help="most recent N followers (max 1000)")
    ap.add_argument("--posts", type=int, default=25, help="max posts per follower (5-100)")
    ap.add_argument("--liked-post", help="use users who liked this post id (needs OAuth 1.0a user keys)")
    ap.add_argument("--reposted-post", help="use users who reposted this post id")
    ap.add_argument("--new-only", action="store_true",
                    help="reposters: page past people already in the audience until --take new ones are found")
    ap.add_argument("--max-pages", type=int, default=3, help="--new-only: max reposter pages to read ($1 each)")
    ap.add_argument("--take", type=int, help="keep at most this many users after filtering (default: all)")
    ap.add_argument("--min-posts", type=int, default=10, help="skip accounts with fewer lifetime posts")
    ap.add_argument("--min-followers", type=int, default=1, help="skip accounts with fewer followers")
    ap.add_argument("--offline", action="store_true", help="only use cached X data; never call X")
    args = ap.parse_args()
    OFFLINE = args.offline
    take = args.take or args.followers

    worst = args.followers * 0.010 + take * 0.005 * args.posts
    print(f"worst-case X cost for uncached data: ${worst:.2f}")

    cache = ROOT / "data" / "x_raw" / args.username
    if args.liked_post:
        run_id, source = f"{args.username}-liked{args.liked_post}-{args.followers}", f"liked:{args.liked_post}"
    elif args.reposted_post:
        suffix = f"-new{take}" if args.new_only else ""
        run_id = f"{args.username}-reposted{args.reposted_post}-{args.followers}{suffix}"
        source = f"reposted:{args.reposted_post}"
    else:
        run_id, source = f"{args.username}-recent{args.followers}", "follower"

    target = fetch_target(cache, args.username)
    call("start_ingestion_run", run_id, args.username, args.followers)
    call("upsert_x_user", *user_args(target))

    def usable(u):  # filter on profile data we already paid for, before buying their posts
        m = u.get("public_metrics", {})
        return (u["id"] != target["id"] and not u.get("protected") and m.get("tweet_count", 0) >= args.min_posts
                and m.get("followers_count", 0) >= args.min_followers)

    try:
        if args.liked_post:
            followers = fetch_likers(cache, args.liked_post, args.followers)
        elif args.reposted_post and args.new_only:
            done = audience_ids(target["id"])
            followers, page = [], 0
            while page < args.max_pages:
                batch = fetch_reposters_page(cache, args.reposted_post, args.followers, page).get("data", [])
                if not batch:
                    break
                followers += [u for u in batch if u["id"] not in done]
                page += 1
                if sum(map(usable, followers)) >= take:
                    break
            print(f"read {page} reposter page(s); {len(followers)} not yet in the audience")
        elif args.reposted_post:
            followers = fetch_reposters(cache, args.reposted_post, args.followers)
        else:
            followers = fetch_recent_followers(cache, target["id"], args.followers)
    except CreditsDepleted as e:
        call("complete_ingestion_run", run_id, "failed", opt(f"X credits depleted while listing followers: {e}"))
        sys.exit("X API credits depleted while listing followers.")
    public = [u for u in followers if usable(u)][:take]
    skipped = len(followers) - len([u for u in followers if usable(u)])
    print(f"target @{target['username']}: {len(followers)} {source} users, {skipped} filtered out "
          f"(protected / <{args.min_posts} posts / <{args.min_followers} followers), keeping {len(public)}")

    saved = failed = posts_saved = 0

    def checkpoint(last_id):
        call("update_ingestion_run", run_id, opt(target["id"]), args.followers, len(followers),
             saved, skipped, failed, posts_saved, opt(last_id), opt(None))

    for u in public:
        call("upsert_x_user", *user_args(u))
        call("upsert_audience_membership", target["id"], u["id"], run_id, source)

    for i, u in enumerate(public, 1):
        try:
            pages = fetch_posts(cache, u["id"], args.posts)
            media = {m["media_key"]: m for pg in pages for m in pg.get("includes", {}).get("media", [])}
            posts = [p for pg in pages for p in pg.get("data", [])][: args.posts]
            run_parallel([c for p in posts for c in post_calls(p, media)])
            saved += 1
            posts_saved += len(posts)
            print(f"[{i}/{len(public)}] @{u['username']}: {len(posts)} posts")
        except CreditsDepleted:
            checkpoint(u["id"])
            call("complete_ingestion_run", run_id, "partial", opt(f"X credits depleted after {saved} followers"))
            sys.exit(f"X API credits depleted after {saved} followers. Rerun after topping up; cache is reused.")
        except Exception as e:  # keep going; the run is marked partial
            failed += 1
            print(f"[{i}/{len(public)}] @{u['username']} FAILED: {e}")
        if i % 10 == 0:
            checkpoint(u["id"])

    checkpoint(public[-1]["id"] if public else None)
    status = "completed" if failed == 0 else "partial"
    call("complete_ingestion_run", run_id, status, opt(f"{failed} followers failed" if failed else None))
    print(f"done: {status}, {saved} followers, {posts_saved} posts")


if __name__ == "__main__":
    main()
