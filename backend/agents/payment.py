"""Fetch.ai Payment Protocol, seller side: request testnet FET, verify on-ledger, then unlock work."""
import os
from dataclasses import dataclass
from decimal import Decimal
from typing import Awaitable, Callable

from uagents import Context, Protocol
from uagents_core.contrib.protocols.payment import (CancelPayment, CommitPayment, CompletePayment, Funds, RejectPayment,
                                                    RequestPayment, payment_protocol_spec)

PRICE_FET = os.environ.get("RIPPLE_COMPARE_PRICE_FET", "0.1")
DEADLINE_SECONDS = 300
FET_DECIMALS = 18

OnPaid = Callable[[Context, str, str], Awaitable[None]]


def verify_fet_payment(ledger, tx_id: str, amount_fet: str, buyer_wallet: str, recipient_wallet: str, denom: str) -> bool:
    try:
        tx = ledger.query_tx(tx_id)
    except Exception:
        return False
    if not tx.is_successful():
        return False
    expected = int(Decimal(amount_fet) * 10**FET_DECIMALS)
    t = tx.events.get("transfer", {})
    amount = str(t.get("amount", ""))
    if not amount.endswith(denom):
        return False
    try:
        paid = int(amount[: -len(denom)])
    except ValueError:
        return False
    return t.get("recipient") == recipient_wallet and t.get("sender") == buyer_wallet and paid >= expected


def testnet_ledger():
    from cosmpy.aerial.client import LedgerClient, NetworkConfig
    testnet = os.environ.get("FET_USE_TESTNET", "true").lower() == "true"
    return LedgerClient(NetworkConfig.fetchai_stable_testnet() if testnet else NetworkConfig.fetchai_mainnet())


@dataclass
class _Pending:
    buyer: str
    on_paid: OnPaid
    on_rejected: OnPaid | None


class PaymentGate:
    def __init__(self, wallet_address: str, ledger_factory=testnet_ledger, price_fet: str = PRICE_FET, testnet: bool = True):
        self.wallet_address = wallet_address
        self.ledger_factory = ledger_factory
        self.price_fet = price_fet
        self.denom = "atestfet" if testnet else "afet"
        self.pending: dict[str, _Pending] = {}
        self.used_tx: set[str] = set()  # a transaction pays for one request only
        self.protocol = Protocol(spec=payment_protocol_spec, role="seller")
        self.protocol.on_message(CommitPayment)(self.on_commit)
        self.protocol.on_message(RejectPayment)(self.on_reject)

    async def request(self, ctx: Context, buyer: str, reference: str, description: str,
                      on_paid: OnPaid, on_rejected: OnPaid | None = None) -> None:
        self.pending[reference] = _Pending(buyer, on_paid, on_rejected)
        await ctx.send(buyer, RequestPayment(
            accepted_funds=[Funds(currency="FET", amount=self.price_fet, payment_method="fet_direct")],
            recipient=self.wallet_address, deadline_seconds=DEADLINE_SECONDS, reference=reference,
            description=description, metadata={}))

    async def on_commit(self, ctx: Context, sender: str, msg: CommitPayment) -> None:
        pending = self.pending.get(msg.reference or "")
        buyer_wallet = (msg.metadata or {}).get("buyer_fet_wallet") or (msg.metadata or {}).get("buyer_fet_address")
        ok = (pending is not None and pending.buyer == sender and msg.transaction_id not in self.used_tx and msg.funds.currency == "FET"
              and msg.funds.payment_method == "fet_direct" and isinstance(buyer_wallet, str)
              and verify_fet_payment(self.ledger_factory(), msg.transaction_id, self.price_fet, buyer_wallet,
                                     self.wallet_address, self.denom))
        if not ok:
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason="Payment could not be verified on-ledger"))
            return
        self.used_tx.add(msg.transaction_id)
        self.pending.pop(msg.reference, None)
        await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))
        await pending.on_paid(ctx, sender, msg.reference)

    async def on_reject(self, ctx: Context, sender: str, msg: RejectPayment) -> None:
        for ref, p in list(self.pending.items()):
            if p.buyer == sender:
                self.pending.pop(ref)
                if p.on_rejected:
                    await p.on_rejected(ctx, sender, ref)
