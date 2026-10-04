"""Who-can-reach-whom edges per brand: niche hub + ring edges plus real reply/mention links."""
from collections import defaultdict

from .brand_twins import BrandTwin, load_brand_twins


def build_edges(brand_twins: list[BrandTwin], links: list[tuple[str, str]]) -> list[dict]:
    groups: dict[str, list[BrandTwin]] = defaultdict(list)
    for t in brand_twins:
        groups[t.niches[0][0] if t.niches else "other"].append(t)
    edges: dict[tuple[str, str], str] = {}
    # Someone alone in their niche still hears from the audience's most-followed account.
    top = min(brand_twins, key=lambda t: (-t.followers, t.user_id), default=None)
    for members in groups.values():
        if len(members) == 1 and top is not None and members[0].user_id != top.user_id:
            edges[(top.user_id, members[0].user_id)] = "niche_hub"
            continue
        ordered = sorted(members, key=lambda t: (-t.followers, t.user_id))
        hub = ordered[0]
        for t in ordered[1:]:
            edges[(hub.user_id, t.user_id)] = "niche_hub"
        for prev, cur in zip(ordered[1:], ordered[2:]):
            edges[(prev.user_id, cur.user_id)] = "niche_ring"
    ids = {t.user_id for t in brand_twins}
    for a, b in links:
        if a in ids and b in ids and a != b and (a, b) not in edges and (b, a) not in edges:
            edges[(a, b)] = "reply"
    return [{"a": a, "b": b, "kind": kind} for (a, b), kind in edges.items()]


def audience_links(stdb, user_ids: set[str]) -> list[tuple[str, str]]:
    author = {}
    links = []
    for p in stdb.sql("SELECT post_id, author_user_id, in_reply_to_user_id FROM x_post"):
        author[p["post_id"]] = p["author_user_id"]
        if p["author_user_id"] in user_ids and p["in_reply_to_user_id"] in user_ids:
            links.append((p["author_user_id"], p["in_reply_to_user_id"]))
    for m in stdb.sql("SELECT post_id, mentioned_user_id FROM x_post_entity WHERE entity_type = 'mention'"):
        a = author.get(m["post_id"])
        if a in user_ids and m["mentioned_user_id"] in user_ids:
            links.append((a, m["mentioned_user_id"]))
    return links


def publish_edges(stdb, brand_username: str) -> int:
    brand, twins = load_brand_twins(stdb, brand_username)
    edges = build_edges(twins, audience_links(stdb, {t.user_id for t in twins}))
    stdb.call("replace_audience_edges", brand.user_id, edges)
    return len(edges)
