import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from uagents_core.contrib.protocols.payment import CancelPayment, CommitPayment, CompletePayment, Funds, RejectPayment, RequestPayment

from agents.payment import PRICE_FET, PaymentGate, verify_fet_payment


class Storage:
    def __init__(self, data=None):
        self.data = data if data is not None else {}

    def get(self, key):
        return self.data.get(key)

    def set(self, key, value):
        self.data[key] = value


class Ctx:
    def __init__(self):
        self.sent = []
        self.logger = SimpleNamespace(info=lambda *a: None, error=lambda *a: None, warning=lambda *a: None)
        self.storage = Storage()

    async def send(self, dest, msg):
        self.sent.append((dest, msg))


def ledger(ok=True, recipient="fetch1seller", sender="fetch1buyer", amount=f"{10**17}atestfet", memo="",
           timestamp=None, tx_hash="TX1"):
    tx = SimpleNamespace(hash=tx_hash, is_successful=lambda: ok, timestamp=timestamp or datetime.now(timezone.utc),
                         events={"transfer": {"recipient": recipient, "sender": sender, "amount": amount}})
    body = SimpleNamespace(tx=SimpleNamespace(body=SimpleNamespace(memo=memo)))
    return SimpleNamespace(query_tx=lambda tx_id: tx, txs=SimpleNamespace(GetTx=lambda req: body))


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


def paid_flow(gate, ctx, refs, commits):
    paid = []

    async def on_paid(ctx, buyer, ref):
        paid.append(ref)

    for ref in refs:
        asyncio.run(gate.request(ctx, "user1", ref, "x", on_paid=on_paid))
    for c in commits:
        asyncio.run(gate.on_commit(ctx, "user1", c))
    return paid


def test_transfer_older_than_the_request_is_rejected():
    old = datetime.now(timezone.utc) - timedelta(hours=2)
    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger(timestamp=old))
    ctx = Ctx()
    assert paid_flow(gate, ctx, ["ref1"], [commit("ref1")]) == [] and isinstance(ctx.sent[-1][1], CancelPayment)


def test_memo_naming_another_reference_is_rejected():
    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger(memo="someone-elses-ref"))
    ctx = Ctx()
    assert paid_flow(gate, ctx, ["ref1"], [commit("ref1")]) == []


def test_memo_matching_the_reference_is_accepted():
    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger(memo="ref1"))
    assert paid_flow(gate, Ctx(), ["ref1"], [commit("ref1")]) == ["ref1"]


def test_expired_request_is_rejected():
    gate = PaymentGate("fetch1seller", ledger_factory=lambda: ledger())
    ctx = Ctx()
    asyncio.run(gate.request(ctx, "user1", "ref1", "x", on_paid=lambda *a: None))
    gate.pending["ref1"].requested_at -= timedelta(seconds=10_000)
    asyncio.run(gate.on_commit(ctx, "user1", commit("ref1")))
    assert isinstance(ctx.sent[-1][1], CancelPayment)


def test_used_transactions_survive_a_restart_and_ignore_case():
    storage = Storage()
    first, second = Ctx(), Ctx()
    first.storage = second.storage = storage                                    # same agent storage, new process
    assert paid_flow(PaymentGate("fetch1seller", ledger_factory=lambda: ledger(tx_hash="ABCD")), first,
                     ["ref1"], [commit("ref1")]) == ["ref1"]
    c = commit("ref2")
    c.transaction_id = "abcd"
    assert paid_flow(PaymentGate("fetch1seller", ledger_factory=lambda: ledger(tx_hash="ABCD")), second,
                     ["ref2"], [c]) == []


def test_ledger_is_queried_off_the_event_loop_and_created_once():
    import threading
    seen, made = {}, []

    def factory():
        made.append(1)
        base = ledger()
        def query(tx_id):
            seen["thread"] = threading.get_ident()
            return base.query_tx(tx_id)
        return SimpleNamespace(query_tx=query, txs=base.txs)

    gate = PaymentGate("fetch1seller", ledger_factory=factory)
    ctx = Ctx()
    paid_flow(gate, ctx, ["ref1", "ref2"], [commit("ref1")])
    c = commit("ref2"); c.transaction_id = "TX2"
    asyncio.run(gate.on_commit(ctx, "user1", c))
    assert seen["thread"] != threading.get_ident() and len(made) == 1
