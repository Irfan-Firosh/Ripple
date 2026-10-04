"""The actual tweet for each draft: Claude expands a concept headline into a post in the brand's own voice, using
only facts from the company's recent news and best posts. Runs on our own worker (draft_copy queue)."""
import json
import logging
import re

from twins.stdb import StdbError, sql_str

log = logging.getLogger(__name__)
MAX_TWEET = 280
MAX_TAGS = 3
WRITER_MODEL = "claude-opus-5-5"

SYSTEM = """You are the brand's social media lead writing ONE post for X. Rules:
- Built on the given concept, and on ONE specific recent fact from the sources (a version, feature, number or launch).
- Sound exactly like the brand's best recent posts: same length, rhythm, emoji habits, line breaks.
- Concrete over clever. No "game-changer", no "revolutionary", no claims that are not in the sources.
- End with 1-3 relevant hashtags on the same last line (the brand or product, plus the topic, e.g. #AIagents).
- Follow the given format exactly. If other_draft_to_differ_from is given, yours must read as a different post:
  different opening words, structure, angle and, when the sources allow, a different fact.
- At most 260 characters. Reply with the post text only."""


# A and B are compared in the Lab, so they must be two genuinely different posts, not two phrasings of one.
STYLES = {
    "A": "FORMAT A, the announcement: open with the concrete news itself (the version, feature or number) in the first "
         "line, then one line on what it changes for the reader. Confident, plain, scannable.",
    "B": "FORMAT B, the story hook: open with the reader's problem, a bold claim or a question (never the product name "
         "first), then reveal how this fixes it with ONE specific fact. Conversational, different rhythm and length.",
}


def clean_tweet(text: str) -> str:
    t = text.strip().strip('"').strip()
    tags = re.search(r"(\s#\w+)+\s*$", t)  # trailing hashtags: keep at most MAX_TAGS
    if tags:
        kept = tags.group(0).split()[:MAX_TAGS]
        t = (t[:tags.start()].rstrip() + " " + " ".join(kept)).strip()
    if len(t) > MAX_TWEET:
        t = t[:MAX_TWEET - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return t


def make_writer(stdb, client):
    from creative.company import company_context

    def write(brand: str, headline: str, *, draft: str = "A", other: str = "") -> str:
        kits = stdb.sql("SELECT * FROM brand_kit")
        users = stdb.sql(f"SELECT user_id FROM x_user WHERE username = {sql_str(brand)}")
        kit = next((k for k in kits if users and k["brand_user_id"] == users[0]["user_id"]), {})
        ctx = company_context(stdb, brand, kit.get("display_name") or brand)
        sources = {"brand": kit.get("display_name") or brand, "concept": headline,
                   "facts": kit.get("value_props", []), "recent_news": ctx.get("news", []),
                   "best_posts": ctx.get("best_posts", []), "format": STYLES.get(draft, STYLES["A"])}
        if other:  # the sibling draft: this one must take a different angle, opening, structure and (if possible) fact
            sources["other_draft_to_differ_from"] = other
        for _ in range(2):  # an empty answer gets one more try
            msg = client.messages.create(model=WRITER_MODEL, max_tokens=1200, system=SYSTEM,
                                         messages=[{"role": "user", "content": json.dumps(sources, indent=1)}])
            text = clean_tweet("".join(b.text for b in msg.content if b.type == "text"))
            if text:
                return text
        return ""
    return write


def run_pending_copy(stdb, *, write) -> int:
    handled = 0
    for row in stdb.sql("SELECT * FROM draft_copy WHERE status = 'queued'"):
        try:
            stdb.call("set_draft_copy", row["copy_id"], "writing", "", "")
        except StdbError:
            continue  # another worker took it
        flows = stdb.sql(f"SELECT brand FROM campaign_flow WHERE campaign_id = {sql_str(row['campaign_id'])}")
        siblings = [c for c in stdb.sql(f"SELECT * FROM draft_copy WHERE campaign_id = {sql_str(row['campaign_id'])}")
                    if c["draft"] != row["draft"] and c.get("status") == "done" and c.get("text")]
        try:
            text = write(flows[0]["brand"] if flows else "", row["headline"], draft=row["draft"],
                         other=siblings[0]["text"] if siblings else "").strip()
            if not text:
                raise ValueError("the writer returned an empty post")
            stdb.call("set_draft_copy", row["copy_id"], "done", text, "")
            log.info("tweet %s written (%d chars)", row["copy_id"], len(text))
        except Exception as exc:  # noqa: BLE001 - the page shows the error and falls back to the headline
            log.warning("draft copy %s failed: %s", row["copy_id"], exc)
            stdb.call("set_draft_copy", row["copy_id"], "failed", "", f"{type(exc).__name__}: {exc}"[:300])
        handled += 1
    return handled
