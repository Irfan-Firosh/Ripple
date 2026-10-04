"""Small demo CLI: python -m creative --help. Image commands are explicit paid actions."""
import argparse
import json
import logging
import sys
import uuid
from dataclasses import asdict

from ripple_agents.audience import find_brand
from twins.config import STDB_DATABASE, STDB_URL, load_stdb_token
from twins.stdb import StdbClient

from .brand_kits import load_brand_kit, seed_brand_kits
from .brief import synthesize_brief
from .grok import GrokClient, GrokError
from .logs import capture_worker_logs
from .models import ASPECT_RATIOS
from .prompts import edit_prompt, safe_image_prompt, validate_tweak_prompt
from .segments import aggregate_segments
from .worker import run_worker


def _parser():
    parser = argparse.ArgumentParser(prog="creative")
    commands = parser.add_subparsers(dest="command", required=True)
    seed = commands.add_parser("seed-brand-kits", help="upsert the hand-authored demo brand kits")
    seed.add_argument("--brand", action="append", choices=["raycast.com", "spacetimedb"])
    worker = commands.add_parser("worker", help="process claimed creative jobs")
    worker.add_argument("--once", action="store_true")
    worker.add_argument("--campaign-id")
    worker.add_argument("--poll", type=float, default=2.0)
    brief = commands.add_parser("brief", help="print a synthesized brief without publishing it")
    brief.add_argument("brand")
    brief.add_argument("segment")
    brief.add_argument("--goal", default="")
    brief.add_argument("--offer")
    for kind in ("generate", "edit"):
        image = commands.add_parser(kind, help=f"{kind} one Grok Imagine image")
        image.add_argument("prompt")
        image.add_argument("--brand", default="raycast.com")
        image.add_argument("--variant-id", default=None)
        image.add_argument("--aspect", choices=sorted(ASPECT_RATIOS), default="1:1")
        if kind == "edit":
            image.add_argument("--source", required=True, help="brand-kit reference URL only")
    return parser


def main(argv=None, *, stdb=None, client=None):
    args = _parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        stdb = stdb or StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())
        if args.command == "seed-brand-kits":
            print(f"seeded {seed_brand_kits(stdb, args.brand)} brand kits")
            return 0
        client = client or GrokClient()
        if args.command == "worker":
            with capture_worker_logs(STDB_DATABASE, STDB_URL):
                stats = run_worker(stdb, client, once=args.once, poll_seconds=args.poll, campaign_id=args.campaign_id)
            print(json.dumps(asdict(stats)))
            return 1 if stats.failed else 0
        brand_id = find_brand(stdb, args.brand)["user_id"]
        kit = load_brand_kit(stdb, brand_id)
        if args.command == "brief":
            segment = aggregate_segments(stdb, brand_id, [args.segment])[0]
            brief = synthesize_brief(client, segment, kit, goal=args.goal, offer=args.offer)
            print(brief.model_dump_json(indent=2))
            return 0
        variant_id = args.variant_id or uuid.uuid4().hex
        if args.command == "generate":
            prompt = safe_image_prompt(validate_tweak_prompt(args.prompt, kit), kit, args.aspect)
            result = client.generate(prompt, variant_id, args.aspect)
        else:
            if args.source not in kit.reference_image_urls:
                raise ValueError("CLI edits may reference only brand-owned URLs listed in the brand kit; use jobs for generated parents")
            result = client.edit(edit_prompt(args.prompt, kit, args.aspect), variant_id, [args.source], args.aspect)
        print(json.dumps(asdict(result)))
        return 0
    except (ValueError, RuntimeError) as exc:
        print(str(exc) if isinstance(exc, (ValueError, GrokError)) else "Creative command failed; check credentials and database connectivity", file=sys.stderr)
        return 1
