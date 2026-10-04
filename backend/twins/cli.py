"""Command line for the twin service."""
import argparse
import sys

from .ask import ask_twin
from .config import STDB_DATABASE, STDB_URL, load_api_key, load_stdb_token
from .llm import make_client
from .source import USERNAME_RE
from .stdb import MAX_WORKERS, StdbClient, sql_str
from .lab import run_lab_worker
from .sync import load_twin, run_build, run_worker


def _int_in(low: int, high: int | None = None):
    def parse(text: str) -> int:
        value = int(text)
        if value < low or (high is not None and value > high):
            raise argparse.ArgumentTypeError(f"must be between {low} and {high}" if high else f"must be at least {low}")
        return value
    return parse


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="twins")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build twins for a brand's audience and publish them to SpacetimeDB")
    b.add_argument("--brand", required=True)
    b.add_argument("--min-posts", type=_int_in(0), default=0, help="skip accounts with fewer posts (default: build all)")
    b.add_argument("--workers", type=_int_in(1, MAX_WORKERS), default=4)
    b.add_argument("--limit", type=_int_in(1))
    w = sub.add_parser("worker", help="answer pending twin_question rows")
    w.add_argument("--poll", type=float, default=2.0)
    w.add_argument("--max-loops", type=int)
    lw = sub.add_parser("lab-worker", help="run queued Lab A/B experiments (lab_experiment rows)")
    lw.add_argument("--poll", type=float, default=2.0)
    lw.add_argument("--max-loops", type=int)
    a = sub.add_parser("ask", help="ask a twin directly (prints JSON, writes nothing)")
    a.add_argument("--username", required=True)
    a.add_argument("--draft", required=True)
    a.add_argument("--question", default="")
    return p


def _ask(args, stdb, client) -> int:
    username = args.username.strip().lstrip("@")
    rows = stdb.sql(f"SELECT user_id FROM twin WHERE username = {sql_str(username)}") if USERNAME_RE.match(username) else []
    rows = rows or [r for r in stdb.sql("SELECT user_id, username FROM twin") if r["username"].lower() == username.lower()]
    if not rows:
        print(f"no twin for @{username}", file=sys.stderr)
        return 1
    print(ask_twin(client, load_twin(stdb, rows[0]["user_id"]), args.draft, args.question).model_dump_json(indent=2))
    return 0


def main(argv: list[str] | None = None, *, stdb=None, client=None) -> int:
    args = _parser().parse_args(argv)
    stdb = stdb or StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())
    client = client or make_client(load_api_key())
    if args.cmd == "build":
        s = run_build(stdb, client, args.brand, min_posts=args.min_posts, workers=args.workers, limit=args.limit)
        print(f"{s.run_id}: ready {s.ready}, failed {s.failed}, skipped {s.skipped} ({s.status})")
        return 0 if s.ready else 1
    if args.cmd == "worker":
        run_worker(stdb, client, poll_seconds=args.poll, max_loops=args.max_loops)
        return 0
    if args.cmd == "lab-worker":
        run_lab_worker(stdb, client, poll_seconds=args.poll, max_loops=args.max_loops)
        return 0
    return _ask(args, stdb, client)
