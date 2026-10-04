"""X -> SpacetimeDB import of a brand's followers via Scweet (X's web GraphQL, authenticated with the
X_AUTH_TOKEN session cookie in .env). No paid API calls. Writes the same rows as ingest_x.py, and keeps
x_ingestion_run counters live so the onboarding screen can show progress while it runs.

  python ingest_scweet.py --username raycast --followers 300 --posts 20
  python ingest_scweet.py --username raycast --followers 300 --offline   # reload cache only
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Callable

import ingest_x
from ingest_x import ROOT, call, opt, post_calls, run_parallel, user_args
from scweet_map import post_v2, user_v2

CHECKPOINT_EVERY = 10
RATE_WAIT = 15 * 60  # X's timeline window


class RateLimited(Exception):
    """Scweet hides X's HTTP 429 as an empty result; accounts we keep always have >= min_posts posts."""


def scweet_client():
    from Scweet import Scweet

    import hashlib
    import tempfile

    from scweet_accounts import auth_accounts, working_accounts

    accounts = auth_accounts(os.environ)  # X_AUTH_TOKEN, X_AUTH_TOKEN_2, ...: Scweet rotates on rate limits
    if not accounts:
        raise RuntimeError("Missing X_AUTH_TOKEN in .env (the auth_token cookie from a logged-in x.com session).")

    def probe(account: dict) -> bool:  # one profile read on a throwaway state file
        with tempfile.TemporaryDirectory() as d:
            return bool(Scweet(cookies=[account], db_path=f"{d}/probe.db").get_user_info(["x"]))

    kept, dropped = working_accounts(accounts, probe)
    if dropped:
        print(f"X rejected {', '.join(dropped)} (refresh that auth_token cookie); using {len(kept)} account(s)")
    if not kept:
        raise RuntimeError("X rejected every X_AUTH_TOKEN; copy a fresh auth_token cookie from a logged-in browser")
    # Scweet persists accounts in its state file: one file per working set, so a dead session never comes back.
    digest = hashlib.sha256("".join(a["cookies"]["auth_token"] for a in kept).encode()).hexdigest()[:12]
    state = ROOT / "data" / "scweet_state" / f"pool-{digest}.db"
    state.parent.mkdir(parents=True, exist_ok=True)
    return Scweet(cookies=kept, db_path=str(state))


def cached(path: Path, offline: bool, fetch: Callable[[], list]) -> list:
    if path.exists():
        return json.loads(path.read_text())
    if offline:
        raise FileNotFoundError(f"offline and not cached: {path}")
    data = fetch()
    if not data:  # never cache an empty answer: with Scweet it usually means X rate-limited us
        return data
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, default=str))
    return data


def strip_raw(rows: list[dict]) -> list[dict]:
    """Keep only the GraphQL `legacy` block the mapper reads, so the cache stays small."""
    return [{**r, "raw": {"legacy": ((r.get("raw") or {}).get("legacy")) or {}}} for r in rows]


def usable(u: dict, target_id: str, min_posts: int) -> bool:
    return (u["id"] != target_id and not u.get("protected")
            and (u["public_metrics"].get("tweet_count") or 0) >= min_posts)


def fetch_timeline(s, path: Path, u: dict, posts: int, offline: bool, wait_seconds: float | None) -> list:
    """Cached timeline, else Scweet; an empty answer is X's 429. With wait_seconds, sleep and retry."""
    while True:
        rows = cached(path, offline, lambda: strip_raw(s.get_profile_tweets([u["username"]], limit=posts)))
        if rows:
            return rows
        if wait_seconds is None:
            raise RateLimited(f"X rate-limited timelines at @{u['username']}")
        print(f"rate-limited at @{u['username']}; waiting {wait_seconds:.0f}s")
        time.sleep(wait_seconds)


def ingest(username: str, followers: int, posts: int, min_posts: int = 10, offline: bool = False,
           run_id: str | None = None, max_new_timelines: int | None = None,
           wait_seconds: float | None = None) -> dict:
    """Scrape `followers` followers of @username plus their latest `posts` posts into SpacetimeDB.

    Hybrid mode: every profile is stored at once (fast); `max_new_timelines` caps how many uncached
    timelines this call pulls, and `wait_seconds` makes it sit out X's rate limit instead of stopping.
    """
    username = username.lstrip("@").strip()
    run_id = run_id or f"scweet-{username}-{followers}"
    # A new ingestion run must read X again. Backfill of the same run may reuse its own cache.
    cache = ROOT / "data" / "scweet_raw" / username / re.sub(r'[^A-Za-z0-9_-]', '_', run_id)
    s = None if offline else scweet_client()

    call("start_ingestion_run", run_id, username, followers)
    try:
        info = cached(cache / "target.json", offline, lambda: s.get_user_info([username]))
        if not info:
            raise RuntimeError(f"@{username} not found on X")
        target = user_v2(info[0])
        call("upsert_x_user", *user_args(target))
        raw = cached(cache / f"followers_{followers}.json", offline,
                     lambda: s.get_followers([username], limit=followers))
    except Exception as e:
        call("complete_ingestion_run", run_id, "failed", opt(f"{type(e).__name__}: {str(e)[:200]}"))
        raise

    people = [user_v2(u) for u in raw]
    public = [u for u in people if usable(u, target["id"], min_posts)]
    skipped = len(people) - len(public)
    saved = failed = posts_saved = 0

    def checkpoint(last_id: str | None) -> None:
        call("update_ingestion_run", run_id, opt(target["id"]), followers, len(people),
             saved, skipped, failed, posts_saved, opt(last_id), opt(None))

    for u in public:
        call("upsert_x_user", *user_args(u))
        call("upsert_audience_membership", target["id"], u["id"], run_id, "follower")
    checkpoint(None)
    print(f"@{username}: {len(people)} followers, {skipped} skipped (protected / <{min_posts} posts), "
          f"keeping {len(public)}")

    fetched = 0  # uncached timelines pulled this run (the live phase caps these)
    pending: list[dict] = []
    for i, u in enumerate(public, 1):
        path = cache / "posts" / f"{u['id']}.json"
        if max_new_timelines is not None and not path.exists() and fetched >= max_new_timelines:
            pending.append(u)
            continue
        was_cached = path.exists()
        try:
            rows = fetch_timeline(s, path, u, posts, offline, wait_seconds)
            fetched += 0 if was_cached else 1
            mapped = [post_v2(t, author_id=u["id"]) for t in rows if not t.get("is_retweet")]
            mine = [(p, m) for p, m in mapped if p["author_id"] == u["id"]][:posts]
            run_parallel([c for p, m in mine for c in post_calls(p, m)])
            saved += 1
            posts_saved += len(mine)
            print(f"[{i}/{len(public)}] @{u['username']}: {len(mine)} posts")
        except RateLimited as e:
            print(f"stopping: {e}; rerun later and the cache skips everyone already fetched")
            pending += public[i - 1:]
            break
        except Exception as e:  # keep going; the run ends partial
            failed += 1
            print(f"[{i}/{len(public)}] @{u['username']} FAILED: {type(e).__name__}: {str(e)[:160]}")
        if i % CHECKPOINT_EVERY == 0:
            checkpoint(u["id"])

    checkpoint(public[-1]["id"] if public else None)
    status = "completed" if not failed and not pending else "partial"
    note = ", ".join(x for x in (f"{failed} failed" if failed else "",
                                 f"{len(pending)} timelines pending" if pending else "") if x)
    call("complete_ingestion_run", run_id, status, opt(note or None))
    summary = {"run_id": run_id, "brand_user_id": target["id"], "status": status,
               "followers": len(public), "with_posts": saved, "posts": posts_saved,
               "failed": failed, "pending": len(pending)}
    print(f"done: {summary}")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True, help="brand's X handle, e.g. raycast")
    ap.add_argument("--followers", type=int, default=300, help="most recent N followers")
    ap.add_argument("--posts", type=int, default=20, help="latest posts per follower")
    ap.add_argument("--min-posts", type=int, default=10, help="skip accounts with fewer lifetime posts")
    ap.add_argument("--offline", action="store_true", help="only use cached Scweet data")
    ap.add_argument("--live-timelines", type=int, help="pull at most N new timelines, then stop (live phase)")
    ap.add_argument("--wait", action="store_true", help="sit out rate limits (15 min) instead of stopping")
    args = ap.parse_args()
    ingest_x.OFFLINE = args.offline
    ingest(args.username, args.followers, args.posts, args.min_posts, args.offline,
           max_new_timelines=args.live_timelines, wait_seconds=RATE_WAIT if args.wait else None)


if __name__ == "__main__":
    main()
