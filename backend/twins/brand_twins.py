"""Load every twin in a brand's audience in a few bulk SQL reads (fast enough for 1,000 people)."""
from collections import defaultdict

from pydantic import BaseModel

from .models import XUser
from .source import USERNAME_RE

# Explicit columns: x_user.profile_image holds whole data: URLs, which we never need here.
X_USER_COLS = ("user_id, username, name, description, location, followers_count, following_count, verified, "
               "profile_image_url")


class BrandTwin(BaseModel):
    user_id: str
    username: str
    name: str
    avatar: str
    followers: int
    post_count: int
    tone: str
    persona_summary: str
    hot_buttons: list[str]
    ignores: list[str]
    niches: list[tuple[str, float]]


def load_brand_twins(stdb, brand_username: str) -> tuple[XUser, list[BrandTwin]]:
    handle = brand_username.strip().lstrip("@")
    if not USERNAME_RE.match(handle):
        raise ValueError(f"invalid handle: {brand_username!r}")
    users = {u["user_id"]: u for u in stdb.sql(f"SELECT {X_USER_COLS} FROM x_user")}
    brand_row = next((u for u in users.values() if u["username"].lower() == handle.lower()), None)
    if brand_row is None:
        raise ValueError(f"@{handle} is not in x_user")
    members = {r["user_id"] for r in stdb.sql("SELECT brand_user_id, user_id FROM twin_audience")
               if r["brand_user_id"] == brand_row["user_id"]}
    if not members:
        raise ValueError(f"No twins built for @{handle} yet: python -m twins build --brand {handle}")
    niches: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for r in stdb.sql("SELECT user_id, niche, affinity FROM twin_niche"):
        if r["user_id"] in members:
            niches[r["user_id"]].append((r["niche"], r["affinity"]))
    twins = []
    for t in stdb.sql("SELECT * FROM twin"):
        if t["user_id"] not in members:
            continue
        u = users.get(t["user_id"], {})
        twins.append(BrandTwin(
            user_id=t["user_id"], username=t["username"], name=u.get("name") or t["username"],
            avatar=u.get("profile_image_url") or "", followers=u.get("followers_count") or 0,
            post_count=t["post_count"], tone=t["tone"], persona_summary=t["persona_summary"],
            hot_buttons=t["hot_buttons"], ignores=t["ignores"],
            niches=sorted(niches[t["user_id"]], key=lambda n: -n[1])))
    twins.sort(key=lambda t: t.user_id)
    return XUser.model_validate(brand_row), twins
