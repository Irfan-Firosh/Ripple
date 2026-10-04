"""Recent, real company context for campaign copy: Exa results + the brand's own best recent posts."""
from creative.company import best_recent_posts, news_items


def test_news_items_keep_recent_titled_results_with_a_short_summary():
    results = [{"title": "Raycast 2.0 is here", "url": "https://raycast.com/blog/v2", "publishedDate": "2026-09-30T00:00:00Z",
                "summary": "Raycast 2.0 brings File Search in root, AI Chat with skills and memory. " * 5},
               {"title": "", "url": "https://x.example", "publishedDate": None, "summary": "untitled"},
               {"title": "Old post", "url": "https://raycast.com/blog/old", "publishedDate": "2025-01-01T00:00:00Z", "summary": "old"}]
    items = news_items(results, since="2026-07-01")
    assert [i["title"] for i in items] == ["Raycast 2.0 is here"]
    assert items[0]["date"] == "2026-09-30" and len(items[0]["summary"]) <= 300


def test_best_recent_posts_are_the_brands_most_liked_originals():
    posts = [{"text": "small", "like_count": 3, "is_reply": False}, {"text": "launch!", "like_count": 1191, "is_reply": False},
             {"text": "@someone thanks", "like_count": 900, "is_reply": True}, {"text": "mid", "like_count": 200, "is_reply": False}]
    assert [p["text"] for p in best_recent_posts(posts, n=2)] == ["launch!", "mid"]
