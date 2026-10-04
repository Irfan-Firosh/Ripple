from agents.settings import PORTS, network_kwargs


def test_mailbox_by_default(monkeypatch):
    monkeypatch.delenv("RIPPLE_AGENTS_LOCAL", raising=False)
    assert network_kwargs("simulation") == {"port": PORTS["simulation"], "mailbox": True, "handle_messages_concurrently": True}


def test_local_mode_uses_localhost_endpoint(monkeypatch):
    monkeypatch.setenv("RIPPLE_AGENTS_LOCAL", "1")
    assert network_kwargs("audience") == {"port": 8102, "endpoint": ["http://127.0.0.1:8102/submit"], "handle_messages_concurrently": True}


def test_agents_handle_messages_concurrently(monkeypatch):
    monkeypatch.delenv("RIPPLE_AGENTS_LOCAL", raising=False)
    assert network_kwargs("simulation")["handle_messages_concurrently"] is True
