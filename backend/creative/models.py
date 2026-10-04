"""Validated creative contracts; no private persona fields belong here."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from twins.models import Items, Text

from .config import IMAGE_MODEL, TEXT_MODEL
ASPECT_RATIOS = {"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "21:9", "5:2", "auto"}


class Theme(BaseModel):
    text: Text(80)
    twin_ids: list[str]
    support: float = 0


class CreativeBrief(BaseModel):
    segment: str
    audience_label: Text(60)
    key_interests: Items(Theme, 5)
    avoid: Items(Theme, 5)
    tone: Text(120)
    value_props: Items(str, 3)
    message_angle: Text(160)
    headline_options: Items(Text(60), 3)
    cta: Text(30)
    visual_cues: Items(str, 5)
    visual_avoid: Items(str, 4)
    format: Literal["product_ui", "lifestyle", "typographic", "illustration", "meme"]


class Concept(BaseModel):
    concept_name: Text(80)
    image_prompt: Text(3500)
    headline: Text(60)
    cta: Text(30)


class Concepts(BaseModel):
    concepts: Items(Concept, 4)


class BrandKit(BaseModel):
    model_config = ConfigDict(extra="ignore")
    brand_user_id: str
    display_name: Text(100)
    product_description: Text(1000)
    value_props: Items(str, 8)
    palette: Items(str, 8)
    visual_style: Text(500)
    banned_claims: Items(str, 20) = Field(default_factory=list)
    reference_image_urls: Items(str, 4) = Field(default_factory=list)
