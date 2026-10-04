"""ASI:One (OpenAI-compatible) calls: turn a chat message into a validated plan, and write the takeaway."""
import json
import os
import re
from typing import Literal

import requests
from pydantic import BaseModel, Field, ValidationError, field_validator

from twins.niches import NICHE_SLUGS, NICHES

ASI1_URL = "https://api.asi1.ai/v1/chat/completions"
ASI1_MODEL = os.environ.get("ASI1_MODEL", "asi1-mini")
ATTEMPTS = 2
MAX_VARIANTS = 5
MAX_SAMPLE = 100
DEFAULT_BRAND = os.environ.get("RIPPLE_DEFAULT_BRAND", "raycast.com")


class Asi1Error(RuntimeError):
    pass


ASPECT_CHOICES = ("1:1", "3:4", "4:3", "9:16", "16:9")


class CampaignPlan(BaseModel):
    action: Literal["react", "audience", "create", "help"]
    brand: str = DEFAULT_BRAND
    variants: list[str] = Field(default_factory=list, max_length=MAX_VARIANTS)
    niches: list[str] = Field(default_factory=list)
    sample_size: int = Field(20, ge=1, le=MAX_SAMPLE)
    question: str = ""
    goal: str = Field("", max_length=600)
    offer: str = Field("", max_length=300)
    n: int = Field(3, ge=2, le=4)
    aspect_ratio: Literal["1:1", "3:4", "4:3", "9:16", "16:9"] = "1:1"

    @field_validator("brand", mode="before")
    @classmethod
    def _brand(cls, value):
        return (value or DEFAULT_BRAND).strip().lstrip("@")

    @field_validator("goal", "offer", mode="before")
    @classmethod
    def _text_or_empty(cls, value):
        return value or ""

    @field_validator("n", mode="before")
    @classmethod
    def _ad_count(cls, value):  # unused for non-create actions, where ASI:One often sends 0 or null
        try:
            return min(4, max(2, int(value))) if value else 3
        except (TypeError, ValueError):
            return 3

    @field_validator("aspect_ratio", mode="before")
    @classmethod
    def _aspect(cls, value):
        return value if value in ASPECT_CHOICES else "1:1"

    @field_validator("niches")
    @classmethod
    def _known_niches(cls, value: list[str]) -> list[str]:
        return [s for s in dict.fromkeys(value) if s in NICHE_SLUGS and s not in {"politics_society", "other"}][:3]


_CATALOG = "\n".join(f"- {n.slug}: {n.label} ({n.description})" for n in NICHES)

PLANNER_SYSTEM = f"""You route requests for Ripple, which predicts how a brand's real social audience (simulated as
personas built from their followers' public posts) would react to a draft post before it is published. Reply with ONE JSON object
and nothing else:
{{"action": "react" | "audience" | "create" | "help",
  "brand": the brand's X or Bluesky handle without @ (e.g. "spacetimedb", "raycast.com"), or null if not named,
  "variants": [exact text of each draft post to test, verbatim, at most {MAX_VARIANTS}],
  "niches": [1-3 slugs from the catalog that the drafts or the question are about],
  "sample_size": how many personas to ask (default 20, max {MAX_SAMPLE}),
  "question": an extra question the user wants each persona to answer, or "",
  "goal": the campaign goal when action is create, otherwise "",
  "offer": a user-provided offer, otherwise "",
  "n": number of ads per segment for create (2-4, default 3),
  "aspect_ratio": "1:1" by default, or "3:4", "4:3", "9:16", "16:9" if requested}}
"react": the user gives one or more drafts and wants to know how the audience would react, or which is better.
"audience": the user asks who in the audience cares about a topic, or what the audience is like.
"create": the user asks to make, generate or design new ads/creatives for an audience. Preserve their goal.
"help": anything else. Never invent drafts: copy them from the user's message.
Niche catalog:
{_CATALOG}"""


def _json_object(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("no JSON object in reply")
    return json.loads(match.group(0))


def chat(api_key: str, system: str, user: str, *, max_tokens: int = 800, session=requests) -> str:
    try:
        r = session.post(ASI1_URL, timeout=60, headers={"Authorization": f"Bearer {api_key}"}, json={
            "model": ASI1_MODEL, "max_tokens": max_tokens, "temperature": 0,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
    except requests.RequestException as exc:
        raise Asi1Error(f"network error: {exc}") from exc
    if r.status_code != 200:
        raise Asi1Error(f"HTTP {r.status_code}: {r.text[:200]}")
    return r.json()["choices"][0]["message"]["content"] or ""


def plan_campaign(api_key: str, request_text: str, *, session=requests) -> CampaignPlan:
    reason = "no attempts made"
    for _ in range(ATTEMPTS):
        reply = chat(api_key, PLANNER_SYSTEM, request_text, session=session)
        try:
            return CampaignPlan.model_validate(_json_object(reply))
        except (ValueError, ValidationError) as exc:
            reason = str(exc).splitlines()[0]
    raise Asi1Error(f"could not plan the request ({reason})")


def takeaway(api_key: str, report: str, *, session=requests) -> str:
    return chat(api_key, "You are a concise marketing analyst. In at most 3 sentences, say how the audience "
                "received the draft(s) (and which variant won, if several), for which niches, and give one concrete "
                "rewrite suggestion. Use only the numbers given.",
                report, max_tokens=300, session=session).strip()
