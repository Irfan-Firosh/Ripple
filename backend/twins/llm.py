"""One forced tool call to Claude, validated by Pydantic, with one retry."""
from typing import TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from .models import MODEL

M = TypeVar("M", bound=BaseModel)
ATTEMPTS = 2


class TwinLLMError(RuntimeError):
    pass


def make_client(api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=60.0)


def call_tool(client, *, system: str, user: str, tool_name: str, description: str,
              output_model: type[M], max_tokens: int = 1500) -> M:
    tool = {"name": tool_name, "description": description, "input_schema": output_model.model_json_schema()}
    reason = "no attempts made"
    for _ in range(ATTEMPTS):
        response = client.messages.create(
            model=MODEL, max_tokens=max_tokens, temperature=0, system=system,
            tools=[tool], tool_choice={"type": "tool", "name": tool_name},
            messages=[{"role": "user", "content": user}],
        )
        block = next((b for b in response.content if b.type == "tool_use" and b.name == tool_name), None)
        if block is None:
            reason = "model returned no tool call"
            continue
        try:
            return output_model.model_validate(block.input)
        except ValidationError as exc:
            reason = str(exc).splitlines()[0]
    raise TwinLLMError(f"{tool_name}: invalid output after {ATTEMPTS} attempts ({reason})")
