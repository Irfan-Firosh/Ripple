"""Data shapes shared by every twin module. X fields mirror the snake_case SQL columns."""
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field

MODEL = "claude-haiku-4-5-20251001"


def _shorten(value, limit: int):
    """LLMs ignore maxLength on prose: clip at a word boundary instead of rejecting the whole output."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"


def Text(limit: int, **field):  # noqa: N802 - reads like a type
    return Annotated[str, BeforeValidator(lambda v: _shorten(v, limit)), Field(min_length=1, max_length=limit, **field)]


def Items(item, limit: int, **field):  # noqa: N802
    return Annotated[list[item], BeforeValidator(lambda v: v[:limit] if isinstance(v, list) else v),
                     Field(max_length=limit, **field)]


class XUser(BaseModel):
    user_id: str
    username: str
    name: str
    description: str | None = None
    location: str | None = None
    followers_count: int | None = None
    following_count: int | None = None
    verified: bool | None = None


class XPost(BaseModel):
    post_id: str
    author_user_id: str
    text: str
    created_at: str
    is_reply: bool
    is_quote: bool
    impression_count: int | None = None
    like_count: int | None = None
    reply_count: int | None = None
    quote_count: int | None = None
    repost_count: int | None = None


class Account(BaseModel):
    user: XUser
    posts: list[XPost]
    mentions: dict[str, list[str]] = Field(default_factory=dict)      # post_id -> mentioned "@username"s
    annotations: dict[str, list[str]] = Field(default_factory=dict)   # post_id -> X context entity names


class AccountStats(BaseModel):
    post_count: int
    reply_share: float
    quote_share: float
    mention_rate: float
    avg_likes: float
    avg_impressions: float
    engagement_rate: float
    active_hours_utc: list[int]
    top_mentions: list[str]
    x_topics: list[str]


class Topic(BaseModel):
    topic: Text(60)
    affinity: float = Field(ge=0, le=1)


class TwinPersona(BaseModel):
    topics: Annotated[Items(Topic, 8), Field(min_length=1)]
    tone: Text(160, description="At most 160 characters")
    format_prefs: Items(str, 6)
    hot_buttons: Items(str, 6, description="What reliably makes them reply, quote or repost")
    ignores: Items(str, 6, description="Content they scroll past")
    persona_summary: Text(500, description="At most 500 characters")
    evidence_post_ids: Items(str, 10, description="IDs of the given posts that best show this persona")


class Twin(BaseModel):
    user_id: str
    username: str
    brand_user_id: str
    stats: AccountStats
    persona: TwinPersona
    evidence: list[XPost]
    model: str


Action = Literal["reply", "quote", "repost", "like", "ignore"]


class TwinAnswer(BaseModel):
    action: Action
    confidence: float = Field(ge=0, le=1)
    answer: Text(800, description="First person, in this account's voice; at most 800 characters")
    cited_post_ids: list[str] = Field(description="IDs of your own posts that justify the answer")
