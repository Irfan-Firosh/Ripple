import pytest
from pydantic import BaseModel, Field

from conftest import FakeClient
from twins.llm import TwinLLMError, call_tool
from twins.models import MODEL


class Out(BaseModel):
    score: float = Field(ge=0, le=1)


def run(client):
    return call_tool(client, system="sys", user="usr", tool_name="emit", description="d", output_model=Out)


def test_returns_validated_model_and_sends_forced_tool():
    client = FakeClient([{"score": 0.4}])
    assert run(client) == Out(score=0.4)
    call = client.calls[0]
    assert call["model"] == MODEL and "temperature" not in call  # anthropic>=1.x rejects sampling params
    assert call["tool_choice"] == {"type": "tool", "name": "emit"}
    assert call["tools"][0]["input_schema"]["properties"]["score"]["maximum"] == 1


def test_retries_once_on_invalid_output():
    client = FakeClient([{"score": 7}, {"score": 0.9}])
    assert run(client).score == 0.9 and len(client.calls) == 2


def test_raises_after_two_bad_outputs():
    with pytest.raises(TwinLLMError, match="emit"):
        run(FakeClient([None, {"score": -1}]))
