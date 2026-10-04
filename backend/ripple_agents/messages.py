"""Messages between the orchestrator and the specialist agents. Failures travel in `error`, never as silence."""
from uagents import Model


class AudienceRequest(Model):
    brand: str
    niches: list[str] = []


class AudienceResult(Model):
    brand: str
    personas: int = 0
    niche_share: dict[str, float] = {}
    matched: int = 0
    top_people: dict[str, list[str]] = {}
    error: str = ""


class ReactRequest(Model):
    brand: str
    drafts: list[str]
    niches: list[str] = []
    sample_size: int = 20
    question: str = ""


class VariantResult(Model):
    label: str
    draft: str
    responses: int
    failed: int
    actions: dict[str, int]
    engagement_rate: float
    avg_confidence: float
    segment_engagement: dict[str, float]
    quotes: list[str]


class ReactResult(Model):
    brand: str
    personas: int = 0
    variants: list[VariantResult] = []
    error: str = ""


# Contract for the Simulation agent (reach / cascade), which is built separately.
class SimulateRequest(Model):
    brand: str
    draft: str


class SimulateResult(Model):
    brand: str
    reach_low: int = 0
    reach_high: int = 0
    summary: str = ""
    error: str = ""
