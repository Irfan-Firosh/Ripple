"""uv run python -m video make --company Raycast --news "Raycast v2 is out of beta" [--goal ...] [--resume <id>]
uv run python -m video worker        # make videos the browser queued with request_campaign_video

Every video is mirrored live into SpacetimeDB's campaign_video row (stage, progress, then URLs and script)."""
import argparse
import json
import time

from twins.config import STDB_DATABASE, STDB_URL, load_stdb_token
from twins.stdb import StdbClient

from .pipeline import _slug, make_video
from .sync import make_tracked, run_video_worker


def main() -> None:
    ap = argparse.ArgumentParser(prog="video")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make", help="make one 16:9 campaign video (<= 20 s) with a thumbnail")
    m.add_argument("--company", required=True)
    m.add_argument("--news", required=True)
    m.add_argument("--goal", default="")
    m.add_argument("--audience", default="")
    m.add_argument("--campaign", default="", help="campaign id to link the video to")
    m.add_argument("--resume", help="video id to continue (reuses its research, brief and voiceover)")
    w = sub.add_parser("worker", help="make queued campaign_video rows")
    w.add_argument("--poll", type=float, default=3.0)
    cw = sub.add_parser("copy-worker", help="write queued draft tweets only (no videos)")
    cw.add_argument("--poll", type=float, default=2.0)
    args = ap.parse_args()
    stdb = StdbClient(STDB_URL, STDB_DATABASE, token=load_stdb_token())
    if args.cmd == "copy-worker":
        from twins.logsetup import setup_worker_logging
        setup_worker_logging()
        from .copywriter import make_writer
        from .pipeline import opus_client
        from .sync import run_copy_worker
        run_copy_worker(stdb, writer=make_writer(stdb, opus_client()), poll_seconds=args.poll)
        return
    if args.cmd == "worker":
        from twins.logsetup import setup_worker_logging
        setup_worker_logging()
        from .copywriter import make_writer
        from .pipeline import opus_client
        run_video_worker(stdb, maker=make_video, poll_seconds=args.poll, writer=make_writer(stdb, opus_client()))
        return
    video_id = args.resume or f"{_slug(args.company)}-{int(time.time())}"
    meta = make_tracked(stdb, make_video, args.company, args.news, args.goal, args.audience, video_id=video_id,
                        campaign_id=args.campaign)
    print(json.dumps({k: meta.get(k) for k in ("video_id", "video", "thumbnail", "duration")}, indent=1))


if __name__ == "__main__":
    main()
