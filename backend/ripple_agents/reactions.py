"""Ask the most relevant twins about each draft and aggregate their reactions."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import get_args

from twins.ask import ask_twin
from twins.models import Action, Twin, TwinAnswer
from twins.sync import load_twin

from .audience import LABELS, relevant_twin_ids
from .messages import ReactResult, VariantResult

ENGAGED = {"reply", "quote", "repost", "like"}
QUOTES_PER_VARIANT = 3


def _segment(twin: Twin) -> str:
    return LABELS.get(twin.persona.topics[0].topic, twin.persona.topics[0].topic) if twin.persona.topics else "Unknown"


def _aggregate(label: str, draft: str, twins: list[Twin], answers: list[TwinAnswer | None]) -> VariantResult:
    actions = Counter({a: 0 for a in get_args(Action)})
    seg_total: Counter = Counter()
    seg_engaged: Counter = Counter()
    quotes: list[tuple[float, str]] = []
    for twin, answer in zip(twins, answers):
        if answer is None:
            continue
        actions[answer.action] += 1
        seg = _segment(twin)
        seg_total[seg] += 1
        if answer.action in ENGAGED:
            seg_engaged[seg] += 1
            quotes.append((answer.confidence, f"@{twin.username} ({answer.action}): {answer.answer}"))
    done = [a for a in answers if a is not None]
    n = len(done)
    return VariantResult(
        label=label, draft=draft, responses=n, failed=len(answers) - n, actions=dict(actions),
        engagement_rate=sum(actions[a] for a in ENGAGED) / n if n else 0.0,
        avg_confidence=sum(a.confidence for a in done) / n if n else 0.0,
        segment_engagement={s: seg_engaged[s] / seg_total[s] for s in sorted(seg_total)},
        quotes=[q for _, q in sorted(quotes, reverse=True)[:QUOTES_PER_VARIANT]])


def react(stdb, client, brand: str, variants: list[str], niches: list[str], sample_size: int, question: str = "",
          *, workers: int = 8) -> ReactResult:
    # Every variant sees the same personas, so differences come from the post, not the sample.
    sample = relevant_twin_ids(stdb, brand, niches, sample_size, query=" ".join([*variants, question]))
    if not sample:
        return ReactResult(brand=brand, error=f"@{brand} has no personas yet")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        twins = list(pool.map(lambda uid: load_twin(stdb, uid), sample))

        def ask(pair: tuple[Twin, str]) -> TwinAnswer | None:
            try:
                return ask_twin(client, pair[0], pair[1], question)
            except Exception:  # one persona failing must not sink the variant
                return None

        results = []
        for i, draft in enumerate(variants):
            answers = list(pool.map(ask, [(t, draft) for t in twins]))
            results.append(_aggregate(chr(ord("A") + i), draft, twins, answers))
    return ReactResult(brand=brand, personas=len(twins), variants=results)


def render_report(result: ReactResult) -> str:
    lines = [f"**How @{result.brand}'s audience reacts**: the {result.personas} most relevant personas", "",
             "| Variant | Engaged | Reply | Quote | Repost | Like | Ignore | Model self-rating |",
             "|---|---|---|---|---|---|---|---|"]
    for v in result.variants:
        a = v.actions
        lines.append(f"| {v.label} | {v.engagement_rate:.0%} | {a.get('reply', 0)} | {a.get('quote', 0)} | "
                     f"{a.get('repost', 0)} | {a.get('like', 0)} | {a.get('ignore', 0)} | {v.avg_confidence:.2f} |")
    for v in result.variants:
        draft = v.draft if len(v.draft) <= 140 else v.draft[:139] + "…"
        lines += ["", f"**{v.label}**: \"{draft}\""]
        if v.failed:
            lines.append(f"- {v.failed} persona(s) failed to answer")
        top = sorted(v.segment_engagement.items(), key=lambda kv: -kv[1])[:4]
        if top:
            lines.append("- Top niches: " + ", ".join(f"{s} {r:.0%} engaged" for s, r in top))
        if v.quotes:
            lines.append("- Top responders:")
            lines += [f"  - {q}" for q in v.quotes]
    return "\n".join(lines)
