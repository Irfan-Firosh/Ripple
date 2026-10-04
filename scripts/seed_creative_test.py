"""Copy a locally cached Raycast audience into an isolated test database.

Run from backend with its Python environment. Never writes to the live database.
The cache is obtained with read-only queries and is intentionally kept outside git.
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from twins.config import load_stdb_token
from twins.stdb import StdbClient, opt, sql_str


def seed(url, database, cache):
    if not url.startswith(("http://127.0.0.1:", "http://localhost:")):
        raise ValueError("test seeding requires a local SpacetimeDB URL")
    data = json.loads(Path(cache).read_text())
    stdb = StdbClient(url, database, load_stdb_token())
    for niche in data["niche"]:
        stdb.call("upsert_niche", niche["slug"], niche["label"], niche["description"])
    fields = ["user_id", "username", "name", "description", "location", "created_at", "url", "profile_image_url",
              "protected", "verified", "verified_type", "followers_count", "following_count", "listed_count",
              "post_count", "like_count", "media_count"]
    for user in data["x_user"]:
        stdb.call("upsert_x_user", *[user.get(key) if index < 3 else opt(user.get(key)) for index, key in enumerate(fields)])
    brand = data["x_user"][0]["user_id"]
    run_id = "creative-integration-audience"
    rows = data["twin"]
    stdb.call("start_twin_build_run", run_id, brand, len(rows))
    fields = ["user_id", "username", "brand_user_id", "post_count", "reply_share", "quote_share", "mention_rate",
              "avg_likes", "avg_impressions", "engagement_rate", "active_hours_utc", "topics", "tone", "persona_summary",
              "hot_buttons", "ignores", "format_prefs", "evidence_post_ids", "model"]
    def publish(row):
        if stdb.sql(f"SELECT user_id FROM twin WHERE user_id = {sql_str(row['user_id'])}"):
            return
        stdb.call("publish_twin", run_id, *[row[key] for key in fields])
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(publish, rows))
    run = stdb.sql(f"SELECT status FROM twin_build_run WHERE run_id = {sql_str(run_id)}")[0]
    if run["status"] == "running":
        stdb.call("complete_twin_build_run", run_id, "completed")
    print(f"Seeded {len(rows)} audience personas into {database} at {url}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:3100")
    parser.add_argument("--database", default="ripple-campaign-test")
    parser.add_argument("--cache", default="/private/tmp/ripple-campaign-audience.json")
    args = parser.parse_args()
    seed(args.url, args.database, args.cache)
