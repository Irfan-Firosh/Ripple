"""Small ASI:One cards for the main onboarding, audience and Lab workflow."""
import json
import re
from pathlib import Path

from uagents_core.contrib.protocols.chat import MetadataContent

from .asi1 import CampaignPlan, topic_niches
from .config import CARD_ASSET_URL

BUTTON_IMAGES = json.loads(Path(__file__).with_name("button_labels.json").read_text())


def card(kind, payload):
    return MetadataContent(type="metadata", metadata={
        "card_protocol_version": "1", "requires_card_interaction": "true",
        "card_kind": kind, "card_payload": json.dumps(payload)})


def button(label, action, **values):
    # ASI:One styles native buttons itself. Selectable image items retain the
    # same action while rendering our compact background and white label.
    if label not in BUTTON_IMAGES:
        return {"type": "button", "label": label, "action": {"selection": {"action": action, **values}}}
    return {"type": "list", "items": [{"children": [{"type": "image",
        "src": f"{CARD_ASSET_URL}/{BUTTON_IMAGES[label]}.png", "alt": label, "aspect_ratio": "25:3"}],
        "action": {"selection": {"action": action, **values}}}]}


def menu(brand=None):
    return card("custom", {"root": {"type": "section", "title": "Ripple · before you post", "children": [
        button("Build an X audience", "onboard_form"), button("Test a post / compare two", "test_form", brand=brand),
        button("Explore an audience", "audience_form", brand=brand), button("Research company", "discover_form", brand=brand),
        button("Generate campaign", "campaign_form", brand=brand)]}})


def form(action, brand="", **values):
    if action == "onboard":
        brand = ""
    label = f"Audience (leave blank to keep @{brand})" if brand else "X handle (or an existing Bluesky handle)"
    fields = [{"name": "brand", "kind": "text", "label": label, "required": not bool(brand)}]
    if action == "react":
        fields += [{"name": "draft_a", "kind": "text", "label": "Post A", "required": True},
                   {"name": "draft_b", "kind": "text", "label": "Post B (optional)"}]
    elif action == "audience":
        fields += [{"name": "question", "kind": "text", "label": "Topic to explore (optional)"}]
    elif action == "create":
        fields += [{"name": "goal", "kind": "text", "label": "What are you promoting?", "required": True},
                   {"name": "offer", "kind": "text", "label": "Offer or call to action (optional)"}]
    elif action == "edit_video":
        fields += [{"name": "draft", "kind": "text", "label": "Draft A or B", "required": True},
                   {"name": "instruction", "kind": "text", "label": "What should change?", "required": True}]
    elif action == "edit_image":
        fields += [{"name": "instruction", "kind": "text", "label": "What should change?", "required": True}]
    titles = {"react": "Test your post", "audience": "Explore your audience", "create": "Generate campaign",
              "discover": "Research your company", "edit_video": "Edit campaign video", "edit_image": "Edit image",
              "onboard": "Build your X audience"}
    # ASI merges static selections after input values. Keep the default under
    # audience so an entered brand can override it, with blank inputs falling back.
    return card("custom", {"root": {"type": "section", "title": titles[action], "children": [
        *[{"type": "input", **field} for field in fields],
        button("Build audience" if action == "onboard" else "Continue", action, audience=brand, **values)]}})


def selection(text):
    # ASI:One can prefix a direct card selection with the recipient mention.
    # Strip only that leading address; preserve every submitted field verbatim.
    if isinstance(text, str):
        text = re.sub(r"^(?:\s*@(?:ripple|(?:test-)?agent1[a-z0-9]+)\b\s*)+", "", text, flags=re.I)
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if isinstance(data, dict):
        nested = data.get("selection")
        if isinstance(data.get("action"), dict):
            nested = data["action"].get("selection")
        if isinstance(nested, dict):
            submitted = {k: v for k, v in data.items() if k != "selection" and not (k == "action" and isinstance(v, dict))}
            data = {**nested, **submitted}
        if isinstance(data.get("values"), dict):
            data = {**data, **data["values"]}
        if not data.get("brand") and isinstance(data.get("audience"), str):
            data["brand"] = data["audience"]
    return data if isinstance(data, dict) else None


def submission(text):
    data = selection(text)
    if not isinstance(data, dict) or data.get("action") not in {"react", "audience", "create", "discover", "campaign_status", "test_campaign", "video", "edit_video", "approve", "edit_image", "onboard", "status", "retry"}:
        return None
    values = {k: v for k, v in data.items() if k in CampaignPlan.model_fields}
    if "draft" in values and isinstance(values["draft"], str):
        values["draft"] = values["draft"].strip().upper()
    if data["action"] == "react":
        values["variants"] = [data[k] for k in ("draft_a", "draft_b") if isinstance(data.get(k), str) and data[k].strip()]
    elif data["action"] == "audience" and data.get("question") and not values.get("niches"):
        values["niches"] = topic_niches(data["question"])
    return CampaignPlan.model_validate(values)


def onboarding(row, *, can_resume=False):
    brand, status = row["handle"], row["status"]
    labels = {"queued": "Waiting to start", "scraping": "Reading X followers and posts", "twins": "Building audience personas",
              "graph": "Mapping the audience", "ready": "Audience ready", "failed": "Build could not finish"}
    children = [{"type": "text", "value": labels.get(status, status)}]
    if row.get("error"):
        children.append({"type": "text", "value": row["error"]})
    if status == "ready":
        if can_resume:
            children.append(button("Continue my request", "resume", brand=brand))
        children += [button("Explore this audience", "audience", brand=brand), button("Test a post", "test_form", brand=brand)]
        children.append(button("Refresh audience", "onboard", brand=brand, refresh=True))
    elif status == "failed":
        children.append(button("Retry build", "retry", brand=brand))
    else:
        children.append(button("Check progress", "status", brand=brand))
    children.append(button("Back to menu", "menu"))
    return card("custom", {"root": {"type": "section", "title": f"@{brand} · X audience", "children": children}})


def next_steps(brand):
    return card("custom", {"root": {"type": "section", "title": f"@{brand} · next steps", "children": [
        button("Explore this audience", "audience", brand=brand),
        button("Test another post / compare two", "test_form", brand=brand), button("Generate campaign", "campaign_form", brand=brand),
        button("Research company", "discover", brand=brand),
        button("Back to menu", "menu")]}})


def persona_upgrade(order, next_card):
    from .payments import PRICE_FET, TARGET_PERSONAS
    payload = json.loads(next_card.metadata["card_payload"])
    payload["root"]["children"].append({"type": "section", "title": "Want more persona feedback?", "children": [
        {"type": "text", "value": f"You interviewed {order['personas']} personas. Try the {TARGET_PERSONAS}-persona "
         "upgrade checkout with test FET. Demo only: expanded processing is not enabled."},
        button(f"Expand to {TARGET_PERSONAS} · {PRICE_FET} test FET", "buy_persona_upgrade", reference=order["reference"]),
        button("No thanks, continue", "skip_persona_upgrade", reference=order["reference"])]})
    return card("custom", payload)


def creatives(brand, variants):
    children = []
    for i, variant in enumerate(variants):
        draft = "\n".join(s for s in (variant.get("headline", ""), variant.get("cta", "")) if s).strip()
        preview = [{"type": "image", "src": variant["image_url"], "alt": f"Concept {i + 1}",
                    "aspect_ratio": variant.get("aspect_ratio", "1:1")}] if variant.get("image_url") else []
        children.append({"type": "section", "title": f"Concept {i + 1}", "children": [
            *preview,
            {"type": "text", "value": draft or "Image concept"},
            button("Test this post", "react", brand=brand, draft_a=draft)] if draft else [
            {"type": "text", "value": "Add post copy with Test another post to simulate this concept."}]})
    children += [button("Test another post / compare two", "test_form", brand=brand), button("Back to menu", "menu")]
    return card("custom", {"root": {"type": "section", "title": f"@{brand} · campaign concepts", "children": children}})


def loading(brand, stage, completed, total=3):
    filled = min(12, max(0, round(12 * completed / total)))
    bar = "█" * filled + "░" * (12 - filled)
    result = card("custom", {"root": {"type": "section", "title": f"@{brand} · simulation", "children": [
        {"type": "text", "value": stage},
        {"type": "text", "value": f"{bar}  {completed}/{total} steps complete"}]}})
    result.metadata["requires_card_interaction"] = "false"
    return result


def campaign(result):
    values = {"brand": result.brand, "campaign_id": result.campaign_id}
    children = []
    for i, text in enumerate(result.drafts):
        draft = chr(65 + i)
        section = [{"type": "text", "value": text or "Writing post copy…"}]
        if i < len(result.image_urls):
            section.insert(0, {"type": "image", "src": result.image_urls[i], "alt": f"Draft {draft}", "aspect_ratio": "16:9"})
        if i < len(result.variant_ids):
            section.append(button(f"Edit image {draft}", "edit_image_form", variant_id=result.variant_ids[i], **values))
        children.append({"type": "section", "title": f"Draft {draft}", "children": section})
    if result.stage == "testing":
        children += [button(f"Approve {d}", "approve", draft=d, **values) for d in ("A", "B")]
    if all(result.drafts) and len(result.drafts) == 2:
        children.append(button("Test both drafts", "test_campaign", **values))
        children.append(button("Make campaign videos", "video", **values))
    if result.video_urls:
        children.append(button("Edit a video", "edit_video_form", **values))
    children += [button("Check campaign progress", "campaign_status", **values), button("Back to menu", "menu")]
    return card("custom", {"root": {"type": "section", "title": f"@{result.brand} · campaign", "children": children}})
