"""The fixed niche catalog every twin is rated against, so niches are comparable across people.

Derived on 2026-10-03 from the @spacetimedb audience: Claude's 438 free-text labels from run 2 plus
X's own context annotations, merged into 20 niches and a catch-all.
"""
from typing import NamedTuple


class Niche(NamedTuple):
    slug: str
    label: str
    description: str


NICHES: tuple[Niche, ...] = (
    Niche("ai_llms", "AI models & LLMs", "Frontier models, benchmarks, OpenAI / Anthropic / Grok / open-weight releases"),
    Niche("ai_agents_tools", "AI agents & AI tooling", "Coding assistants, agents, automation and AI-powered workflows"),
    Niche("game_dev", "Game development", "Making games: engines, indie dev, game design, 3D and game art"),
    Niche("gaming", "Playing games", "Playing and following games, esports, speedruns, gaming culture"),
    Niche("web_frontend", "Web & frontend", "JavaScript/TypeScript, React and UI frameworks, browsers, web apps"),
    Niche("backend_infra", "Backend, databases & cloud", "Servers, databases, real-time systems, cloud, DevOps, infrastructure"),
    Niche("dev_tools", "Developer tools", "IDEs, terminals, SDKs, APIs and the tools developers work with"),
    Niche("software_craft", "Software engineering craft", "Languages, code quality, debugging, testing, system design"),
    Niche("open_source", "Open source & Linux", "Open-source projects and communities, Linux, self-hosting"),
    Niche("mobile_desktop", "Mobile & desktop apps", "iOS/Android, Flutter, native and desktop applications"),
    Niche("design_creative", "Design & creative work", "UI/UX, design systems, 3D/VFX, art, photography, music production"),
    Niche("startups_product", "Startups & product building", "Founders, shipping and launching products, pricing, fundraising"),
    Niche("business_finance", "Business, markets & fintech", "Companies, economics, markets, banking and payments"),
    Niche("crypto_web3", "Crypto, DeFi & web3", "Tokens, DeFi protocols, Solana/Ethereum, trading, web3 gaming"),
    Niche("hardware_robotics", "Hardware, robotics & XR", "Chips and GPUs, homelabs, keyboards, robotics, AR/VR"),
    Niche("tech_industry", "Tech industry news", "Big tech companies, platform policy, tech personalities and trends"),
    Niche("dev_community", "Developer community & careers", "Hackathons, events, learning in public, mentoring, jobs"),
    Niche("politics_society", "Politics & society", "Elections, governments, social issues and commentary"),
    Niche("sports", "Sports", "Football, basketball, motorsport and other sports"),
    Niche("culture_lifestyle", "Culture & lifestyle", "Entertainment, books, music, K-pop, food, travel, humour, personal life"),
    Niche("other", "Other", "Only when none of the niches above fit"),
)

NICHE_SLUGS: tuple[str, ...] = tuple(n.slug for n in NICHES)
_BY_KEY = {key: n.slug for n in NICHES for key in (n.slug, n.label.lower())}


def normalize_niche(value):
    """Map a slug or label in any case to its slug; leave anything else for validation to reject."""
    if isinstance(value, str):
        return _BY_KEY.get(value.strip().lower(), value)
    return value


def catalog_text() -> str:
    return "\n".join(f"{n.slug}: {n.label} ({n.description})" for n in NICHES)
