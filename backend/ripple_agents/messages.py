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


class BriefRequest(Model):
    brand: str
    campaign_id: str
    goal: str
    segments: list[str] = []
    offer: str = ""
    n: int = 3
    aspect_ratio: str = "1:1"


class BriefResult(Model):
    campaign_id: str
    brief_ids: list[str] = []
    error: str = ""


class GenerateRequest(Model):
    campaign_id: str
    brief_id: str
    n: int = 3
    aspect_ratio: str = "1:1"


class EditRequest(Model):
    campaign_id: str
    parent_variant_id: str
    operation: str
    instruction: str = ""
    aspect_ratio: str = ""


class VariantsResult(Model):
    campaign_id: str
    variant_ids: list[str] = []
    image_urls: list[str] = []
    warnings: list[str] = []
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
