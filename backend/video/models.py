"""The director's brief Opus writes before any code, and the voice timeline it is cut to."""
from pydantic import BaseModel, Field, field_validator, model_validator

from .config import limits

HEX = r"^#[0-9A-Fa-f]{6}$"


class Fact(BaseModel):
    claim: str = Field(max_length=200)
    source_url: str = Field(max_length=500)


class Beat(BaseModel):
    voiceover: str = Field(min_length=1, max_length=200, description="spoken line for this beat")
    on_screen: str = Field(min_length=1, max_length=80, description="the few words shown big on screen")
    visual: str = Field(min_length=1, max_length=300, description="what moves: shapes, UI, camera, transitions")


class Brief(BaseModel):
    title: str = Field(max_length=60)
    promise: str = Field(max_length=120, description="the one-line promise of the film")
    reference_style: str = Field(max_length=80, description='a named style, e.g. "Linear launch film"')
    accent_hex: str = Field(pattern=HEX)
    background_hex: str = Field(pattern=HEX)
    beats: list[Beat] = Field(min_length=4, max_length=6)
    thumbnail_prompt: str = Field(max_length=400, description="image prompt for the thumbnail, no text in the image")
    facts_used: list[Fact] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def _fits_twenty_seconds(self):
        words = sum(len(b.voiceover.split()) for b in self.beats)
        cap = limits().max_words
        if words > cap:
            raise ValueError(f"voiceover has {words} words; keep it under {cap} (about {limits().max_seconds - 2} s)")
        return self

    @field_validator("title", "promise", "reference_style")
    @classmethod
    def _no_em_dash(cls, v: str) -> str:
        return v.replace("—", ",").replace("–", "-")


class Word(BaseModel):
    text: str
    start: float
    end: float
