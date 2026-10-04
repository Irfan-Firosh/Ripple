from creative.kit_refresh import clean_props


def test_props_are_short_unique_and_free_of_banned_claims():
    props = ["Raycast 2.6 halves memory use", "raycast 2.6 halves memory use", "The fastest launcher ever made",
             "  Connect your Claude or ChatGPT subscription to Raycast AI  ", "x" * 200, ""]
    assert clean_props(props, banned=["fastest"]) == ["Raycast 2.6 halves memory use",
                                                      "Connect your Claude or ChatGPT subscription to Raycast AI"]


def test_props_fall_back_to_existing_ones_when_nothing_survives():
    assert clean_props(["", "fastest ever"], banned=["fastest"], fallback=["Find tools fast"]) == ["Find tools fast"]
