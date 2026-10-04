"""Fetch.ai Payment Protocol, seller side: request testnet FET, verify on-ledger, then unlock work.

A commit unlocks work only if the on-chain transfer is successful, pays at least the price to our wallet from the
buyer's wallet, happened after the request (and before its deadline), does not name a different reference in its memo,
and has never paid for anything before (used tx hashes live in the agent's persistent storage).
"""
import asyncio
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Awaitable, Callable

from uagents import Context, Protocol
from uagents_core.contrib.protocols.payment import (CancelPayment, CommitPayment, CompletePayment, Funds, RejectPayment,
                                                    RequestPayment, payment_protocol_spec)

PRICE_FET = os.environ.get("RIPPLE_COMPARE_PRICE_FET", "0.1")
DEADLINE_SECONDS = 300
CLOCK_SKEW = timedelta(seconds=60)  # ledger block time vs our clock
TX_WAIT = timedelta(seconds=20)  # buyers often commit before the tx is indexed
FET_DECIMALS = 18
USED_TX_KEY = "ripple_payment_used_tx"

OnPaid = Callable[[Context, str, str], Awaitable[None]]


def _query(ledger, tx_id: str):
    wait = getattr(ledger, "wait_for_query_tx", None)
    return wait(tx_id, timeout=TX_WAIT) if wait else ledger.query_tx(tx_id)


def _memo(ledger, tx_hash: str) -> str:
    # cosmpy's TxResponse does not parse the memo; read it from the raw tx.
    try:
        from cosmpy.protos.cosmos.tx.v1beta1.service_pb2 import GetTxRequest
        return ledger.txs.GetTx(GetTxRequest(hash=tx_hash)).tx.body.memo or ""
    except Exception:  # noqa: BLE001 - no memo available means "not bound", never "valid"
        return ""


def verify_fet_payment(ledger, tx_id: str, amount_fet: str, buyer_wallet: str, recipient_wallet: str, denom: str,
                       *, not_before: datetime | None = None, reference: str | None = None) -> str | None:
    """Returns the canonical (upper-case) tx hash when the payment is valid, else None."""
    try:
        tx = _query(ledger, tx_id)
    except Exception:  # noqa: BLE001 - not found / network error → unverified
        return None
    if not tx.is_successful():
        return None
    if not_before is not None and tx.timestamp is not None and tx.timestamp < not_before - CLOCK_SKEW:
        return None
    t = tx.events.get("transfer", {})
    amount = str(t.get("amount", ""))
    if not amount.endswith(denom):
        return None
    try:
        paid = int(amount[: -len(denom)])
    except ValueError:
        return None
    if not (t.get("recipient") == recipient_wallet and t.get("sender") == buyer_wallet
            and paid >= int(Decimal(amount_fet) * 10**FET_DECIMALS)):
        return None
    tx_hash = str(getattr(tx, "hash", "") or tx_id).upper()
    memo = _memo(ledger, tx_hash).strip()
    if reference is not None and memo and memo != reference:
        return None
    return tx_hash


def testnet_ledger():
    from cosmpy.aerial.client import LedgerClient, NetworkConfig
    testnet = os.environ.get("FET_USE_TESTNET", "true").lower() == "true"
    return LedgerClient(NetworkConfig.fetchai_stable_testnet() if testnet else NetworkConfig.fetchai_mainnet())


@dataclass
class _Pending:
    buyer: str
    on_paid: OnPaid
    on_rejected: OnPaid | None
    requested_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class PaymentGate:
    def __init__(self, wallet_address: str, ledger_factory=testnet_ledger, price_fet: str = PRICE_FET, testnet: bool = True):
        self.wallet_address = wallet_address
        self.ledger_factory = ledger_factory
        self._ledger = None
        self.price_fet = price_fet
        self.denom = "atestfet" if testnet else "afet"
        self.pending: dict[str, _Pending] = {}
        self.in_flight: set[str] = set()  # tx ids being verified right now (reserved before awaiting)
        self.protocol = Protocol(spec=payment_protocol_spec, role="seller")
        self.protocol.on_message(CommitPayment)(self.on_commit)
        self.protocol.on_message(RejectPayment)(self.on_reject)

    def ledger(self):
        if self._ledger is None:
            self._ledger = self.ledger_factory()
        return self._ledger

    @staticmethod
    def _used(ctx: Context) -> list[str]:
        return list(ctx.storage.get(USED_TX_KEY) or [])

    async def request(self, ctx: Context, buyer: str, reference: str, description: str,
                      on_paid: OnPaid, on_rejected: OnPaid | None = None) -> None:
        self.pending[reference] = _Pending(buyer, on_paid, on_rejected)
        await ctx.send(buyer, RequestPayment(
            accepted_funds=[Funds(currency="FET", amount=self.price_fet, payment_method="fet_direct")],
            recipient=self.wallet_address, deadline_seconds=DEADLINE_SECONDS, reference=reference,
            description=f"{description} (put '{reference}' in the transfer memo)", metadata={}))

    async def _verify(self, ctx: Context, sender: str, msg: CommitPayment, pending: _Pending | None) -> str | None:
        meta = msg.metadata or {}
        buyer_wallet = meta.get("buyer_fet_wallet") or meta.get("buyer_fet_address")
        if (pending is None or pending.buyer != sender or msg.funds.currency != "FET"
                or msg.funds.payment_method != "fet_direct" or not isinstance(buyer_wallet, str)):
            return None
        if datetime.now(timezone.utc) > pending.requested_at + timedelta(seconds=DEADLINE_SECONDS):
            self.pending.pop(msg.reference, None)
            return None
        return await asyncio.to_thread(verify_fet_payment, self.ledger(), msg.transaction_id, self.price_fet,
                                       buyer_wallet, self.wallet_address, self.denom,
                                       not_before=pending.requested_at, reference=msg.reference)

    async def on_commit(self, ctx: Context, sender: str, msg: CommitPayment) -> None:
        claimed = msg.transaction_id.upper()
        tx_hash = None
        if claimed not in self.in_flight and claimed not in self._used(ctx):
            self.in_flight.add(claimed)
            try:
                tx_hash = await self._verify(ctx, sender, msg, self.pending.get(msg.reference or ""))
                if tx_hash is not None and tx_hash in self._used(ctx):
                    tx_hash = None
                if tx_hash is not None:
                    ctx.storage.set(USED_TX_KEY, [*self._used(ctx), tx_hash])
            finally:
                self.in_flight.discard(claimed)
        if tx_hash is None:
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason="Payment could not be verified on-ledger"))
            return
        pending = self.pending.pop(msg.reference)
        await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))
        await pending.on_paid(ctx, sender, msg.reference)

    async def on_reject(self, ctx: Context, sender: str, msg: RejectPayment) -> None:
        for ref, p in list(self.pending.items()):
            if p.buyer == sender:
                self.pending.pop(ref)
                if p.on_rejected:
                    await p.on_rejected(ctx, sender, ref)
