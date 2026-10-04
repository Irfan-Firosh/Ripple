"""The same saved Audience -> Concepts -> Test -> Launch flow as the web app."""
import time
from urllib.parse import urlencode, urljoin

from creative.company import company_context
from twins.stdb import sql_str

from .audience import find_brand
from .config import APP_URL
from .messages import CampaignRequest, CampaignResult


def campaign_url(brand, campaign_id):
    return f"{APP_URL}/campaign?{urlencode({'brand': brand, 'id': campaign_id, 'view': '1'})}"


def _rows(stdb, table, campaign_id):
    return stdb.sql(f"SELECT * FROM {table} WHERE campaign_id = {sql_str(campaign_id)}")


def flow(stdb, brand, campaign_id):
    rows = _rows(stdb, "campaign_flow", campaign_id)
    if not rows or rows[0]["brand"].lower() != brand.lower():
        raise ValueError("Choose a saved campaign for this audience first")
    return rows[0]


def concepts(stdb, campaign_id):
    ready = [v for v in _rows(stdb, "ad_variant", campaign_id) if v.get("status") == "ready" and v.get("image_url")]
    roots = sorted([v for v in ready if not v.get("parent_variant_id")], key=lambda v: (v.get("job_id", 0), v["variant_id"]))[:2]
    selected = []
    for root in roots:
        current = root
        for _ in ready:
            children = [v for v in ready if v.get("parent_variant_id") == current["variant_id"]]
            if not children:
                break
            current = max(children, key=lambda v: (v.get("job_id", 0), v["variant_id"]))
        selected.append(current)
    return selected


def discover(stdb, brand):
    from .creative import ensure_brand_kit
    user = find_brand(stdb, brand)
    ensure_brand_kit(stdb, user, "Explore recent company news")
    kit = stdb.sql(f"SELECT * FROM brand_kit WHERE brand_user_id = {sql_str(user['user_id'])}")[0]
    context = company_context(stdb, user["username"], kit["display_name"])
    lines = [f"**{kit['display_name']} · company research**", kit["product_description"]]
    if context.get("homepage"):
        lines.append(f"[Company website]({context['homepage']})")
    lines += [f"- [{n['title']}]({n['url']}) · {n['date']}\n  {n['summary']}" for n in context.get("news", [])]
    if not context.get("news"):
        lines.append("No recent dated news was found. Supply your launch news when generating a campaign.")
    for post in context.get("best_posts", [])[:3]:
        lines.append(f"- Recent brand post ({post['likes']} likes): {post['text']}")
    baselines = stdb.sql(f"SELECT * FROM brand_baseline WHERE brand_user_id = {sql_str(user['user_id'])}")
    if baselines:
        lines.append(f"Simulation scale is anchored to {baselines[0]['posts']} historical posts. "
                     "This is a baseline adjustment, not a held-out accuracy score.")
    return CampaignResult(brand=brand, summary="\n\n".join(lines))


def snapshot(stdb, brand, campaign_id):
    row = flow(stdb, brand, campaign_id)
    variants = concepts(stdb, campaign_id)
    copies = {r["draft"]: r for r in _rows(stdb, "draft_copy", campaign_id)}
    drafts = [row["draft_a"], row["draft_b"]] if row["source"] == "import" else [
        copies.get(d, {}).get("text", "") if copies.get(d, {}).get("status") == "done" else "" for d in ("A", "B")]
    lines = [f"**@{brand} · campaign {row['stage']}**"]
    for label, text in zip(("A", "B"), drafts):
        lines.append(f"**{label}:** {text or 'Post copy is still being written.'}")
    urls = {}
    for link in _rows(stdb, "campaign_draft_video", campaign_id):
        videos = stdb.sql(f"SELECT * FROM campaign_video WHERE video_id = {sql_str(link['video_id'])}")
        if not videos:
            continue
        video = videos[0]
        if video["status"] == "done" and video.get("video_url"):
            urls[link["draft"]] = urljoin(APP_URL + "/", video["video_url"])
            lines.append(f"[Draft {link['draft']} video]({urls[link['draft']]})")
        else:
            lines.append(f"Draft {link['draft']} video: {video['status']} · {video.get('progress', 0):.0%}"
                         + (f" · {video.get('error')}" if video.get("error") else ""))
    if row.get("winner_text"):
        lines.append(f"**Approved post:** {row['winner_text']}")
        lines.append(f"[Open X composer]({'https://x.com/intent/post?' + urlencode({'text': row['winner_text']})})")
    lines.append(f"[Open campaign]({campaign_url(brand, campaign_id)})")
    return CampaignResult(brand=brand, campaign_id=campaign_id, summary="\n\n".join(lines), drafts=drafts,
                          image_urls=[urljoin(APP_URL + "/", v["image_url"]) for v in variants[:2]],
                          variant_ids=[v["variant_id"] for v in variants[:2]], video_urls=urls, stage=row["stage"])


def prepare(stdb, brand, campaign_id, *, timeout=600):
    """Write actual brand-voice posts using the current copy worker; never simulate image headlines as finished copy."""
    from video.copywriter import make_writer, run_pending_copy
    from video.pipeline import opus_client
    flow(stdb, brand, campaign_id)
    variants = concepts(stdb, campaign_id)
    if len(variants) < 2:
        raise ValueError("Two ready image concepts are needed; the campaign remains saved")
    for draft, variant in zip(("A", "B"), variants):
        stdb.call("request_draft_copy", campaign_id, draft, variant["headline"][:200])
    writer = make_writer(stdb, opus_client())
    deadline = time.monotonic() + timeout
    while True:
        run_pending_copy(stdb, write=writer, campaign_id=campaign_id)
        copies = _rows(stdb, "draft_copy", campaign_id)
        failed = [c for c in copies if c["status"] == "failed"]
        if failed:
            raise RuntimeError(failed[0].get("error") or "Post writing failed; check campaign progress to retry")
        if len(copies) == 2 and all(c["status"] == "done" and c["text"] for c in copies):
            return snapshot(stdb, brand, campaign_id)
        if time.monotonic() >= deadline:
            raise TimeoutError("Post writing is still running. Check campaign progress to continue.")
        time.sleep(.5)


def execute(stdb, request: CampaignRequest):
    brand, cid = request.brand, request.campaign_id
    if request.action == "discover":
        return discover(stdb, brand)
    if request.action == "import":
        if len(request.drafts) != 2 or any(not d.strip() or len(d) > 280 for d in request.drafts):
            raise ValueError("Import two nonempty posts of at most 280 characters each")
        stdb.call("start_campaign_flow", cid, brand, "import", *request.drafts)
    elif request.action == "prepare":
        return prepare(stdb, brand, cid)
    else:
        row = flow(stdb, brand, cid)
        if request.action == "status":
            return snapshot(stdb, brand, cid)
        if request.action == "video":
            current = snapshot(stdb, brand, cid)
            if not all(current.drafts):
                raise ValueError("Wait for both posts to finish before making videos")
            for draft, text in zip(("A", "B"), current.drafts):
                stdb.call("request_draft_video", cid, draft, text, "reach")
        elif request.action == "edit_video":
            links = _rows(stdb, "campaign_draft_video", cid)
            link = next((l for l in links if l["draft"] == request.draft), None)
            if not link or not request.instruction.strip():
                raise ValueError("Choose draft A or B with a finished video and describe the edit")
            stdb.call("request_video_edit", link["video_id"], request.instruction, "")
        elif request.action == "approve":
            exp = next((r for r in stdb.sql("SELECT * FROM lab_experiment")
                        if int(r["experiment_id"]) == int(row["experiment_id"])), None)
            if not exp or exp["status"] != "done" or request.draft not in {"A", "B"}:
                raise ValueError("Finish testing, then choose draft A or B to approve")
            links = _rows(stdb, "campaign_draft_video", cid)
            video_id = next((l["video_id"] for l in links if l["draft"] == request.draft), "")
            stdb.call("update_campaign_flow", cid, "approved", 0, video_id, exp[f"draft_{request.draft.lower()}"])
        else:
            raise ValueError("Unsupported campaign action")
    return snapshot(stdb, brand, cid)
