"""Download the avatar of every user already in x_user and store it in x_user.profile_image as a data: URL.

Uses only the profile_image_url X already gave us (no X API calls, no credits). Users that already
have a profile_image are skipped unless --force.

  python fetch_profile_images.py
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor

import requests

from ingest_x import DB, STDB, call, stdb

SIZE = "_400x400"  # X serves _normal (48px), _bigger (73px), _200x200, _400x400


def users():
    r = stdb.post(f"{STDB}/v1/database/{DB}/sql", timeout=60,
                  data="SELECT user_id, username, profile_image_url, profile_image FROM x_user")
    r.raise_for_status()
    # option cells come back as [tag, value]; tag 0 = some
    return [(uid, name, url[1] if url[0] == 0 else None, img[0] == 0) for uid, name, url, img in r.json()[0]["rows"]]


def fetch(url):
    big = url.replace("_normal.", f"{SIZE}.")
    for candidate in (big, url) if big != url else (url,):
        r = requests.get(candidate, timeout=30)
        if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image/"):
            return f"data:{r.headers['Content-Type']};base64,{base64.b64encode(r.content).decode()}"
    raise RuntimeError(f"HTTP {r.status_code} for {url}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download users that already have a profile_image")
    args = ap.parse_args()

    todo = [(uid, name, url) for uid, name, url, has in users() if url and (args.force or not has)]
    print(f"{len(todo)} users to fetch")

    def one(u):
        uid, name, url = u
        try:
            call("set_x_user_profile_image", uid, fetch(url))
            return None
        except Exception as e:
            return f"@{name}: {e}"

    with ThreadPoolExecutor(8) as pool:
        errors = [e for e in pool.map(one, todo) if e]
    for e in errors:
        print("FAILED", e)
    print(f"done: {len(todo) - len(errors)} saved, {len(errors)} failed")


if __name__ == "__main__":
    main()
