"""uv run python -m twins.anchor --brand raycast   (scrape the brand's own posts, then anchor its simulation)"""
import argparse
import sys
from pathlib import Path

from .baseline import calibrate
from .config import STDB_DATABASE, STDB_URL, load_api_key, load_stdb_token
from .llm import make_client
from .simulate import run_simulation
from .stdb import StdbClient

INGEST_DIR = Path(__file__).resolve().parents[2] / "x-followers-db" / "ingest"


def scrape_brand_posts(brand: str, limit: int = 40) -> int:
    if str(INGEST_DIR) not in sys.path:
        sys.path.insert(0, str(INGEST_DIR))
    from ingest_scweet import ingest_brand_posts  # noqa: PLC0415 - lives beside the SpacetimeDB module
    return ingest_brand_posts(brand, limit)


def anchor_brand(stdb, client, brand: str, *, scrape: bool = True) -> dict:
    if scrape:
        print(f"@{brand}: {scrape_brand_posts(brand)} own posts scraped", flush=True)
    return calibrate(stdb, client, brand, simulate=lambda b, text: run_simulation(stdb, client, b, text, trials=200))


def main() -> None:
    ap = argparse.ArgumentParser(prog="twins.anchor")
    ap.add_argument("--brand", required=True, action="append")
    ap.add_argument("--no-scrape", action="store_true")
    args = ap.parse_args()
    stdb = StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())
    client = make_client(load_api_key())
    for brand in args.brand:
        out = anchor_brand(stdb, client, brand.lstrip("@"), scrape=not args.no_scrape)
        m = out["medians"]
        print(f"@{brand}: real medians likes={m.likes:.0f} reposts={m.reposts:.0f} replies={m.replies:.0f} "
              f"quotes={m.quotes:.0f} views={m.views:.0f} from {m.posts} posts; scales={out['scales']}")


if __name__ == "__main__":
    main()
