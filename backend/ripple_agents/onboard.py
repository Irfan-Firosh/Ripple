"""Brands Ripple doesn't know yet: kick off onboarding (scrape their X followers, build twins) from the chat."""
import re

from twins.stdb import StdbError

from .config import APP_URL

X_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")


def needs_onboarding(error: str) -> bool:
    return "has no personas yet" in error or "has not been ingested" in error


def onboarding_reply(stdb, brand: str) -> str:
    handle = brand.strip().lstrip("@")
    if not X_HANDLE.match(handle):
        return f"I don't have @{handle}'s audience yet. I can build one for any X brand: ask me about its X handle."
    try:
        stdb.call("request_onboarding", handle.lower())
    except StdbError:
        pass  # one is already building; the answer is the same
    return (f"I don't know @{handle}'s audience yet, so I've started building it from their real X followers. "
            f"It takes about 2 minutes, then ask me again.\n\n[Watch it build]({APP_URL}/onboarding)")
