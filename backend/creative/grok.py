"""JSON HTTP client for xAI text and Imagine; image model/cost settings are pinned."""
import base64
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path

import requests

from twins.config import REPO_ROOT

from .config import IMAGE_QUALITY, IMAGE_RESOLUTION, MAX_IMAGE_WORKERS, load_xai_key
from .models import ASPECT_RATIOS, IMAGE_MODEL, TEXT_MODEL

BASE_URL = "https://api.x.ai/v1"
GENERATED_DIR = REPO_ROOT / "frontend/public/generated"
LOG = logging.getLogger(__name__)


class GrokError(RuntimeError):
    def __init__(self, message, *, filtered=False, cost_usd_ticks=0):
        super().__init__(message)
        self.filtered = filtered
        self.cost_usd_ticks = cost_usd_ticks


@dataclass(frozen=True)
class ImageResult:
    image_url: str
    file_id: str | None
    cost_usd_ticks: int


def _cost(data):
    try:
        return max(0, int((data.get("usage") or {}).get("cost_in_usd_ticks") or 0))
    except (ValueError, TypeError, AttributeError):
        return 0


def _filtered(data):
    return data.get("respect_moderation") is False or data.get("filtered") is True


class GrokClient:
    def __init__(self, api_key=None, *, session=None, sleep=time.sleep, generated_dir=GENERATED_DIR):
        self._key = api_key or load_xai_key()
        self._session = session or requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=MAX_IMAGE_WORKERS, pool_maxsize=MAX_IMAGE_WORKERS)
        if session is None:
            self._session.mount("https://", adapter)
        self._sleep = sleep
        self.generated_dir = Path(generated_dir)

    def _post(self, path, body, *, timeout=120):
        for attempt in range(4):
            started = time.monotonic()
            LOG.info("Grok %s: request started (attempt %s)", path, attempt + 1)
            try:
                response = self._session.post(f"{BASE_URL}/{path}", json=body, timeout=timeout,
                                              headers={"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"})
            except requests.RequestException as exc:
                LOG.warning("Grok %s: network request failed after %.1fs", path, time.monotonic() - started)
                # A timed-out image request may already be billed. Do not blindly repeat it.
                raise GrokError(f"{path}: network request failed; output status unknown") from exc
            LOG.info("Grok %s: HTTP %s after %.1fs", path, response.status_code, time.monotonic() - started)
            try:
                data = response.json()
            except (ValueError, TypeError):
                data = {}
            if not isinstance(data, dict):
                raise GrokError(f"{path}: invalid provider response")
            error = data.get("error") or {}
            code = str(error.get("code", "")) if isinstance(error, dict) else str(error)
            error_signal = code + " " + (str(error.get("message", "")) if isinstance(error, dict) else "")
            moderation = _filtered(data) or any(word in error_signal.lower() for word in ("moderation", "content_policy", "content policy", "safety filter", "filtered"))
            if moderation:
                raise GrokError("This take was filtered by xAI", filtered=True, cost_usd_ticks=_cost(data))
            if response.status_code == 200:
                return data
            if response.status_code in {429, 500, 502, 503, 504}:
                if attempt < 3:
                    LOG.warning("Grok %s: retrying after HTTP %s", path, response.status_code)
                    self._sleep(2 ** attempt + 0.5)
                    continue
                raise GrokError(f"{path}: HTTP {response.status_code} after four attempts", cost_usd_ticks=_cost(data))
            # Never echo provider response text: it can contain the input prompt or identifiers.
            raise GrokError(f"{path}: HTTP {response.status_code}" + (f" ({code[:60]})" if re.fullmatch(r"[a-zA-Z0-9_-]+", code) else ""), cost_usd_ticks=_cost(data))
        raise AssertionError("unreachable")

    def chat_json(self, system, user, schema_model):
        schema = schema_model.model_json_schema()
        # Strict output schemas require every property and forbid unknown properties.
        def strict(node):
            if isinstance(node, dict):
                if node.get("type") == "object":
                    node["additionalProperties"] = False
                    node["required"] = list(node.get("properties", {}))
                for value in node.values():
                    strict(value)
            elif isinstance(node, list):
                for value in node:
                    strict(value)
        strict(schema)
        data = self._post("chat/completions", {"model": TEXT_MODEL, "messages": [
            {"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_schema", "json_schema": {"name": schema_model.__name__, "schema": schema, "strict": True}}})
        try:
            return schema_model.model_validate_json(data["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise GrokError("text model returned an invalid structured response") from exc

    def _image(self, path, body, variant_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", variant_id):
            raise ValueError("invalid variant id for generated asset")
        body.update(model=IMAGE_MODEL, quality=IMAGE_QUALITY, resolution=IMAGE_RESOLUTION, n=1,
                    response_format="b64_json", storage_options={"filename": f"ripple-{variant_id}.jpg", "public_url": True})
        data = self._post(path, body)
        cost = _cost(data)
        images = data.get("data") or []
        if not images:
            raise GrokError("xAI returned no image", cost_usd_ticks=cost)
        img = images[0]
        if not isinstance(img, dict):
            raise GrokError("xAI returned invalid image metadata", cost_usd_ticks=cost)
        if _filtered(img):
            raise GrokError("This take was filtered by xAI", filtered=True, cost_usd_ticks=cost)
        stored = img.get("file_output") or {}
        if stored.get("public_url"):
            return ImageResult(stored["public_url"], stored.get("file_id"), cost)
        # Requesting base64 and storage together provides a free fallback for partial storage failures.
        encoded = img.get("b64_json")
        if not encoded:
            raise GrokError("xAI did not return persistent storage or base64 output; temporary URLs are not retained", cost_usd_ticks=cost)
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise GrokError("xAI returned invalid base64 output", cost_usd_ticks=cost) from exc
        if not raw or len(raw) > 20_000_000:
            raise GrokError("generated asset size is invalid", cost_usd_ticks=cost)
        extension = ".png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else ".jpg"
        self.generated_dir.mkdir(parents=True, exist_ok=True)
        filename = variant_id + extension
        temporary = self.generated_dir / (filename + ".tmp")
        temporary.write_bytes(raw)
        temporary.replace(self.generated_dir / filename)
        return ImageResult(f"/generated/{filename}", stored.get("file_id"), cost)

    def generate(self, prompt, variant_id, aspect="1:1"):
        if aspect not in ASPECT_RATIOS:
            raise ValueError("unsupported aspect ratio")
        return self._image("images/generations", {"prompt": prompt, "aspect_ratio": aspect}, variant_id)

    def edit(self, prompt, variant_id, sources, aspect=None):
        if not 1 <= len(sources) <= 5:
            raise ValueError("an edit needs 1–5 image sources")
        if aspect is not None and aspect not in ASPECT_RATIOS:
            raise ValueError("unsupported aspect ratio")
        body = {"prompt": prompt}
        images = [{"url": source, "type": "image_url"} if isinstance(source, str) else source for source in sources]
        body.update({"image": images[0]} if len(images) == 1 else {"images": images})
        if aspect:
            body["aspect_ratio"] = aspect
        return self._image("images/edits", body, variant_id)
