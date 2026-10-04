"""Simulation settings the hidden /ops page controls (sim_settings row 'global'); defaults when no row exists."""
from dataclasses import dataclass


@dataclass(frozen=True)
class SimSettings:
    twins_per_brand: int = 60  # twins the onboarding builds for a brand
    followers_scraped: int = 300  # followers the onboarding scrapes
    sim_twins: int = 0  # at most this many twins per simulation (0 = all)
    scale_mode: str = "anchored"  # linear | anchored (applied by start_cascade)


DEFAULTS = SimSettings()


def load_settings(stdb) -> SimSettings:
    rows = stdb.sql("SELECT * FROM sim_settings WHERE key = 'global'")
    if not rows:
        return DEFAULTS
    r = rows[0]
    return SimSettings(twins_per_brand=r["twins_per_brand"], followers_scraped=r["followers_scraped"],
                       sim_twins=r["sim_twins"], scale_mode=r["scale_mode"])


def cap_twins(twins: list, limit: int) -> list:
    """The `limit` best-evidenced twins (most posts first); 0 or a limit above the audience keeps everyone."""
    if not limit or limit >= len(twins):
        return twins
    return sorted(twins, key=lambda t: -t.post_count)[:limit]
