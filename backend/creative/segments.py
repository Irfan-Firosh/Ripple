"""Deterministic aggregation. Real IDs remain local; text synthesis sees evidence aliases."""
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from twins.niches import NICHE_SLUGS
from twins.stdb import sql_str

from .guardrails import clean_list, clean_text
from .config import MIN_SEGMENT_SIZE

EXCLUDED_SEGMENTS = {"other", "politics_society"}


@dataclass
class Segment:
    slug: str
    twin_ids: list[str]
    share: float
    signals: dict
    evidence_ids: dict[str, str] = field(repr=False)

    @property
    def twin_count(self):
        return len(self.twin_ids)


def aggregate_segments(stdb, brand_user_id: str, selected=None, *, limit=4) -> list[Segment]:
    """Membership is twin_audience; main niche is argmax (lexical ties), never brand_user_id on twin."""
    rows = stdb.sql(f"SELECT user_id FROM twin_audience WHERE brand_user_id = {sql_str(brand_user_id)}")
    audience = {r["user_id"] for r in rows}
    twins = {r["user_id"]: r for r in stdb.sql("SELECT user_id, hot_buttons, ignores, format_prefs, tone FROM twin") if r["user_id"] in audience}
    affinities = defaultdict(dict)
    for row in stdb.sql("SELECT user_id, niche, affinity FROM twin_niche"):
        if row["user_id"] in twins and row["niche"] in NICHE_SLUGS:
            affinities[row["user_id"]][row["niche"]] = max(0.0, min(1.0, float(row["affinity"])))
    members = defaultdict(list)
    for uid, values in affinities.items():
        members[min(values, key=lambda slug: (-values[slug], slug))].append(uid)
    available = {slug for slug, ids in members.items() if slug not in EXCLUDED_SEGMENTS and len(ids) >= MIN_SEGMENT_SIZE}
    if selected:
        invalid = set(selected) - available
        if invalid:
            raise ValueError("segments unavailable, excluded, or smaller than 15 personas: " + ", ".join(sorted(invalid)))
        available &= set(selected)
    result = []
    # Hashtags/media use aggregate counts only. Raw post text, authors and alt text are not LLM inputs.
    posts = {r["post_id"]: r["author_user_id"] for r in stdb.sql("SELECT post_id, author_user_id FROM x_post") if r["author_user_id"] in twins}
    hashtags = stdb.sql("SELECT post_id, value FROM x_post_entity WHERE entity_type = 'hashtag'")
    media = stdb.sql("SELECT post_id, type FROM x_post_media")
    for slug in sorted(available, key=lambda s: (-len(members[s]), s))[:limit]:
        ids = sorted(members[slug])
        aliases = {f"p{i:04d}": uid for i, uid in enumerate(ids, 1)}
        hot, ignores, formats, tones = [], [], [], []
        secondary = Counter()
        for alias, uid in aliases.items():
            row = twins[uid]
            hot += [{"text": phrase, "twin_id": alias} for phrase in clean_list(row["hot_buttons"])]
            ignores += [{"text": phrase, "twin_id": alias} for phrase in clean_list(row["ignores"])]
            formats += clean_list(row["format_prefs"])
            tone = clean_text(row["tone"], limit=160)
            if tone:
                tones.append(tone)
            for secondary_slug, affinity in affinities[uid].items():
                if secondary_slug != slug and secondary_slug not in EXCLUDED_SEGMENTS:
                    secondary[secondary_slug] += affinity
        member_ids = set(ids)
        own_posts = {pid for pid, uid in posts.items() if uid in member_ids}
        tags = Counter(clean_text(r["value"].lstrip("#")) for r in hashtags if r["post_id"] in own_posts)
        tags.pop("", None)
        mix = Counter(r["type"] for r in media if r["post_id"] in own_posts and r["type"] in {"photo", "video", "animated_gif"})
        total_media = sum(mix.values())
        signals = {"segment": slug, "share": len(ids) / len(audience), "twin_count": len(ids),
                   "secondary_interests": [{"niche": s, "affinity": score / len(ids)} for s, score in sorted(secondary.items(), key=lambda item: (-item[1], item[0]))[:3]],
                   "hot_button_pool": hot, "ignore_pool": ignores,
                   "format_pool": [v for v, _ in sorted(Counter(formats).items(), key=lambda item: (-item[1], item[0]))],
                   "tone_samples": tones[:15], "top_hashtags": [v for v, _ in sorted(tags.items(), key=lambda item: (-item[1], item[0]))[:10]],
                   "media_mix": {kind: count / total_media for kind, count in sorted(mix.items())} if total_media else {}}
        result.append(Segment(slug, ids, len(ids) / len(audience), signals, aliases))
    return result
