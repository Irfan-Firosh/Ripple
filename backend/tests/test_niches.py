import re

from twins.niches import NICHE_SLUGS, NICHES, catalog_text


def test_catalog_shape():
    assert len(NICHES) == 21 and NICHE_SLUGS[-1] == "other"
    assert len(set(NICHE_SLUGS)) == len(NICHE_SLUGS)
    for n in NICHES:
        assert re.fullmatch(r"[a-z0-9_]+", n.slug) and n.label and n.description


def test_catalog_text_lists_every_slug():
    text = catalog_text()
    assert all(f"{slug}:" in text for slug in NICHE_SLUGS)
