"""Brands Ripple doesn't know yet: kick off onboarding (scrape their X followers, build twins) from the chat."""
import re

from twins.stdb import StdbError, sql_str

from .config import APP_URL

X_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")


def needs_onboarding(error: str) -> bool:
    return any(part in error for part in ("has no personas yet", "has not been ingested", "is not in x_user", "No twins built"))


def onboarding_state(stdb, brand: str, *, start=False, retry=False, refresh=False) -> dict:
    handle = brand.strip().lstrip("@").lower()
    if not X_HANDLE.fullmatch(handle):
        return {"handle": handle, "status": "failed", "error": "Use an X handle with 1–15 letters, numbers or underscores."}
    rows = stdb.sql(f"SELECT * FROM onboarding WHERE handle = {sql_str(handle)}")
    row = max(rows, key=lambda r: int(r["onboarding_id"])) if rows else None
    if row and row["status"] not in {"ready", "failed"}:
        return row
    if row and not refresh and (not retry or row["status"] != "failed"):
        return row
    if not start and not retry and not refresh:
        return row or {"handle": handle, "status": "failed", "error": "No build has been requested yet."}
    try:
        if retry and row:
            stdb.call("retry_onboarding", row["onboarding_id"])
        else:
            stdb.call("request_onboarding", handle)
    except StdbError as exc:
        return {"handle": handle, "status": "failed", "error": f"Couldn't queue this audience: {str(exc)[:200]}"}
    return {"handle": handle, "status": "queued", "error": ""}


def render_onboarding(row: dict) -> str:
    handle, status = row["handle"], row["status"]
    if status == "ready":
        return f"@{handle}'s audience is ready. You can explore it or continue your saved request."
    if status == "failed":
        return f"Couldn't build @{handle}'s audience: {row.get('error') or 'the build failed'}."
    return (f"Building @{handle}'s audience from their real X followers. Stage: {status}. "
            f"Check progress, then continue when it is ready. Timing depends on X rate limits.\n\n"
            f"[Watch it build]({APP_URL}/onboarding?brand={handle})")


def onboarding_reply(stdb, brand: str) -> str:
    handle = brand.strip().lstrip("@")
    if not X_HANDLE.match(handle):
        return f"I don't have @{handle}'s audience yet. I can build one for any X brand: ask me about its X handle."
    return render_onboarding(onboarding_state(stdb, handle, start=True))
