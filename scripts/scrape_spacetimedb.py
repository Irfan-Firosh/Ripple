"""
Scrape up to 100 recent posts from https://x.com/spacetimedb via the OFFICIAL X API v2.

This does NOT use your xAI key — X API needs its own Bearer Token.
Get one free at https://developer.x.com → create Project+App → Keys and Tokens → Bearer Token
Then put it in .env as X_BEARER_TOKEN=...

Usage:
    pip3 install -r scripts/requirements-x.txt
    python3 scripts/scrape_spacetimedb.py            # 100 tweets, saves JSON
    python3 scripts/scrape_spacetimedb.py --max 50 --out data/spacetimedb.json
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

USERNAME = "spacetimedb"


def get_bearer() -> str:
    token = os.getenv("X_BEARER_TOKEN", "").strip()
    if not token:
        print(
            "Missing X_BEARER_TOKEN in .env.\n"
            "Your xAI key (xai-...) does NOT work for X API.\n\n"
            "To get one (2 min):\n"
            "  1. Go to https://developer.x.com → Sign up / Log in\n"
            "  2. Create a Project + App (Free tier is enough for ~100 reads)\n"
            "  3. Keys and Tokens → generate Bearer Token\n"
            "  4. Add to .env: X_BEARER_TOKEN=AAAA...\n"
        )
        sys.exit(1)
    return token


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=100, help="max tweets to fetch (default 100)")
    ap.add_argument("--out", default="data/spacetimedb_tweets.json", help="output JSON path")
    args = ap.parse_args()

    try:
        import tweepy
    except ImportError:
        print("tweepy not installed. Run: pip3 install -r scripts/requirements-x.txt")
        sys.exit(1)

    bearer = get_bearer()
    client = tweepy.Client(bearer_token=bearer, wait_on_rate_limit=True)

    # Resolve @spacetimedb -> user id
    user = client.get_user(username=USERNAME)
    if not user.data:
        print(f"Could not resolve user @{USERNAME}. Check token permissions.")
        sys.exit(1)
    user_id = user.data.id
    print(f"@{USERNAME} -> user_id={user_id}")

    tweets: list[dict] = []
    pagination_token = None
    remaining = args.max

    while remaining > 0:
        page_size = min(100, remaining)  # API max per request
        resp = client.get_users_tweets(
            id=user_id,
            max_results=page_size,
            pagination_token=pagination_token,
            tweet_fields=["created_at", "public_metrics", "text", "lang"],
            exclude=["retweets", "replies"],
        )
        if not resp.data:
            print("No more tweets returned.")
            break
        for t in resp.data:
            m = t.public_metrics or {}
            tweets.append(
                {
                    "id": str(t.id),
                    "url": f"https://x.com/{USERNAME}/status/{t.id}",
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                    "text": t.text,
                    "lang": getattr(t, "lang", None),
                    "like_count": m.get("like_count"),
                    "retweet_count": m.get("retweet_count"),
                    "reply_count": m.get("reply_count"),
                    "impression_count": m.get("impression_count"),
                }
            )
        remaining -= len(resp.data)
        pagination_token = (resp.meta or {}).get("next_token")
        print(f"Fetched {len(tweets)}/{args.max}...")
        if not pagination_token:
            break

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = Path(__file__).resolve().parent.parent / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "username": USERNAME,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "count": len(tweets),
        "tweets": tweets,
    }
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"\nSaved {len(tweets)} tweets -> {out_path}")
    # Print first 3 as preview
    for tw in tweets[:3]:
        print("-" * 60)
        print(f"{tw['created_at']} | {tw['url']}")
        print(tw["text"][:280])


if __name__ == "__main__":
    main()
