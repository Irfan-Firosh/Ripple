"""SPIKE (throwaway): load fetched X posts into SpacetimeDB via the HTTP reducer API.

Proves the Python -> SpacetimeDB path (there is no maintained Python SDK for 2.x).
Usage: python3 load_to_spacetime.py <posts.json> [server_url] [database]
"""
import json
import re
import sys
import tomllib
import urllib.request
from pathlib import Path

posts_file = Path(sys.argv[1])
SERVER = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
DB = sys.argv[3] if len(sys.argv) > 3 else "ripple-spike"
TOKEN = tomllib.loads((Path.home() / ".config/spacetime/cli.toml").read_text()).get("spacetimedb_token")


def opt(value):
    """SATS-JSON encoding for option<T>."""
    return {"none": []} if value is None else {"some": value}


def call(reducer: str, args: list) -> int:
    req = urllib.request.Request(
        f"{SERVER}/v1/database/{DB}/call/{reducer}",
        data=json.dumps(args).encode(),
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {})},
        method="POST",
    )
    try:
        return urllib.request.urlopen(req, timeout=30).status
    except urllib.error.HTTPError as e:
        print(f"  {reducer} -> HTTP {e.code}: {e.read()[:200]!r}")
        return e.code


data = json.loads(posts_file.read_text())
ok = 0
for p in data["posts"]:
    url = p["post_url"]
    post_id = re.search(r"status/(\d+)", url).group(1)
    as_int = lambda v: None if v is None else int(v)
    args = [
        post_id, url, p["author_handle"], p["text"], opt(p.get("created_at")),
        opt(as_int(p.get("likes"))), opt(as_int(p.get("reposts"))), opt(as_int(p.get("replies"))),
        opt(as_int(p.get("quotes"))), opt(as_int(p.get("views"))), opt(p.get("is_reply_or_quote_of")),
        data["topic"],
    ]
    status = call("upsert_post", args)
    if status == 404:
        status = call("upsertPost", args)
    ok += status == 200
print(f"inserted/updated {ok}/{len(data['posts'])}")
