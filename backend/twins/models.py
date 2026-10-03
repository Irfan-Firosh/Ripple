"""Data shapes shared by every twin module. X fields mirror the snake_case SQL columns."""
from typing import Literal

from pydantic import BaseModel, Field

MODEL = "claude-haiku-4-5-20251001"


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
    topic: str = Field(min_length=1, max_length=60)
    affinity: float = Field(ge=0, le=1)


class TwinPersona(BaseModel):
    topics: list[Topic] = Field(min_length=1, max_length=8)
    tone: str = Field(min_length=1, max_length=160)
    format_prefs: list[str] = Field(max_length=6)
    hot_buttons: list[str] = Field(max_length=6, description="What reliably makes them reply, quote or repost")
    ignores: list[str] = Field(max_length=6, description="Content they scroll past")
    persona_summary: str = Field(min_length=1, max_length=500)
    evidence_post_ids: list[str] = Field(max_length=10, description="IDs of the given posts that best show this persona")


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
    answer: str = Field(min_length=1, max_length=800, description="First person, in this account's voice")
    cited_post_ids: list[str] = Field(description="IDs of your own posts that justify the answer")
