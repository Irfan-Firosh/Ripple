"""Export a real completed campaign and its images as an anonymous offline rehearsal."""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from twins.config import load_stdb_token
from twins.stdb import StdbClient, sql_str

ROOT = Path(__file__).resolve().parents[1]


def camel(row):
    return {re.sub(r"_([a-z])", lambda match: match[1].upper(), key): value for key, value in row.items()}


def export(url, database, campaign_id, output):
    stdb = StdbClient(url, database, load_stdb_token())
    rows = stdb.sql(f"SELECT * FROM campaign WHERE campaign_id = {sql_str(campaign_id)}")
    if not rows:
        raise ValueError("Campaign not found")
    campaign = camel(rows[0])
    campaign.pop("createdBy", None)
    campaign.pop("createdAt", None)
    briefs = []
    for row in stdb.sql(f"SELECT * FROM creative_brief WHERE campaign_id = {sql_str(campaign_id)}"):
        brief = camel(row)
        brief.pop("evidenceJson", None)
        brief.pop("createdAt", None)
        for field in ("keyInterests", "avoid"):
            brief[field] = [{"text": theme["text"], "support": theme["support"], "twinIds": [],
                             "evidenceCount": len(set(theme["twin_ids"]))} for theme in row["key_interests" if field == "keyInterests" else "avoid"]]
        briefs.append(brief)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    variants = []
    for row in stdb.sql(f"SELECT * FROM ad_variant WHERE campaign_id = {sql_str(campaign_id)}"):
        if row["status"] != "ready" or not row["image_url"]:
            continue
        variant = camel(row)
        for key in ("createdAt", "updatedAt", "xaiFileId", "jobId"):
            variant.pop(key, None)
        source = row["image_url"]
        if urlparse(source).hostname == "files-cdn.x.ai":
            response = requests.get(source, timeout=60)
            response.raise_for_status()
            image_bytes = response.content
        elif source.startswith("/generated/"):
            filename = source.removeprefix("/generated/")
            if Path(filename).name != filename:
                raise ValueError("Invalid generated asset path")
            image_bytes = (ROOT / "frontend/public/generated" / filename).read_bytes()
        else:
            raise ValueError("Only persistent Grok output can be exported")
        if len(image_bytes) > 20_000_000:
            raise ValueError("Generated image too large")
        filename = row["variant_id"] + (".png" if image_bytes.startswith(b"\x89PNG") else ".jpg")
        if Path(filename).name != filename:
            raise ValueError("Invalid variant ID")
        (output / filename).write_bytes(image_bytes)
        variant["imageUrl"] = f"/rehearsal/{filename}"
        variant["costUsdTicks"] = str(row["cost_usd_ticks"])
        variants.append(variant)
    if not variants:
        raise ValueError("No completed image takes to export")
    kit = camel(stdb.sql(f"SELECT * FROM brand_kit WHERE brand_user_id = {sql_str(rows[0]['brand_user_id'])}")[0])
    kit.pop("updatedAt", None)
    payload = {"recordedAt": datetime.now(timezone.utc).isoformat(), "campaign": campaign,
               "brandKit": kit, "briefs": briefs, "variants": variants}
    (output / "campaign.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Exported {len(variants)} real Grok takes and {len(briefs)} brief versions; persona IDs omitted")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("campaign_id")
    parser.add_argument("--url", default="http://127.0.0.1:3100")
    parser.add_argument("--database", default="ripple-campaign-test")
    parser.add_argument("--output", default=str(ROOT / "frontend/public/rehearsal"))
    args = parser.parse_args()
    export(args.url, args.database, args.campaign_id, args.output)
