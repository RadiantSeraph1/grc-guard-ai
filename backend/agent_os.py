"""AgentOS server for the GRC Guard agents.

This exposes the agno AgentOS HTTP API that the agno UI (agent-ui) connects to.
It runs as a separate process from the main FastAPI backend so the chat runtime
and the GRC REST API can scale independently.

Run:
    cd backend
    uvicorn agent_os:app --host 0.0.0.0 --port 7777
or:
    python agent_os.py

Then point the agno UI at http://localhost:7777 (see frontend/agent-ui).
"""

import os
from agno.os import AgentOS
from agno.db.sqlite import SqliteDb

import ai_agents

DEFAULT_COMPANY_ID = os.environ.get("DEFAULT_COMPANY_ID", "bank_enterprise")

# Shared session/history store for the AgentOS runtime.
agno_db = SqliteDb(db_file=os.environ.get("AGNO_DB_FILE", "agno_sessions.db"))

# Build the GRC agents and attach the AgentOS session store.
agents = ai_agents.build_grc_agents(org_id=DEFAULT_COMPANY_ID)
for _agent in agents:
    _agent.db = agno_db

agent_os = AgentOS(
    name="GRC Guard AgentOS",
    description="Governance, Risk & Compliance agents (Compliance, TPRM, Customer Trust, Risk Propagation).",
    agents=agents,
)

# FastAPI app consumed by uvicorn and by the agno UI.
app = agent_os.get_app()


if __name__ == "__main__":
    agent_os.serve(app="agent_os:app", host="0.0.0.0", port=int(os.environ.get("AGENT_OS_PORT", "7777")))
