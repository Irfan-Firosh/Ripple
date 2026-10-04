"""Hand-authored demo brand anchors. Only brand-owned references may be added."""
from ripple_agents.audience import find_brand
from twins.stdb import sql_str

from .models import BrandKit

SEEDS = {
    "raycast.com": dict(display_name="Raycast", product_description="A keyboard-first launcher and productivity toolkit for Mac.",
                        value_props=["Find tools from a keyboard-first launcher", "Extend everyday workflows with extensions", "Keep useful commands close at hand"],
                        palette=["#FF6363", "#111111", "#F4F4F5"], visual_style="dark UI, crisp minimal composition, keyboard-first workspace",
                        banned_claims=["fastest", "free forever", "guaranteed"], reference_image_urls=[]),
    "spacetimedb": dict(display_name="SpacetimeDB", product_description="A database platform for building real-time applications with server-side modules.",
                        value_props=["Build real-time applications", "Keep application state in a shared database", "Run application logic in server-side modules"],
                        palette=["#00E0B8", "#111820", "#FFFFFF"], visual_style="clean developer workspace, crisp diagrams, dark background",
                        banned_claims=["fastest", "zero latency", "guaranteed"], reference_image_urls=[]),
}


def load_brand_kit(stdb, brand_user_id):
    rows = stdb.sql(f"SELECT * FROM brand_kit WHERE brand_user_id = {sql_str(brand_user_id)}")
    if not rows:
        raise ValueError("brand kit is missing; run creative seed-brand-kits")
    return BrandKit.model_validate(rows[0])


def seed_brand_kits(stdb, brands=None):
    count = 0
    for handle in brands or SEEDS:
        if handle not in SEEDS:
            raise ValueError(f"no hand-authored kit for {handle}")
        kit = BrandKit(brand_user_id=find_brand(stdb, handle)["user_id"], **SEEDS[handle])
        stdb.call("upsert_brand_kit", kit.brand_user_id, kit.display_name, kit.product_description, kit.value_props,
                  kit.palette, kit.visual_style, kit.banned_claims, kit.reference_image_urls)
        count += 1
    return count
