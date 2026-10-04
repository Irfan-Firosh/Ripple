from twins.brand_twins import BrandTwin
from twins.graph import build_edges


def bt(uid, niche, followers):
    return BrandTwin(user_id=uid, username=uid, name=uid, avatar="", followers=followers, post_count=1, tone="t",
                     persona_summary="s", hot_buttons=[], ignores=[], niches=[(niche, 0.9)] if niche else [])


def test_hub_ring_and_real_links():
    twins = [bt("a", "game_dev", 10), bt("b", "game_dev", 99), bt("c", "game_dev", 5), bt("d", "ai_llms", 1), bt("e", None, 0)]
    edges = build_edges(twins, links=[("a", "d"), ("d", "a"), ("a", "zzz")])
    kinds = {(e["a"], e["b"]): e["kind"] for e in edges}
    assert kinds[("b", "a")] == "niche_hub" and kinds[("b", "c")] == "niche_hub"   # b has most followers
    assert kinds[("a", "c")] == "niche_ring"                                         # ring by followers: b, a, c
    assert kinds[("a", "d")] == "reply"                                              # real link, deduplicated
    assert ("a", "zzz") not in kinds and ("d", "a") not in kinds
    assert all(e["a"] != e["b"] for e in edges)
    assert any("e" in (e["a"], e["b"]) for e in edges)                               # niche-less → "other" group
