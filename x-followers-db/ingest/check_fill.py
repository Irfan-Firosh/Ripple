"""Checks that every column of every raw X table has at least one real value.

  python check_fill.py            # prints per-column fill counts, exits 1 if any column is never filled
"""
import json
import os
import re
import sys
from pathlib import Path

import requests

STDB = os.environ.get("STDB_URL", "https://maincloud.spacetimedb.com")
DB = os.environ.get("STDB_DATABASE", "ripple-mhacks")
TABLES = [
    "x_user", "audience_membership", "x_post", "x_post_reference", "x_post_entity",
    "x_context_annotation", "x_post_media", "x_ingestion_run",
]

token = re.search(r'spacetimedb_token\s*=\s*"([^"]+)"',
                  (Path.home() / ".config/spacetime/cli.toml").read_text()).group(1)


def sql(query):
    r = requests.post(f"{STDB}/v1/database/{DB}/sql", data=query,
                      headers={"Authorization": f"Bearer {token}"}, timeout=120)
    r.raise_for_status()
    return r.json()[0]


def is_option(col_type):
    variants = col_type.get("Sum", {}).get("variants", [])
    return [v["name"].get("some") for v in variants] == ["some", "none"]


def is_none(value):
    return value == [1, []] or value == {"none": []}


def main():
    empty = []
    for table in TABLES:
        res = sql(f"SELECT * FROM {table}")
        cols = res["schema"]["elements"]
        rows = res["rows"]
        print(f"\n{table}: {len(rows)} rows")
        for i, c in enumerate(cols):
            name = c["name"]["some"]
            filled = sum(1 for r in rows if not (is_option(c["algebraic_type"]) and is_none(r[i])))
            flag = "" if filled else "   <-- never filled"
            print(f"  {name:28} {filled:>7}/{len(rows)}{flag}")
            if not filled:
                empty.append(f"{table}.{name}")

    members = {r[2] for r in sql("SELECT * FROM audience_membership")["rows"]}
    authors = {r[1] for r in sql("SELECT * FROM x_post")["rows"]}
    print(f"\nfollowers in audience: {len(members)}, with at least one post: {len(members & authors)}")

    if empty:
        print("\nNEVER FILLED:", ", ".join(empty))
        return 1
    print("\nall columns have data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
