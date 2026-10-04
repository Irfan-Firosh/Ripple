"""Every X_AUTH_TOKEN* in the environment becomes one Scweet account, so the pool rotates on rate limits."""
from scweet_accounts import auth_accounts


def test_collects_numbered_tokens_in_order_and_skips_blanks():
    env = {"X_AUTH_TOKEN": "aaa", "X_AUTH_TOKEN_2": "bbb", "X_AUTH_TOKEN_3": " ", "X_AUTH_TOKEN_10": "ccc", "OTHER": "x"}
    accounts = auth_accounts(env)
    assert [a["cookies"]["auth_token"] for a in accounts] == ["aaa", "bbb", "ccc"]
    assert [a["username"] for a in accounts] == ["x_account_1", "x_account_2", "x_account_10"]


def test_duplicate_tokens_count_once():
    assert len(auth_accounts({"X_AUTH_TOKEN": "aaa", "X_AUTH_TOKEN_2": "aaa"})) == 1


def test_no_tokens_is_empty():
    assert auth_accounts({}) == []


def test_working_accounts_drops_tokens_x_rejects():
    from scweet_accounts import working_accounts
    accounts = auth_accounts({"X_AUTH_TOKEN": "dead", "X_AUTH_TOKEN_2": "live"})
    kept, dropped = working_accounts(accounts, probe=lambda a: a["cookies"]["auth_token"] == "live")
    assert [a["username"] for a in kept] == ["x_account_2"] and dropped == ["x_account_1"]


def test_working_accounts_treats_probe_errors_as_rejected():
    from scweet_accounts import working_accounts
    def probe(a):
        raise RuntimeError("network")
    kept, dropped = working_accounts(auth_accounts({"X_AUTH_TOKEN": "a"}), probe=probe)
    assert kept == [] and dropped == ["x_account_1"]
