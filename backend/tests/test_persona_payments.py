import asyncio
import json
from datetime import datetime, timedelta, timezone

from uagents_core.contrib.protocols.chat.cards import validate_card_payload_json
from uagents_core.contrib.protocols.payment import CancelPayment, CompletePayment, RejectPayment, RequestPayment

from ripple_agents import agents, cards, payments
from test_payment import Ctx, commit, ledger


def setup_offer():
    ctx = Ctx()
    ctx.session = "chat-one"
    key, state = agents._state(ctx, "user1")
    state["brand"] = "linear"
    card = payments.offer(ctx, "user1", key, state, 20, cards.next_steps("linear"))
    gate = payments.PersonaUpgradeGate("fetch1seller", ledger_factory=lambda: ledger())
    return ctx, gate, state["persona_upgrade"], card


def choose(ctx, gate, order, action="buy_persona_upgrade"):
    asyncio.run(agents._handle_request(ctx, "user1", json.dumps(dict(action=action, reference=order["reference"])), gate))


def test_offer_card_is_valid_and_keeps_next_steps():
    _, _, _, card = setup_offer()
    validate_card_payload_json(card.metadata["card_kind"], card.metadata["card_payload"])
    payload = card.metadata["card_payload"]
    assert "No thanks, continue" in payload and "0.1 test FET" in payload
    assert "Test another post / compare two" in payload and "expanded processing is not enabled" in payload


def test_no_button_and_typed_no_do_not_open_checkout(monkeypatch):
    monkeypatch.setattr(agents, "asi1_api_key", lambda: (_ for _ in ()).throw(AssertionError("called planner")))
    for text in ("no", "skip", "no thanks"):
        ctx, gate, order, _ = setup_offer()
        asyncio.run(agents._handle_request(ctx, "user1", text, gate))
        assert agents._state(ctx, "user1")[1]["persona_upgrade"]["status"] == "skipped"
        assert not any(isinstance(msg, RequestPayment) for _, msg in ctx.sent)
        assert not gate.pending
    ctx, gate, order, _ = setup_offer()
    choose(ctx, gate, order, "skip_persona_upgrade")
    assert not any(isinstance(msg, RequestPayment) for _, msg in ctx.sent)


def test_duplicate_click_opens_one_testnet_checkout():
    ctx, gate, order, _ = setup_offer()
    choose(ctx, gate, order)
    choose(ctx, gate, order)
    requests = [msg for _, msg in ctx.sent if isinstance(msg, RequestPayment)]
    assert len(requests) == 1
    assert requests[0].metadata["fet_network"] == "stable-testnet"
    assert requests[0].accepted_funds[0].amount == "0.1"
    assert requests[0].recipient == "fetch1seller"


def test_verified_payment_survives_restart_and_records_only_a_demo_receipt():
    ctx, gate, order, _ = setup_offer()
    choose(ctx, gate, order)
    gate = payments.PersonaUpgradeGate("fetch1seller", ledger_factory=lambda: ledger())
    asyncio.run(gate.on_commit(ctx, "user1", commit(order["reference"])))
    assert any(isinstance(msg, CompletePayment) for _, msg in ctx.sent)
    saved = ctx.storage.get(payments._order_key(order["reference"]))
    assert saved["status"] == "paid" and saved["transaction_id"] == "TX1"
    assert "not enabled in this demo" in ctx.sent[-1][1].content[0].text
    before = len(ctx.sent)
    asyncio.run(gate.on_commit(ctx, "user1", commit(order["reference"])))
    assert len(ctx.sent) == before + 1 and isinstance(ctx.sent[-1][1], CompletePayment)


def test_failed_or_other_session_commit_never_records_a_paid_upgrade():
    for different_session in (False, True):
        ctx, gate, order, _ = setup_offer()
        choose(ctx, gate, order)
        gate._ledger = ledger(ok=False)
        if different_session:
            ctx.session = "other-chat"
        asyncio.run(gate.on_commit(ctx, "user1", commit(order["reference"])))
        assert isinstance(ctx.sent[-1][1], CancelPayment)
        assert ctx.storage.get(payments._order_key(order["reference"]))["status"] == "requested"


def test_reject_checkout_keeps_results_and_expired_checkout_can_retry():
    ctx, gate, order, _ = setup_offer()
    choose(ctx, gate, order)
    asyncio.run(gate.on_reject(ctx, "user1", RejectPayment(reason="no")))
    assert agents._state(ctx, "user1")[1]["persona_upgrade"]["status"] == "skipped"
    assert "existing results" in ctx.sent[-1][1].content[0].text
    ctx, gate, order, _ = setup_offer()
    choose(ctx, gate, order)
    order["requested_at"] = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    gate._save_order(ctx, order)
    choose(ctx, gate, order)
    assert len([msg for _, msg in ctx.sent if isinstance(msg, RequestPayment)]) == 2
