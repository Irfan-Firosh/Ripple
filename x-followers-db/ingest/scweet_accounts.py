"""X session accounts for Scweet: X_AUTH_TOKEN, X_AUTH_TOKEN_2, X_AUTH_TOKEN_3, ... become one pool.

Scweet leases one account per request and cools an account down when X rate-limits it, so each extra token
adds roughly another 50 timeline reads per 15 minutes.
"""
import re
from collections.abc import Mapping

TOKEN_KEY = re.compile(r"^X_AUTH_TOKEN(?:_(\d+))?$")


def auth_accounts(environ: Mapping[str, str]) -> list[dict]:
    numbered = sorted((int(m.group(1) or 1), value.strip())
                      for key, value in environ.items() if (m := TOKEN_KEY.match(key)) and value.strip())
    seen: set[str] = set()
    accounts = []
    for n, token in numbered:
        if token not in seen:
            seen.add(token)
            accounts.append({"username": f"x_account_{n}", "cookies": {"auth_token": token}})
    return accounts


def working_accounts(accounts: list[dict], probe) -> tuple[list[dict], list[str]]:
    """Keep the accounts X still accepts. A dead session in Scweet's pool makes every other request come back
    empty, which the ingest would misread as a rate limit."""
    kept, dropped = [], []
    for account in accounts:
        try:
            ok = probe(account)
        except Exception:  # noqa: BLE001 - an account we cannot verify is not used
            ok = False
        (kept if ok else dropped).append(account if ok else account["username"])
    return kept, dropped
