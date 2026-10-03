"""SPIKE (throwaway): can the xAI key pull structured X posts via Grok x_search?

Reads X_API_KEY (an xAI key) from the repo-root .env; never prints it.
Writes raw + parsed output to the path given as argv[2].
"""
import json
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEY = next(l.split("=", 1)[1].strip() for l in open(ROOT / ".env") if l.startswith("X_API_KEY="))
TOPIC = sys.argv[1] if len(sys.argv) > 1 else "AI agents for small business"
OUT = Path(sys.argv[2])

PROMPT = f"""Use X search to find 15 recent, high-engagement X posts about: {TOPIC}.
Return ONLY a JSON array, no prose. Each item:
{{"post_url": str, "author_handle": str, "text": str, "created_at": ISO8601 or null,
  "likes": int or null, "reposts": int or null, "replies": int or null, "quotes": int or null,
  "views": int or null, "is_reply_or_quote_of": post_url or null}}
Use null when a value is not visible. Do not invent numbers."""

body = {
    "model": "grok-4.3",
    "input": [{"role": "user", "content": PROMPT}],
    "tools": [{"type": "x_search", "from_date": str(date.today() - timedelta(days=7)), "to_date": str(date.today())}],
}
req = urllib.request.Request(
    "https://api.x.ai/v1/responses",
    data=json.dumps(body).encode(),
    headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
)
try:
    resp = json.load(urllib.request.urlopen(req, timeout=240))
except urllib.error.HTTPError as e:
    sys.exit(f"HTTP {e.code}: {e.read()[:500]!r}")

text = "".join(
    c.get("text", "")
    for item in resp.get("output", []) if item.get("type") == "message"
    for c in item.get("content", []) if c.get("type") == "output_text"
)
start, end = text.find("["), text.rfind("]")
posts = json.loads(text[start:end + 1]) if start != -1 else []
OUT.write_text(json.dumps({"topic": TOPIC, "usage": resp.get("usage"), "posts": posts, "raw_text": text}, indent=2))
print(f"posts={len(posts)} usage={json.dumps(resp.get('usage'))[:300]}")
