"""Messages between the Orchestrator (teammate) and the Audience / Simulation agents.

These are uagents Models (pydantic v1). Import them on both sides; never redefine them, or the protocol
digests stop matching and messages are dropped.
"""
from uagents import Model

BRANDS = ("spacetimedb", "raycast.com")


class NicheReach(Model):
    slug: str
    label: str
    engaged_share: float
    people: int


class Responder(Model):
    user_id: str
    handle: str
    name: str
    avatar: str
    profile_url: str
    action: str
    p_engage: float
    engaged_share: float
    reason: str


class SimulateRequest(Model):
    request_id: str
    brand: str
    draft: str
    trials: int = 200


class SimulateResult(Model):
    request_id: str
    ok: bool
    error: str | None = None
    run_id: str = ""
    brand: str = ""
    draft: str = ""
    people: int = 0
    scored: int = 0  # twins Claude actually scored (the rest count as not engaging)
    reach_p10: int = 0
    reach_p50: int = 0
    reach_p90: int = 0
    seen_p50: int = 0
    top_niches: list[NicheReach] = []
    top_responders: list[Responder] = []
    dashboard_url: str = ""


class CompareRequest(Model):
    request_id: str
    brand: str
    drafts: list[str]


class CompareResult(Model):
    request_id: str
    ok: bool
    error: str | None = None
    results: list[SimulateResult] = []
    winner_index: int = -1


class WhyRequest(Model):
    request_id: str
    brand: str
    handle: str
    draft: str


class WhyResult(Model):
    request_id: str
    ok: bool
    error: str | None = None
    handle: str = ""
    name: str = ""
    avatar: str = ""
    profile_url: str = ""
    action: str = ""
    confidence: float = 0.0
    answer: str = ""


class AudienceRequest(Model):
    request_id: str
    brand: str


class AudienceResult(Model):
    request_id: str
    ok: bool
    error: str | None = None
    brand: str = ""
    people: int = 0
    niches: list[NicheReach] = []
