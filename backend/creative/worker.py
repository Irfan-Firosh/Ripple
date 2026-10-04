"""Claimed job execution with incremental variants, four image threads and safe recovery."""
import base64
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

from twins.stdb import StdbError, opt, sql_str

from .brand_kits import load_brand_kit
from .brief import brand_context, sanitize_brief, synthesize_brief
from .config import IMAGE_QUALITY, MAX_IMAGE_WORKERS
from .grok import GENERATED_DIR, GrokError
from .models import CreativeBrief, IMAGE_MODEL, TEXT_MODEL
from .prompts import concepts_for_brief, edit_prompt, safe_image_prompt, validate_tweak_prompt
from .segments import aggregate_segments

LOG = logging.getLogger(__name__)
TERMINAL = {"ready", "filtered", "failed"}
VARIANT_FIELDS = ("job_id", "variant_id", "campaign_id", "brief_id", "parent_variant_id", "root_variant_id", "depth",
                  "operation", "instruction", "image_prompt", "headline", "cta", "aspect_ratio", "model", "quality",
                  "status", "image_url", "xai_file_id", "cost_usd_ticks", "error")
OPTION_FIELDS = {"parent_variant_id", "instruction", "image_url", "xai_file_id", "error"}

WORKER_VERSION = 2  # the database refuses claims from older workers (claim_creative_job)


@dataclass
class WorkerStats:
    claimed: int = 0
    done: int = 0
    failed: int = 0
    cost_usd_ticks: int = 0
    errors: list[str] = field(default_factory=list)


def _one(stdb, table, field, value):
    rows = stdb.sql(f"SELECT * FROM {table} WHERE {field} = {sql_str(str(value))}")
    if not rows:
        raise ValueError(f"{table} row is missing")
    return rows[0]


def _publish_brief(stdb, job, campaign, segment, brief, version):
    brief_id = f"{campaign['campaign_id']}:{segment.slug}:{version}"
    def themes(values):
        # HTTP reducer SATS names are normalized to snake_case, including nested structs.
        return [{"text": t.text, "support": t.support, "twin_ids": t.twin_ids} for t in values]
    evidence = json.dumps({"key_interests": [t.model_dump() for t in brief.key_interests],
                           "avoid": [t.model_dump() for t in brief.avoid]})
    stdb.call("publish_brief", job["job_id"], brief_id, campaign["campaign_id"], segment.slug, version,
              brief.audience_label, segment.share, segment.twin_count, themes(brief.key_interests), themes(brief.avoid),
              brief.tone, brief.message_angle, brief.value_props, brief.headline_options, brief.cta, brief.visual_cues,
              brief.visual_avoid, brief.format, TEXT_MODEL, opt(evidence))
    return brief_id


def _brief_model(row):
    fields = set(CreativeBrief.model_fields)
    payload = {key: row[key] for key in fields}
    for key in ("key_interests", "avoid"):
        payload[key] = [{"text": t["text"], "support": t["support"], "twin_ids": t.get("twin_ids", t.get("twinIds", []))} for t in payload[key]]
    return CreativeBrief.model_validate(payload)


def _upsert(stdb, row):
    stdb.call("upsert_variant", *(opt(row[key]) if key in OPTION_FIELDS else row[key] for key in VARIANT_FIELDS))


def _source(parent, kit, generated_dir):
    if parent.get("xai_file_id"):
        return {"file_id": parent["xai_file_id"]}
    url = parent.get("image_url") or ""
    if url.startswith("/generated/"):
        filename = url.removeprefix("/generated/")
        path = Path(generated_dir) / filename
        if Path(filename).name != filename or path.suffix not in {".jpg", ".png"}:
            raise ValueError("invalid locally generated parent asset")
        mime = "image/png" if path.suffix == ".png" else "image/jpeg"
        return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()
    # Only generated CDN output is allowed as a parent, never a follower avatar or arbitrary URL.
    if not url.startswith("https://files-cdn.x.ai/"):
        raise ValueError("parent image must be a persistent generated asset")
    return url


def _variant(job, campaign, brief_id, index, prompt, headline, cta, *, parent=None, aspect=None):
    variant_id = f"creative-{job['job_id']}-{index}"
    return dict(job_id=job["job_id"], variant_id=variant_id, campaign_id=campaign["campaign_id"], brief_id=brief_id,
                parent_variant_id=parent["variant_id"] if parent else None,
                root_variant_id=parent["root_variant_id"] if parent else variant_id,
                depth=parent["depth"] + 1 if parent else 0, operation=job["kind"], instruction=job.get("instruction"),
                image_prompt=prompt, headline=headline, cta=cta, aspect_ratio=aspect or campaign["aspect_ratio"],
                model=IMAGE_MODEL, quality=IMAGE_QUALITY, status="generating", image_url=None, xai_file_id=None,
                cost_usd_ticks=0, error=None)


def _image_task(client, row, sources):
    started = time.monotonic()
    LOG.info("Take %s: requesting Grok image %s", row["variant_id"], "edit" if sources else "generation")
    try:
        result = client.edit(row["image_prompt"], row["variant_id"], sources, row["aspect_ratio"]) if sources else \
            client.generate(row["image_prompt"], row["variant_id"], row["aspect_ratio"])
        LOG.info("Take %s: image ready in %.1fs", row["variant_id"], time.monotonic() - started)
        return {**row, "status": "ready", "image_url": result.image_url,
                "xai_file_id": result.file_id, "cost_usd_ticks": result.cost_usd_ticks}
    except GrokError as exc:
        LOG.warning("Take %s: %s after %.1fs", row["variant_id"], str(exc), time.monotonic() - started)
        return {**row, "status": "filtered" if exc.filtered else "failed", "error": str(exc)[:300], "cost_usd_ticks": exc.cost_usd_ticks}
    except Exception:
        LOG.warning("Take %s: image request failed after %.1fs", row["variant_id"], time.monotonic() - started)
        # Provider/request exceptions can embed secrets or base64; persist a safe generic error.
        return {**row, "status": "failed", "error": "Image generation failed; check worker diagnostics"}


def _execute_images(stdb, client, rows_and_sources, existing):
    jobs = []
    cost = 0
    errors = []
    for row, sources in rows_and_sources:
        previous = existing.get(row["variant_id"])
        if previous:
            if previous["status"] in TERMINAL:
                if previous["status"] != "ready":
                    errors.append(previous.get("error") or "One take did not finish")
                continue
            # Never repeat a request which may have already been accepted/billed by xAI.
            interrupted = {**row, **{k: previous[k] for k in VARIANT_FIELDS if k in previous},
                           "status": "failed", "error": "Previous worker interrupted; provider output status unknown"}
            _upsert(stdb, interrupted)
            errors.append(interrupted["error"])
            continue
        _upsert(stdb, row)  # subscription clients see a skeleton before any paid request
        jobs.append((row, sources))
    with ThreadPoolExecutor(max_workers=MAX_IMAGE_WORKERS) as executor:
        pending = {executor.submit(_image_task, client, row, sources): row for row, sources in jobs}
        for future in as_completed(pending):
            completed = future.result()
            cost += completed["cost_usd_ticks"]
            try:
                _upsert(stdb, completed)
            except StdbError:
                # Settle every already-billed future even if one result write fails.
                errors.append("Could not persist one image result; provider output may have been billed")
                continue
            if completed["status"] != "ready":
                errors.append(completed["error"] or "One take did not finish")
    return cost, errors


def process_job(stdb, client, job):
    """Execute one already-claimed job; return new image cost and safe error messages."""
    campaign = _one(stdb, "campaign", "campaign_id", job["campaign_id"])
    kit = load_brand_kit(stdb, campaign["brand_user_id"])
    existing_briefs = stdb.sql(f"SELECT * FROM creative_brief WHERE campaign_id = {sql_str(job['campaign_id'])}")
    if job["kind"] == "brief":
        LOG.info("Job %s: reading audience signals", job["job_id"])
        prefix = campaign["campaign_id"] + ":"
        target = job["target_id"]
        slug = target[len(prefix):].rsplit(":", 1)[0] if target.startswith(prefix) else target
        segment = aggregate_segments(stdb, campaign["brand_user_id"], [slug])[0]
        if any(b["segment"] == segment.slug for b in existing_briefs):
            return 0, []
        LOG.info("Job %s: requesting Grok brief for %s (%s personas)", job["job_id"], segment.slug, segment.twin_count)
        context = brand_context(stdb, campaign["brand_user_id"], kit)
        LOG.info("Job %s: grounding the brief in %s recent items", job["job_id"], len((context or {}).get("news", [])) + len((context or {}).get("best_posts", [])))
        brief = synthesize_brief(client, segment, kit, goal=campaign["goal"], offer=campaign.get("offer"), context=context)
        _publish_brief(stdb, job, campaign, segment, brief, 1)
        LOG.info("Job %s: brief published", job["job_id"])
        return 0, []
    existing = {r["variant_id"]: r for r in stdb.sql(f"SELECT * FROM ad_variant WHERE campaign_id = {sql_str(job['campaign_id'])}")}
    aspect = job.get("aspect_ratio") or campaign["aspect_ratio"]
    if job["kind"] == "generate":
        row = _one(stdb, "creative_brief", "brief_id", job["target_id"])
        if row["campaign_id"] != campaign["campaign_id"]:
            raise ValueError("brief must belong to this campaign")
        # User-edited briefs must pass the same guardrails and evidence math as model output.
        segment = aggregate_segments(stdb, campaign["brand_user_id"], [row["segment"]])[0]
        brief = _brief_model(row)
        # Stored citations use real IDs. Translate to the ephemeral aliases before revalidation.
        inverse = {uid: alias for alias, uid in segment.evidence_ids.items()}
        for theme in brief.key_interests + brief.avoid:
            theme.twin_ids = [inverse[uid] for uid in theme.twin_ids if uid in inverse]
        brief = sanitize_brief(brief, segment, kit)
        count = job.get("reserved_variants") or campaign["variants_per_brief"]
        expected = [f"creative-{job['job_id']}-{index}" for index in range(count)]
        if all(vid in existing for vid in expected):
            # Recovered job never needs another text or image request.
            concepts = None
        else:
            LOG.info("Job %s: requesting %s image concepts from Grok", job["job_id"], count)
            concepts = concepts_for_brief(client, brief, kit, count, aspect)
        work = []
        for index, vid in enumerate(expected):
            if vid in existing:
                work.append((existing[vid], []))
            else:
                concept = concepts[index]
                work.append((_variant(job, campaign, row["brief_id"], index, concept.image_prompt, concept.headline, concept.cta, aspect=aspect), []))
    else:
        if job["kind"] not in {"edit", "regenerate", "resize", "branch", "retarget", "tweak", "tweak_prompt"}:
            raise ValueError("unknown creative operation")
        parent = _one(stdb, "ad_variant", "variant_id", job["target_id"])
        if parent["campaign_id"] != campaign["campaign_id"] or parent["status"] != "ready":
            raise ValueError("parent must be a ready variant in this campaign")
        aspect = job.get("aspect_ratio") or parent["aspect_ratio"]
        sources = []
        if job["kind"] == "regenerate":
            prompt = parent["image_prompt"]  # exact previous prompt, same endpoint, a new take
            original = parent
            seen = set()
            while original.get("operation") == "regenerate" and original.get("parent_variant_id"):
                if original["variant_id"] in seen:
                    raise ValueError("invalid cyclic variant lineage")
                seen.add(original["variant_id"])
                original = _one(stdb, "ad_variant", "variant_id", original["parent_variant_id"])
            if original.get("operation") in {"edit", "branch", "resize", "retarget"}:
                source_parent = _one(stdb, "ad_variant", "variant_id", original["parent_variant_id"])
                sources = [_source(source_parent, kit, getattr(client, "generated_dir", GENERATED_DIR))]
                if original["operation"] == "branch":
                    sources += kit.reference_image_urls[:4]
        elif job["kind"] in {"tweak", "tweak_prompt"}:
            prompt = safe_image_prompt(validate_tweak_prompt(job.get("instruction") or "", kit), kit, aspect)
        else:
            prompt = edit_prompt(job.get("instruction"), kit, aspect, operation=job["kind"])
            sources = [_source(parent, kit, getattr(client, "generated_dir", GENERATED_DIR))]
            if job["kind"] == "branch":
                if not kit.reference_image_urls:
                    raise ValueError("brand kit has no brand-owned reference images")
                sources += kit.reference_image_urls[:4]
        variant = _variant(job, campaign, parent["brief_id"], 0, prompt, parent["headline"], parent["cta"], parent=parent, aspect=aspect)
        if job["kind"] in {"tweak", "tweak_prompt"}:
            variant["operation"] = "generate"
        work = [(variant, sources)]
    return _execute_images(stdb, client, work, existing)


class _Heartbeat:
    def __init__(self, stdb, job_id):
        self.stdb, self.job_id = stdb, job_id
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop.wait(30):
            try:
                self.stdb.call("heartbeat_creative_job", self.job_id)
                LOG.info("Job %s: still working; heartbeat received", self.job_id)
            except StdbError:
                LOG.warning("creative job heartbeat failed for job %s", self.job_id)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=1)


def process_pending(stdb, client, *, campaign_id=None, reset_stale=False):
    """Drain the current pending snapshot, optionally restricted to one campaign. Does not poll."""
    if reset_stale:
        stdb.call("reset_stale_creative_jobs")
    rows = stdb.sql("SELECT * FROM creative_job WHERE status = 'pending'")
    stats = WorkerStats()
    for job in sorted(rows, key=lambda row: row["job_id"]):
        if campaign_id and job["campaign_id"] != campaign_id:
            continue
        try:
            stdb.call("claim_creative_job", job["job_id"], WORKER_VERSION)
        except StdbError:
            continue  # atomic claim lost to another worker; never process it
        stats.claimed += 1
        started = time.monotonic()
        LOG.info("Job %s: %s started (campaign %s)", job["job_id"], job["kind"], job["campaign_id"])
        try:
            with _Heartbeat(stdb, job["job_id"]):
                cost, errors = process_job(stdb, client, job)
            stats.cost_usd_ticks += cost
            if errors:
                LOG.warning("Job %s: %s", job["job_id"], errors[0])
                stdb.call("fail_creative_job", job["job_id"], errors[0][:300])
                stats.failed += 1
                stats.errors.extend(errors)
            else:
                stdb.call("finish_creative_job", job["job_id"])
                stats.done += 1
        except Exception as exc:
            # Do not log exception repr: requests/SQL failures can include sensitive input.
            error = str(exc)[:300] if isinstance(exc, (ValueError, GrokError)) else "Creative job failed; check worker diagnostics"
            stats.errors.append(error)
            LOG.warning("Job %s: %s", job["job_id"], error)
            stats.failed += 1
            try:
                stdb.call("fail_creative_job", job["job_id"], error)
            except StdbError:
                LOG.warning("could not mark creative job %s failed", job["job_id"])
        LOG.info("Job %s: settled in %.1fs; image cost ticks=%s", job["job_id"], time.monotonic() - started, stats.cost_usd_ticks)
    return stats


def run_worker(stdb, client, *, once=False, poll_seconds=2.0, max_loops=None, campaign_id=None):
    if poll_seconds < 0:
        raise ValueError("poll interval cannot be negative")
    total = WorkerStats()
    stdb.call("reset_stale_creative_jobs")
    from twins.ops_pause import PauseWatch, guarded, nap
    watch = PauseWatch(stdb) if once or max_loops is not None else PauseWatch(stdb).start()

    def step() -> None:
        stats = process_pending(stdb, client, campaign_id=campaign_id)
        for key in ("claimed", "done", "failed", "cost_usd_ticks"):
            setattr(total, key, getattr(total, key) + getattr(stats, key))
        total.errors.extend(stats.errors)
    loops = 0
    while True:
        guarded(watch, step)
        loops += 1
        if once or (max_loops is not None and loops >= max_loops):
            return total
        nap(watch, time.sleep, poll_seconds)


answer_pending = process_pending
