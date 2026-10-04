"""Small ASI:One cards for the main onboarding, audience and Lab workflow."""
import json

from uagents_core.contrib.protocols.chat import MetadataContent

from .asi1 import CampaignPlan, topic_niches


def card(kind, payload):
    return MetadataContent(type="metadata", metadata={
        "card_protocol_version": "1", "requires_card_interaction": "true",
        "card_kind": kind, "card_payload": json.dumps(payload)})


def button(label, action, **values):
    return {"type": "button", "label": label, "action": {"selection": {"action": action, **values}}}


def menu(brand=None):
    return card("custom", {"root": {"type": "section", "title": "Ripple · before you post", "children": [
        button("Build an X audience", "onboard_form"), button("Test a post / compare two", "test_form", brand=brand),
        button("Explore an audience", "audience_form", brand=brand), button("Create campaign images", "campaign_form", brand=brand)]}})


def form(action, brand=""):
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
    titles = {"react": "Test your post", "audience": "Explore your audience", "create": "Create campaign images",
              "onboard": "Build your X audience"}
    return card("form", {"title": titles[action], "fields": fields,
        "submit_cta": {"label": "Build audience" if action == "onboard" else "Continue", "selection": {"action": action, "brand": brand}}})


def selection(text):
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if isinstance(data, dict):
        nested = data.get("selection")
        if isinstance(data.get("action"), dict):
            nested = data["action"].get("selection")
        if isinstance(nested, dict):
            data = {**data, **nested}
    return data if isinstance(data, dict) else None


def submission(text):
    data = selection(text)
    if not isinstance(data, dict) or data.get("action") not in {"react", "audience", "create", "onboard", "status", "retry"}:
        return None
    values = {k: v for k, v in data.items() if k in CampaignPlan.model_fields}
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
    elif status == "failed":
        children.append(button("Retry build", "retry", brand=brand))
    else:
        children.append(button("Check progress", "status", brand=brand))
    children.append(button("Back to menu", "menu"))
    return card("custom", {"root": {"type": "section", "title": f"@{brand} · X audience", "children": children}})


def next_steps(brand):
    return card("custom", {"root": {"type": "section", "title": f"@{brand} · next steps", "children": [
        button("Explore this audience", "audience", brand=brand),
        button("Test another post", "test_form", brand=brand), button("Create campaign images", "campaign_form", brand=brand),
        button("Back to menu", "menu")]}})


def creatives(brand, variants):
    children = []
    for i, variant in enumerate(variants):
        draft = "\n".join(s for s in (variant.get("headline", ""), variant.get("cta", "")) if s).strip()
        children.append({"type": "section", "title": f"Concept {i + 1}", "children": [
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
