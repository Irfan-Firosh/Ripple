"""Keep each brand kit current: distil today's research (recent launches, blog, the brand's best posts) into three
concrete value props. Every brief copies kit value props verbatim, so any worker version writes grounded copy.

  uv run python -m creative.kit_refresh --brand raycast --brand linear
"""
import argparse

from pydantic import BaseModel, Field

from twins.config import STDB_DATABASE, STDB_URL, load_api_key, load_stdb_token
from twins.llm import call_tool, make_client
from twins.stdb import StdbClient

from .brand_kits import load_brand_kit
from .company import company_context

MAX_PROP = 90


class Distilled(BaseModel):
    value_props: list[str] = Field(description="3 specific, factual things that are new or true right now, each under 90 characters")
    product_description: str = Field(description="one sentence: what the product is and what just changed, under 300 characters")


def clean_props(props: list[str], banned: list[str], fallback: list[str] | None = None) -> list[str]:
    out, seen = [], set()
    for p in props:
        text = " ".join((p or "").split())
        key = text.lower()
        if not text or len(text) > MAX_PROP or key in seen or any(b.lower() in key for b in banned):
            continue
        seen.add(key)
        out.append(text)
    return out[:3] or list(fallback or [])[:3]


SYSTEM = ("You write the value props for a brand's marketing kit from real, recent sources. Use only facts stated "
          "in the sources (feature names, versions, numbers, launches). No superlatives, no invented claims, no hype. "
          "Prefer the most recent and most engaging items. Answer only by calling the tool.")


def refresh_kit(stdb, client, brand: str) -> dict:
    users = stdb.sql(f"SELECT user_id FROM x_user WHERE username = '{brand}'")
    if not users:
        raise LookupError(f"@{brand} is not in Ripple yet")
    kit = load_brand_kit(stdb, users[0]["user_id"])
    ctx = company_context(stdb, brand, kit.display_name)
    sources = {"brand": kit.display_name, "recent_news": ctx.get("news", []), "best_posts": ctx.get("best_posts", [])}
    out = call_tool(client, system=SYSTEM, user=str(sources), tool_name="kit", description="Updated kit copy",
                    output_model=Distilled, max_tokens=800)
    props = clean_props(out.value_props, kit.banned_claims, fallback=kit.value_props)
    description = " ".join(out.product_description.split())[:300] or kit.product_description
    stdb.call("upsert_brand_kit", kit.brand_user_id, kit.display_name, description, props, kit.palette,
              kit.visual_style, kit.banned_claims, kit.reference_image_urls)
    return {"brand": brand, "value_props": props, "product_description": description}


def main() -> None:
    ap = argparse.ArgumentParser(prog="creative.kit_refresh")
    ap.add_argument("--brand", action="append", required=True)
    args = ap.parse_args()
    stdb = StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())
    client = make_client(load_api_key())
    for brand in args.brand:
        print(refresh_kit(stdb, client, brand.lstrip("@")))


if __name__ == "__main__":
    main()
