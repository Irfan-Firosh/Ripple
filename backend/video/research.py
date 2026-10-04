"""Exa finds what is true about the company; only these sources may back an on-screen claim."""
import requests

from .config import exa_key
from creative.research_activity import traced_search

MAX_CHARS = 1500


def research(company: str, news: str, *, session=requests, results: int = 6) -> list[dict]:
    query = f"{company} {news}".strip()
    return traced_search(company, query, lambda: _search(query, session=session, results=results))


def _search(query: str, *, session, results: int) -> list[dict]:
    r = session.post("https://api.exa.ai/search", timeout=60, headers={"x-api-key": exa_key()},
                     json={"query": query, "numResults": results, "type": "auto",
                           "contents": {"text": {"maxCharacters": MAX_CHARS}}})
    r.raise_for_status()
    return [{"title": x.get("title") or "", "url": x["url"], "published": x.get("publishedDate") or "",
             "text": (x.get("text") or "")[:MAX_CHARS]} for x in r.json().get("results", []) if x.get("url")]
