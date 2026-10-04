import asyncio
from types import SimpleNamespace

from uagents_core.contrib.protocols.payment import CancelPayment, CommitPayment, CompletePayment, Funds, RejectPayment, RequestPayment

from agents.payment import PRICE_FET, PaymentGate, verify_fet_payment


class Ctx:
    def __init__(self):
        self.sent = []
        self.logger = SimpleNamespace(info=lambda *a: None, error=lambda *a: None, warning=lambda *a: None)

    async def send(self, dest, msg):
        self.sent.append((dest, msg))


def ledger(ok=True, recipient="fetch1seller", sender="fetch1buyer", amount=f"{10**17}atestfet"):
    tx = SimpleNamespace(is_successful=lambda: ok,
                         events={"transfer": {"recipient": recipient, "sender": sender, "amount": amount}})
    return SimpleNamespace(query_tx=lambda tx_id: tx)


def commit(ref, amount=PRICE_FET, wallet="fetch1buyer"):
    return CommitPayment(funds=Funds(currency="FET", amount=amount, payment_method="fet_direct"), recipient="fetch1seller",
                         transaction_id="TX1", reference=ref, description=None, metadata={"buyer_fet_wallet": wallet})


def test_verify_checks_success_recipient_sender_and_amount():
    assert verify_fet_payment(ledger(), "TX1", "0.1", "fetch1buyer", "fetch1seller", "atestfet")
    assert not verify_fet_payment(ledger(ok=False), "TX1", "0.1", "fetch1buyer", "fetch1seller", "atestfet")
    assert not verify_fet_payment(ledger(recipient="fetch1evil"), "TX1", "0.1", "fetch1buyer", "fetch1seller", "atestfet")
    assert not verify_fet_payment(ledger(amount=f"{10**16}atestfet"), "TX1", "0.1", "fetch1buyer", "fetch1seller", "atestfet")


def test_request_then_verified_commit_completes_and_calls_on_paid():
    paid = []

    async def on_paid(ctx, buyer, ref):
        paid.append((buyer, ref))

    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger())
    ctx = Ctx()
    asyncio.run(gate.request(ctx, "user1", "ref1", "Compare drafts", on_paid=on_paid))
    req = ctx.sent[0][1]
    assert isinstance(req, RequestPayment) and req.accepted_funds[0].amount == PRICE_FET and req.recipient == "fetch1seller"
    asyncio.run(gate.on_commit(ctx, "user1", commit("ref1")))
    assert isinstance(ctx.sent[-1][1], CompletePayment) and paid == [("user1", "ref1")]


def test_bad_commit_cancels_and_never_runs():
    paid = []

    async def on_paid(ctx, buyer, ref):
        paid.append(ref)

    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger(amount=f"{10**15}atestfet"))
    ctx = Ctx()
    asyncio.run(gate.request(ctx, "user1", "ref1", "x", on_paid=on_paid))
    asyncio.run(gate.on_commit(ctx, "user1", commit("ref1")))
    assert isinstance(ctx.sent[-1][1], CancelPayment) and paid == []
    asyncio.run(gate.on_commit(ctx, "user1", commit("unknown-ref")))           # never requested
    assert isinstance(ctx.sent[-1][1], CancelPayment) and paid == []


def test_reject_calls_on_rejected():
    rejected = []

    async def on_rejected(ctx, buyer, ref):
        rejected.append(ref)

    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger())
    ctx = Ctx()
    asyncio.run(gate.request(ctx, "u", "ref9", "x", on_paid=lambda *a: None, on_rejected=on_rejected))
    asyncio.run(gate.on_reject(ctx, "u", RejectPayment(reason="no")))
    assert rejected == ["ref9"]


def test_a_transaction_cannot_pay_twice():
    paid = []

    async def on_paid(ctx, buyer, ref):
        paid.append(ref)

    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger())
    ctx = Ctx()
    asyncio.run(gate.request(ctx, "user1", "ref1", "x", on_paid=on_paid))
    asyncio.run(gate.request(ctx, "user1", "ref2", "x", on_paid=on_paid))
    asyncio.run(gate.on_commit(ctx, "user1", commit("ref1")))
    asyncio.run(gate.on_commit(ctx, "user1", commit("ref2")))                  # same TX1 reused
    assert paid == ["ref1"] and isinstance(ctx.sent[-1][1], CancelPayment)
