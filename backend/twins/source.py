"""Read a brand's audience (raw X data written by x-followers-db/ingest) from SpacetimeDB."""
import re
from collections import defaultdict

from .models import Account, XPost, XUser
from .stdb import sql_str

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")


def _brand(users: dict[str, XUser], brand_username: str) -> XUser:
    username = brand_username.strip().lstrip("@")
    if not USERNAME_RE.match(username):
        raise ValueError(f"invalid X username: {brand_username!r}")
    match = next((u for u in users.values() if u.username.lower() == username.lower()), None)
    if match is None:
        raise ValueError(f"@{username} is not in x_user; run the x-followers-db ingest first")
    return match


def load_audience(stdb, brand_username: str) -> tuple[XUser, list[Account]]:
    if not USERNAME_RE.match(brand_username.strip().lstrip("@")):
        raise ValueError(f"invalid X username: {brand_username!r}")
    users = {r["user_id"]: XUser.model_validate(r) for r in stdb.sql("SELECT * FROM x_user")}
    brand = _brand(users, brand_username)
    follower_ids = {r["follower_user_id"] for r in stdb.sql(
        f"SELECT follower_user_id FROM audience_membership WHERE brand_user_id = {sql_str(brand.user_id)}")}
    posts: dict[str, list[XPost]] = defaultdict(list)
    for r in stdb.sql("SELECT * FROM x_post"):
        posts[r["author_user_id"]].append(XPost.model_validate(r))
    mentions: dict[str, list[str]] = defaultdict(list)
    for r in stdb.sql("SELECT post_id, value FROM x_post_entity WHERE entity_type = 'mention'"):
        mentions[r["post_id"]].append(r["value"])
    annotations: dict[str, list[str]] = defaultdict(list)
    for r in stdb.sql("SELECT post_id, entity_name FROM x_context_annotation"):
        annotations[r["post_id"]].append(r["entity_name"])

    accounts = []
    for uid in sorted(follower_ids & users.keys()):
        own = sorted(posts.get(uid, []), key=lambda p: p.created_at, reverse=True)
        ids = {p.post_id for p in own}
        accounts.append(Account(
            user=users[uid], posts=own,
            mentions={pid: v for pid, v in mentions.items() if pid in ids},
            annotations={pid: v for pid, v in annotations.items() if pid in ids}))
    return brand, accounts
