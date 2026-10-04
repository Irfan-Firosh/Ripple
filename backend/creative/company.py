"""What is actually new at the company: Exa (launches, blog, changelog in the last 90 days), the brand's own best
recent posts, and screenshots of its real website. Cached per brand per day; feeds briefs and campaign videos."""
import json
import logging
import os
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests

from twins.config import load_secret
from twins.stdb import sql_str
from creative.research_activity import traced_search

log = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE = REPO_ROOT / "data" / "research"
SHOTS = REPO_ROOT / "frontend" / "public" / "generated" / "brands"
WINDOW_DAYS = 90
SUMMARY_CHARS = 300


def news_items(results: list[dict], since: str) -> list[dict]:
    items = []
    for r in results:
        published = (r.get("publishedDate") or "")[:10]
        if not r.get("title") or not published or published < since:
            continue
        items.append({"title": r["title"].strip()[:120], "url": r["url"], "date": published,
                      "summary": " ".join((r.get("summary") or r.get("text") or "").split())[:SUMMARY_CHARS]})
    return items


def best_recent_posts(posts: list[dict], n: int = 5) -> list[dict]:
    own = [p for p in posts if not p.get("is_reply") and not (p.get("text") or "").startswith(("RT @", "@"))]
    return sorted(own, key=lambda p: -(p.get("like_count") or 0))[:n]


def _exa(query: str, since: str, n: int = 6, *, session=requests) -> list[dict]:
    r = session.post("https://api.exa.ai/search", timeout=60, headers={"x-api-key": load_secret("EXA_API_KEY")},
                     json={"query": query, "numResults": n, "type": "auto", "startPublishedDate": f"{since}T00:00:00.000Z",
                           "contents": {"summary": {"query": "What is new or launched, with specific features and numbers?"}}})
    r.raise_for_status()
    return r.json().get("results", [])


def homepage(name: str, *, session=requests) -> str | None:
    r = session.post("https://api.exa.ai/search", timeout=60, headers={"x-api-key": load_secret("EXA_API_KEY")},
                     json={"query": f"{name} official website", "numResults": 3, "type": "auto"})
    r.raise_for_status()
    for x in r.json().get("results", []):
        u = urlparse(x["url"])
        if u.scheme == "https" and name.split()[0].lower() in u.netloc.lower():
            return f"https://{u.netloc}/"
    return None


def screenshot(urls: list[str], out_dir: Path) -> list[str]:
    """Real product pages, 1440x900, for the video (never invented screens)."""
    from playwright.sync_api import sync_playwright
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        for i, url in enumerate(urls):
            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
                path = out_dir / f"shot-{i + 1}.png"
                page.screenshot(path=str(path))
                saved.append(str(path))
            except Exception as exc:  # noqa: BLE001 - a page that will not load is skipped, not faked
                log.warning("screenshot of %s failed: %s", url, exc)
        browser.close()
    return saved


def company_context(stdb, brand_handle: str, name: str, *, shots: bool = True) -> dict:
    """{'news': [...], 'best_posts': [...], 'homepage': url, 'screenshots': [paths]} - cached for today."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE / f"{brand_handle}-{date.today().isoformat()}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    since = (date.today() - timedelta(days=WINDOW_DAYS)).isoformat()
    news: list[dict] = []
    for q in (f"{name} launch announcement", f"{name} blog", f"{name} changelog new features"):
        try:
            news += news_items(traced_search(brand_handle, q, lambda: _exa(q, since)), since)
        except requests.RequestException as exc:
            log.warning("Exa search %r failed: %s", q, exc)
    seen, unique = set(), []
    for item in sorted(news, key=lambda i: i["date"], reverse=True):
        if item["url"] not in seen:
            seen.add(item["url"])
            unique.append(item)
    users = stdb.sql(f"SELECT user_id FROM x_user WHERE username = {sql_str(brand_handle)}")
    posts = stdb.sql(f"SELECT * FROM x_post WHERE author_user_id = {sql_str(users[0]['user_id'])}") if users else []
    best = [{"text": p["text"], "likes": p.get("like_count") or 0, "date": (p.get("created_at") or "")[:10]}
            for p in best_recent_posts(posts)]
    home = None
    try:
        home = traced_search(brand_handle, f"{name} official website", lambda: homepage(name))
    except requests.RequestException as exc:
        log.warning("homepage lookup failed: %s", exc)
    pages = [u for u in [home] + [i["url"] for i in unique[:1]] if u]
    shot_paths = screenshot(pages, SHOTS / brand_handle) if shots and pages and not os.environ.get("RIPPLE_NO_SHOTS") else []
    ctx = {"news": unique[:6], "best_posts": best, "homepage": home, "screenshots": shot_paths}
    cache.write_text(json.dumps(ctx, indent=1))
    return ctx
