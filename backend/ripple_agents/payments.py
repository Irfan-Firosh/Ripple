"""Optional chat-only persona upgrade demo. Payments use test FET; analysis stays unchanged."""
from datetime import datetime, timezone
from uuid import uuid4

from agents.payment import DEADLINE_SECONDS, PaymentGate, _Pending
from uagents_core.contrib.protocols.chat import MetadataContent
from uagents_core.contrib.protocols.payment import CancelPayment, CompletePayment

from . import cards

PRICE_FET = "0.1"
TARGET_PERSONAS = 50


def _order_key(reference):
    return f"ripple-persona-upgrade:{reference}"


def offer(ctx, sender, state_key, state, personas, next_card):
    from .agents import _save_state
    order = dict(reference=str(uuid4()), buyer=sender, session=str(getattr(ctx, "session", "local")),
                 state_key=state_key, brand=state["brand"], campaign_id=state.get("campaign_id", ""),
                 personas=personas, status="offered", next_card=next_card.metadata)
    state["persona_upgrade"] = order
    _save_state(ctx, state_key, state)
    return cards.persona_upgrade(order, next_card)


async def _reply(ctx, sender, order, text):
    from .agents import _text
    await ctx.send(sender, _text(text, card=MetadataContent(type="metadata", metadata=order["next_card"])))


class PersonaUpgradeGate(PaymentGate):
    def __init__(self, wallet_address, ledger_factory=None):
        def test_ledger():
            from cosmpy.aerial.client import LedgerClient, NetworkConfig
            return LedgerClient(NetworkConfig.fetchai_stable_testnet())
        super().__init__(wallet_address, ledger_factory=ledger_factory or test_ledger, price_fet=PRICE_FET, testnet=True)
        self.processing = set()

    def _save_order(self, ctx, order):
        ctx.storage.set(_order_key(order["reference"]), order)
        state = ctx.storage.get(order["state_key"]) or {}
        if state.get("persona_upgrade", {}).get("reference") == order["reference"]:
            state["persona_upgrade"] = order
            ctx.storage.set(order["state_key"], state)

    async def _paid(self, ctx, sender, reference):
        order = ctx.storage.get(_order_key(reference))
        order["status"] = "paid"
        self._save_order(ctx, order)
        await _reply(ctx, sender, order, "Test payment confirmed. Your 50-persona upgrade is recorded. "
                     "Expanded persona processing is not enabled in this demo; your existing results are unchanged.")

    async def on_commit(self, ctx, sender, msg):
        order = ctx.storage.get(_order_key(msg.reference or ""))
        if (not order or order["buyer"] != sender
                or order["session"] != str(getattr(ctx, "session", "local"))
                or msg.recipient != self.wallet_address):
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason="No matching upgrade order"))
            return
        if order["status"] == "paid" and order.get("transaction_id", "").upper() == msg.transaction_id.upper():
            await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))
            return
        if order["status"] != "requested":
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason="Upgrade checkout is no longer active"))
            return
        if msg.reference in self.processing:
            return  # the first commitment will return the verified receipt
        self.processing.add(msg.reference)
        self.pending.setdefault(msg.reference, _Pending(sender, self._paid, None,
                                                       datetime.fromisoformat(order["requested_at"])))
        # Persist the receipt ID before the callback; the gate still verifies the actual ledger transfer.
        order["transaction_id"] = msg.transaction_id
        self._save_order(ctx, order)
        try:
            await super().on_commit(ctx, sender, msg)
        finally:
            self.processing.discard(msg.reference)

    async def on_reject(self, ctx, sender, msg):
        from .agents import _state
        _, state = _state(ctx, sender)
        order = state.get("persona_upgrade")
        if order and order["status"] == "requested":
            if order["reference"] in self.processing:
                return
            order["status"] = "skipped"
            self.pending.pop(order["reference"], None)
            self._save_order(ctx, order)
            await _reply(ctx, sender, order, "No problem—continue with your existing results.")


async def handle(ctx, sender, state_key, state, selection, text, gate):
    """Handle payment choices directly, without asking the request planner."""
    from .agents import _save_state, _text
    action = selection.get("action") if isinstance(selection, dict) else None
    order = state.get("persona_upgrade")
    short = text.lower().strip(" .!\n")
    if order and order["status"] in {"offered", "requested"} and not action:
        if short in {"no", "no thanks", "no thanks, continue", "skip"}:
            action = "skip_persona_upgrade"
        elif short in {"yes", "expand", "expand to 50", "expand to 50 · 0.1 test fet"}:
            action = "buy_persona_upgrade"
    if action not in {"buy_persona_upgrade", "skip_persona_upgrade"}:
        return False
    reference = selection.get("reference") if isinstance(selection, dict) else None
    if not order or (reference and reference != order["reference"]):
        await ctx.send(sender, _text("That upgrade offer is no longer active. Run a new analysis first.",
                                     card=cards.menu(state.get("brand"))))
        return True
    if order["status"] in {"paid", "skipped"}:
        await _reply(ctx, sender, order, "This offer has already been handled. Continue with your existing results.")
        return True
    if action == "skip_persona_upgrade":
        order["status"] = "skipped"
        _save_state(ctx, state_key, state)
        if gate and getattr(ctx, "storage", None):
            gate._save_order(ctx, order)
        await _reply(ctx, sender, order, "No problem—continue with your existing results.")
        return True
    if gate is None:
        await _reply(ctx, sender, order, "Payment checkout is unavailable. Your existing results are ready to use.")
        return True
    if order["status"] == "requested":
        elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(order["requested_at"])).total_seconds()
        if elapsed < DEADLINE_SECONDS:
            await _reply(ctx, sender, order, "Checkout is already open. Approve or reject the test FET payment request.")
            return True
    order.update(status="requested", requested_at=datetime.now(timezone.utc).isoformat())
    gate._save_order(ctx, order)
    await gate.request(ctx, sender, order["reference"],
                       "Ripple 50-persona upgrade demo. Testnet only; expanded processing is not enabled.",
                       on_paid=gate._paid, metadata={"fet_network": "stable-testnet", "service": "persona_upgrade_demo",
                                                    "provider_agent_wallet": gate.wallet_address})
    return True
