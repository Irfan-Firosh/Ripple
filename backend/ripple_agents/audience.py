"""Who in a brand's audience cares about what: niche shares and the most relevant twins, read from SpacetimeDB."""
import random
import re
from collections import Counter, defaultdict

from twins.niches import NICHES
from twins.stdb import sql_str

from .messages import AudienceResult

HANDLE_RE = re.compile(r"^[a-z0-9_][a-z0-9_.-]{0,252}$")  # X usernames and Bluesky domain handles
LABELS = {n.slug: n.label for n in NICHES}
STRONG_AFFINITY = 0.5
TOP_NICHES = 6
TOP_PEOPLE = 5


def find_brand(stdb, brand: str) -> dict:
    """The x_user row for an X handle or a Bluesky handle; "raycast" also matches the Bluesky domain "raycast.com"."""
    username = brand.strip().lstrip("@").lower()
    if not HANDLE_RE.match(username):
        raise ValueError(f"invalid handle: {brand!r}")
    users = stdb.sql("SELECT user_id, username FROM x_user")
    match = next((u for u in users if u["username"].lower() == username), None) or \
        next((u for u in users if u["username"].lower().startswith(username + ".")), None)
    if match is None:
        raise LookupError(f"@{username} has not been ingested yet")
    return match


def brand_twins(stdb, brand: str) -> dict[str, str]:
    """user_id -> username for every twin built for this brand."""
    brand_id = find_brand(stdb, brand)["user_id"]
    members = {r["user_id"] for r in stdb.sql(
        f"SELECT user_id FROM twin_audience WHERE brand_user_id = {sql_str(brand_id)}")}
    rows = stdb.sql("SELECT user_id, username FROM twin")
    return {r["user_id"]: r["username"] for r in rows if r["user_id"] in members}


def _affinities(stdb, twin_ids) -> dict[str, dict[str, float]]:
    """user_id -> niche -> affinity, limited to the given twins."""
    out: dict[str, dict[str, float]] = defaultdict(dict)
    for r in stdb.sql("SELECT user_id, niche, affinity FROM twin_niche"):
        if r["user_id"] in twin_ids:
            out[r["user_id"]][r["niche"]] = r["affinity"]
    return out


def relevant_twin_ids(stdb, brand: str, niches: list[str], n: int, *, rng: random.Random | None = None) -> list[str]:
    """The n twins whose niches best match; random (but reproducible) when no niche is given or nobody matches."""
    twins = brand_twins(stdb, brand)
    ids = sorted(twins)
    (rng or random.Random(0)).shuffle(ids)  # breaks ties without favouring low ids
    if niches:
        aff = _affinities(stdb, twins)
        ids.sort(key=lambda uid: -sum(aff[uid].get(s, 0.0) for s in niches))
    return ids[:n]


def audience_profile(stdb, brand: str, niches: list[str]) -> AudienceResult:
    twins = brand_twins(stdb, brand)
    if not twins:
        return AudienceResult(brand=brand, error=f"@{brand} has no personas yet")
    aff = _affinities(stdb, twins)
    main_of = {uid: max(per, key=per.get) for uid, per in aff.items() if per}
    main = Counter(main_of.values())
    shares = {LABELS.get(s, s): c / len(twins) for s, c in main.most_common(TOP_NICHES)}

    def cares(uid: str, s: str) -> bool:  # it is their main niche, or a strong secondary one
        return main_of.get(uid) == s or aff[uid].get(s, 0) >= STRONG_AFFINITY

    people: dict[str, list[str]] = {}
    for s in niches:
        ranked = sorted((uid for uid in twins if cares(uid, s)), key=lambda u: -aff[u][s])
        people[LABELS.get(s, s)] = [f"@{twins[u]}" for u in ranked[:TOP_PEOPLE]]
    matched = sum(1 for uid in twins if any(cares(uid, s) for s in niches))
    return AudienceResult(brand=brand, personas=len(twins), niche_share=shares, matched=matched, top_people=people)


def render_audience(result: AudienceResult, niches: list[str]) -> str:
    lines = [f"**@{result.brand}'s audience**: {result.personas} personas", "", "Main niche of each persona:"]
    lines += [f"- {label}: {share:.0%}" for label, share in result.niche_share.items()]
    if niches:
        asked = ", ".join(LABELS.get(s, s) for s in niches)
        lines += ["", f"**{result.matched} of {result.personas}** care about {asked}. Most engaged:"]
        for label, people in result.top_people.items():
            lines.append(f"- {label}: {', '.join(people) if people else 'nobody'}")
    return "\n".join(lines)
