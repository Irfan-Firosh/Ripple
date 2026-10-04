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
DEFAULT_BRAND = ""  # Only an explicitly selected audience may be reused.


class Asi1Error(RuntimeError):
    pass


ASPECT_CHOICES = ("1:1", "3:4", "4:3", "9:16", "16:9")


class CampaignPlan(BaseModel):
    action: Literal["react", "audience", "create", "discover", "campaign_status", "test_campaign", "video", "edit_video", "approve", "edit_image", "onboard", "status", "retry", "help"]
    brand: str = DEFAULT_BRAND
    variants: list[str] = Field(default_factory=list, max_length=MAX_VARIANTS)
    niches: list[str] = Field(default_factory=list)
    sample_size: int | None = Field(20, ge=1, le=MAX_SAMPLE)
    question: str = ""
    goal: str = Field("", max_length=600)
    offer: str = Field("", max_length=300)
    n: int = Field(2, ge=2, le=4)
    aspect_ratio: Literal["1:1", "3:4", "4:3", "9:16", "16:9"] = "16:9"
    campaign_id: str = ""
    draft: Literal["", "A", "B"] = ""
    instruction: str = Field("", max_length=600)
    variant_id: str = ""
    refresh: bool = False

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
            return min(4, max(2, int(value))) if value else 2
        except (TypeError, ValueError):
            return 2

    @field_validator("aspect_ratio", mode="before")
    @classmethod
    def _aspect(cls, value):
        return value if value in ASPECT_CHOICES else "16:9"

    @field_validator("niches")
    @classmethod
    def _known_niches(cls, value: list[str]) -> list[str]:
        return [s for s in dict.fromkeys(value) if s in NICHE_SLUGS and s not in {"politics_society", "other"}][:3]


_CATALOG = "\n".join(f"- {n.slug}: {n.label} ({n.description})" for n in NICHES)

PLANNER_SYSTEM = f"""You route requests for Ripple, which stress-tests campaign drafts on an audience model
grounded in public follower posts before publishing. Reply with ONE JSON object
and nothing else:
{{"action": "react" | "audience" | "create" | "discover" | "campaign_status" | "test_campaign" | "video" | "edit_video" | "approve" | "edit_image" | "onboard" | "status" | "retry" | "help",
  "brand": the brand's X or existing Bluesky handle without @, or null if not named,
  "variants": [exact text of each draft post to test, verbatim, at most {MAX_VARIANTS}],
  "niches": [1-3 slugs from the catalog that the drafts or the question are about],
  "sample_size": an explicitly requested number of interview personas (max {MAX_SAMPLE}), otherwise 20 most relevant personas,
  "question": an extra question the user wants each persona to answer, or "",
  "goal": the campaign goal when action is create, otherwise "",
  "offer": a user-provided offer, otherwise "",
  "n": number of concepts for create (2-4, default 2),
  "aspect_ratio": "16:9" by default, or "1:1", "3:4", "4:3", "9:16" if requested,
  "draft": "A" or "B" when approving or editing a video, otherwise "",
  "instruction": exact requested edit, otherwise ""}}
"react": the user asks to simulate, predict reach/likes/reposts, test a post, or compare drafts.
If they ask to simulate without supplying post copy, return react with an empty variants list so we can ask for it.
"audience": the user asks who in the audience cares about a topic, or what the audience is like.
"create": the user asks to make, generate or design new ads/creatives for an audience. Preserve their goal.
"discover": research a company, its recent launches, blog and changelog. "campaign_status": saved campaign progress.
"test_campaign": test both saved generated drafts. "video": make videos for those drafts.
"edit_video": revise the selected draft's video. "approve": choose A or B after testing; never publish automatically.
"onboard": the user asks to build or scrape an X audience. "status": check its build progress. "retry": explicitly retry a failed build.
Accept any valid X handle, not just the examples. Keep X handles distinct from Bluesky domain handles:
An X handle and a Bluesky domain handle are different audiences. Do not infer a domain suffix.
Card form submissions may arrive as prose with action, brand, draft_a and draft_b: use those draft fields verbatim.
For audience requests, map the question/topic to niches from the catalog.
Use the saved audience for follow-ups unless the user names another. If neither is supplied, return brand null.
Never default to one of the example brands. A brief topic answer such as "AI" continues an audience analysis.
@ripple and agent1... addresses refer to this chat agent, not the company audience. Never use them as brand.
Selecting "Create campaign images" is create, not help. With no goal, return create with an empty goal to open its form.
"help": anything else. Never invent drafts: copy them from the user's message.
Niche catalog:
{_CATALOG}"""


def campaign_request(text: str, brand: str = "", *, awaiting: bool = False) -> CampaignPlan | None:
    """Route explicit campaign requests and goal replies without a model call."""
    intent = re.match(r"(?:please\s+)?(?:create|generate|make|design)\b[^.!?\n]{0,80}?\b"
                      r"(?:(?:campaign\s+)?(?:images?|ads?|creatives?)\b|campaigns?\b(?!\s+(?:images?|ads?|creatives?)))", text.strip(), re.I)
    if not intent and not awaiting:
        return None
    if not intent and re.match(r"(?:simulate|test|compare|status|retry|check|menu|help)\b", text.strip(), re.I):
        return None
    count = re.search(r"\b([2-4]|two|three|four)\s+(?:campaign\s+)?(?:images?|ads?|creatives?|concepts?)\b", text, re.I)
    counts = {"two": 2, "three": 3, "four": 4, "2": 2, "3": 3, "4": 4}
    ratio = re.search(r"\b(?:1:1|3:4|4:3|9:16|16:9)\b", text)
    offer = re.search(r"\b(?:offer|call to action|cta)\s*:\s*(.+)", text, re.I | re.S)
    goal_text = text[:offer.start()] if offer else text
    goal = re.search(r"\b(?:goal\s*:|promoting\b|promote\b)\s*(.+)", goal_text, re.I | re.S)
    if goal:
        goal_text = goal.group(1)
    elif intent:
        goal_text = text.strip()[intent.end():]
        goal_text = re.sub(r"\b(?:for|on)\s+@[A-Za-z0-9_.-]+\b", "", goal_text, flags=re.I)
        goal_text = re.sub(r"\b(?:1:1|3:4|4:3|9:16|16:9)\b", "", goal_text)
        if offer:
            goal_text = re.split(r"\b(?:offer|call to action|cta)\s*:", goal_text, maxsplit=1, flags=re.I)[0]
    return CampaignPlan(action="create", brand=brand, goal=goal_text.strip(" .:;\n")[:600],
                        offer=offer.group(1).strip()[:300] if offer else "",
                        n=counts[count.group(1).lower()] if count else 2,
                        aspect_ratio=ratio.group(0) if ratio else "16:9")


def topic_niches(text: str) -> list[str]:
    terms = {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) >= 3 or word in {"ai", "ui"}}
    terms -= {"the", "and", "for", "with", "from", "are", "who", "what", "audience", "followers", "post", "posts", "about", "main", "interests"}
    scores = []
    for niche in NICHES:
        if niche.slug in {"other", "politics_society"}:
            continue
        words = set(re.findall(r"[a-z0-9]+", f"{niche.label} {niche.description}".lower()))
        score = len(terms & words)
        if score:
            scores.append((score, niche.slug))
    return [slug for _, slug in sorted(scores, key=lambda item: (-item[0], item[1]))[:3]]


def direct_request(text: str, brand: str = "", *, awaiting: str = "") -> CampaignPlan | None:
    """The standard demo actions do not depend on the request-planning API."""
    command = text.strip()
    if re.match(r"(?:refresh|rebuild|redo)\b", command, re.I) and re.search(r"\b(?:audience|data|followers)\b", command, re.I):
        return CampaignPlan(action="onboard", brand=brand, refresh=True)
    if re.match(r"(?:research|discover|what.s new|find recent|company news)\b", command, re.I):
        return CampaignPlan(action="discover", brand=brand)
    if re.match(r"(?:check campaign|campaign progress|campaign status)\b", command, re.I):
        return CampaignPlan(action="campaign_status", brand=brand)
    if re.match(r"(?:test both|test these drafts|test my campaign)\b", command, re.I):
        return CampaignPlan(action="test_campaign", brand=brand)
    if re.match(r"(?:make|generate|create)\b.*\bvideos?\b", command, re.I):
        return CampaignPlan(action="video", brand=brand)
    if re.match(r"approve\s+[AB]\b", command, re.I):
        return CampaignPlan(action="approve", brand=brand, draft=command.split()[1].upper())
    edit = re.match(r"edit\s+video\s+([AB])\s*:\s*(.+)", command, re.I | re.S)
    if edit:
        return CampaignPlan(action="edit_video", brand=brand, draft=edit.group(1).upper(), instruction=edit.group(2))
    if re.match(r"(?:check\b.*(?:progress|status)|status\b|onboarding progress\b)", command, re.I):
        return CampaignPlan(action="status", brand=brand)
    if re.match(r"retry\b", command, re.I):
        return CampaignPlan(action="retry", brand=brand)
    if re.match(r"(?:build|scrape|onboard)\b", command, re.I) and re.search(r"\b(?:audience|followers|onboard)\b", command, re.I):
        return CampaignPlan(action="onboard", brand=brand)
    campaign = campaign_request(command, brand, awaiting=awaiting == "create")
    if campaign:
        return campaign
    if re.match(r"(?:simulate|test|predict|compare|how would|which)\b", command, re.I):
        pair = re.search(r"\bA\s*:\s*(.*?)\s+\bB\s*:\s*(.+)", command, re.I | re.S)
        drafts = [s.strip().strip('\"“”') for s in pair.groups()] if pair else re.findall(r'[\"“](.*?)[\"”]', command, re.S)
        if not drafts:
            draft = re.search(r":\s*(.+)", command, re.S)
            drafts = [draft.group(1).strip()] if draft else []
        return CampaignPlan(action="react", brand=brand, variants=drafts[:MAX_VARIANTS], niches=topic_niches(" ".join(drafts)))
    if re.match(r"(?:who|what are|what is|explore|analy[sz]e|tell me)\b", command, re.I):
        return CampaignPlan(action="audience", brand=brand, niches=topic_niches(command))
    return None


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
    if "**Lab: every follower sees both** (Simulation agent): A and B are tied" in report:
        return ("A and B are tied in the full-audience Lab prediction. "
                "The interview results above describe a smaller sample. "
                "Try a more specific benefit in the opening line, then test the revised drafts.")
    return chat(api_key, "You are a concise marketing analyst. All results are synthetic predictions, never measured or actual engagement. "
                "If the report includes a full-audience Lab winner, use that as the overall predicted winner. "
                "Interview sample engagement can differ from the Lab; describe it as a separate sample, never override the Lab winner. "
                "In at most 3 sentences, say how the audience "
                "received the draft(s) (and which variant won, if several), for which niches, and give one concrete "
                "rewrite suggestion. Use only the numbers given.",
                report, max_tokens=300, session=session).strip()
