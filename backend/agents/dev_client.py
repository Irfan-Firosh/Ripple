"""Dev client: sends one SimulateRequest and one WhyRequest, prints the replies.

Usage: python -m agents.dev_client <sim_addr> <aud_addr>   (RIPPLE_AGENTS_LOCAL=1 to skip Agentverse mailboxes)
"""
import sys
import uuid

from uagents import Agent, Context

from .contracts import SimulateRequest, SimulateResult, WhyRequest, WhyResult
from .settings import PORTS, network_kwargs

SIM, AUD = sys.argv[1], sys.argv[2]
PORTS["dev_client"] = 8199
client = Agent(name="ripple-dev-client", **network_kwargs("dev_client"))


@client.on_event("startup")
async def go(ctx: Context):
    res, status = await ctx.send_and_receive(SIM, SimulateRequest(request_id=uuid.uuid4().hex, brand="spacetimedb",
                                             draft="We rebuilt our multiplayer backend on SpacetimeDB and cut server code by 70%."),
                                             response_type=SimulateResult, timeout=180)
    print("SIMULATE", status, res)
    res, status = await ctx.send_and_receive(AUD, WhyRequest(request_id=uuid.uuid4().hex, brand="spacetimedb",
                                             handle="clockwork_labs", draft="Multiplayer in one database"),
                                             response_type=WhyResult, timeout=90)
    print("WHY", status, res)


if __name__ == "__main__":
    client.run()
