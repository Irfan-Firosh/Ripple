"""Connect an agent's mailbox to Agentverse with an API key: the same call the Inspector's Connect button makes."""
from uagents import Agent
from uagents.mailbox import AgentverseConnectRequest, register_in_agentverse
from uagents_core.registration import RegistrationRequest


async def connect_mailbox(agent: Agent, api_key: str, starter_prompts: list[str] | None = None) -> tuple[bool, str]:
    # uagents keeps these private; pinned to uagents 0.26 in pyproject.toml.
    profile = agent._build_registration_profile()
    profile.starter_prompts = (starter_prompts or [])[:5]  # Agentverse accepts at most five.
    details = RegistrationRequest(
        address=agent.address, name=agent.name, handle=agent._handle, profile=profile,
        endpoints=agent._endpoints, protocols=list(agent.protocols.keys()), metadata=agent.metadata)
    resp = await register_in_agentverse(AgentverseConnectRequest(user_token=api_key, agent_type="mailbox"),
                                        agent._identity, agent._prefix, agent._agentverse, details)
    return resp.success, getattr(resp, "detail", "") or ""
