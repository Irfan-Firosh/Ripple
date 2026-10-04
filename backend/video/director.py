"""Opus 5.5 as director (the brief, before any code) and as critic (scores its own stills)."""
import base64
import json
from pathlib import Path

from pydantic import BaseModel, Field

from .config import OPUS_MODEL, limits
from .models import Brief

DIRECTOR = """You direct short marketing films for brands. Write the director's brief for a 16:9 film
of at most {seconds} seconds (4-6 beats, under {words} spoken words of voiceover in total). Rules:
- Ground every claim in the research sources; list each fact you rely on with its source URL in facts_used.
  Never invent numbers, features, customers or quotes.
- Speak to the audience you are given; lead with a hook in the first two seconds.
- Name a concrete reference style (e.g. "Linear launch film", "Apple keynote bumper", "Stripe docs motion").
- Pick ONE accent colour that fits the brand and one dark or light background.
- on_screen is a few big words (not the voiceover repeated); visual says what moves and how it transforms.
- No em dashes. The thumbnail prompt describes an image with no text in it.
- Follow creative_direction when given. If sibling_film_to_differ_from is given, this film must be clearly different from
  it: a different hook, title, reference style, structure, on-screen words and background."""


def director_system() -> str:
    """The director's rules with the current /ops length limit filled in."""
    lim = limits()
    return DIRECTOR.format(seconds=lim.max_seconds, words=lim.max_words)


class Critique(BaseModel):
    scores: dict[str, int] = Field(description="hook, readability, composition, motion_potential, accuracy: 1-10")
    problems: list[str] = Field(max_length=5, description="the worst problems, each with its still number")


def _tool_call(client, system: str, content, model_cls, name: str, max_tokens: int = 4000):
    # Opus 5.5 rejects a forced tool_choice, so the tool is offered ("auto") and the prompt requires it.
    msg = client.messages.create(
        model=OPUS_MODEL, max_tokens=max_tokens, system=f"{system}\n\nAnswer only by calling the `{name}` tool.",
        tools=[{"name": name, "description": f"Return the {name}", "input_schema": model_cls.model_json_schema()}],
        tool_choice={"type": "auto"}, messages=[{"role": "user", "content": content}])
    block = next((b for b in msg.content if b.type == "tool_use" and b.name == name), None)
    if block is None:
        raise ValueError(f"Opus answered without calling the {name} tool")
    return model_cls.model_validate(block.input)


def write_brief(client, company: str, news: str, goal: str, audience: str, sources: list[dict], *,
                direction: dict | None = None) -> Brief:
    data = {"company": company, "campaign_news": news, "goal": goal, "audience": audience, "research_sources": sources}
    if direction:  # A and B films of one campaign must look and sound clearly different
        data["creative_direction"] = direction.get("style", "")
        if direction.get("differ_from"):
            data["sibling_film_to_differ_from"] = direction["differ_from"]
    content = json.dumps(data, indent=1)
    last = None
    for _ in range(2):  # one retry with the validation error if the brief breaks a rule (e.g. too long)
        try:
            prompt = content if last is None else f"{content}\n\nYour previous brief was rejected: {last}. Fix it."
            return _tool_call(client, director_system(), prompt, Brief, "brief")
        except Exception as exc:  # noqa: BLE001 - validation errors go back to the model once
            last = str(exc)[:500]
    raise ValueError(f"Opus could not write a valid brief: {last}")


CRITIC = """You are a harsh motion director reviewing 4 stills (2x2 sheet, numbered 1-4 left-to-right, top-to-bottom)
from a marketing film. Score 1-10: hook, readability (phone size), composition, motion_potential, accuracy (claims
match the facts). List the worst problems precisely (overlapping text, clipped words, empty frames, centred title on
a gradient, tiny type, off-brand colour). Be strict: 8+ only if it would survive posting."""


def critique(client, sheet: Path, facts: list[dict]) -> Critique:
    image = base64.b64encode(sheet.read_bytes()).decode()
    content = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image}},
               {"type": "text", "text": f"Facts the film may use: {json.dumps(facts)}"}]
    return _tool_call(client, CRITIC, content, Critique, "critique", max_tokens=1500)
