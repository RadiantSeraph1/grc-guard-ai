"""GRC agents built on the agno framework.

These are real agno `Agent` objects. Each agent is given:
  * the active organization's model (Claude by default, resolved via ai_gateway)
  * GRC-specific instructions
  * tools to read the live platform state (RAG corpus + control/risk graph)

The same factory (`build_grc_agents`) is used both by the in-app
`/api/ai/agent-query` endpoint and by the standalone AgentOS server (agent_os.py)
that powers the agno UI.
"""

from typing import List, Optional
from agno.agent import Agent

import database
import models
import ai_gateway
import rag

DEFAULT_COMPANY_ID = "bank_enterprise"


# ---------------------------------------------------------------------------
# Tools (plain functions -> agno auto-wraps them as tools)
# ---------------------------------------------------------------------------

def _search_compliance_corpus(query: str, org_id: str) -> str:
    matches = rag.search_documents(query, org_id=org_id, limit=4)
    if not matches:
        return "No documents have been ingested into the corpus yet for this organization."
    return "\n\n".join(
        f"Source: {m['filename']} (Page {m['page_number']}):\n{m['content']}" for m in matches
    )


def _get_grc_graph_state(org_id: str) -> str:
    db = database.SessionLocal()
    try:
        lines: List[str] = []
        for i in db.query(models.Integration).filter_by(org_id=org_id).all():
            lines.append(f"Integration '{i.name}' (ID: {i.id}) is {i.status}.")
        for a in db.query(models.Asset).filter_by(org_id=org_id).all():
            scope = "In Scope" if a.is_in_scope else "Out of Scope"
            lines.append(f"Asset '{a.name}' ({a.type}) is {a.compliance_status} ({scope}).")
        for c in db.query(models.Control).filter_by(org_id=org_id).all():
            lines.append(f"Control '{c.title}' [{c.control_code}] is {c.status}.")
        for r in db.query(models.Risk).filter_by(org_id=org_id).all():
            lines.append(f"Risk '{r.title}' ({r.category}) is {r.status} "
                         f"(inherent {r.inherent_score}, residual {r.residual_score}).")
        if not lines:
            return "The GRC graph is currently empty. Connect integrations and add controls to populate it."
        return "\n".join(lines)
    finally:
        db.close()


def make_corpus_tool(org_id: str):
    """Build an org-bound RAG search tool.

    The org is captured in the closure so the LLM never has to (and cannot)
    supply it — this enforces tenant isolation: each agent only ever searches
    its own organization's corpus.
    """
    def search_compliance_corpus(query: str) -> str:
        """Search this organization's ingested regulatory / evidence corpus (RAG).

        Args:
            query: The natural-language search query.
        Returns:
            Matching source chunks with filename and page number, or a notice if empty.
        """
        return _search_compliance_corpus(query, org_id)
    return search_compliance_corpus


def make_graph_tool(org_id: str):
    """Build an org-bound GRC graph reader (tenant-isolated via closure)."""
    def get_grc_graph_state() -> str:
        """Return the current control / risk / asset / integration posture for this organization.

        Returns:
            A textual snapshot of nodes and their statuses (empty notice if none).
        """
        return _get_grc_graph_state(org_id)
    return get_grc_graph_state


# Backwards-compatible module-level tools (default org). Prefer the org-bound
# `make_*_tool` factories above inside agents so tenant scoping is guaranteed.
def search_compliance_corpus(query: str, org_id: str = DEFAULT_COMPANY_ID) -> str:
    """Search an organization's ingested regulatory / evidence corpus (RAG)."""
    return _search_compliance_corpus(query, org_id)


def get_grc_graph_state(org_id: str = DEFAULT_COMPANY_ID) -> str:
    """Return the current GRC posture for an organization."""
    return _get_grc_graph_state(org_id)


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

AGENT_DEFINITIONS = [
    {
        "id": "compliance-agent",
        "name": "Compliance Agent",
        "instructions": (
            "You are the Compliance Agent. You audit policy drafts and map them to framework "
            "controls (Basel III, GDPR, SOC 2, ISO 27001, PCI-DSS). Always ground answers in the "
            "ingested corpus using the search tool. Identify alignment, gaps, and concrete fixes."
        ),
        "tools": ["corpus", "graph"],
    },
    {
        "id": "tprm-agent",
        "name": "TPRM Vendor Risk Agent",
        "instructions": (
            "You are the Third-Party Risk Management Agent. You evaluate vendor security "
            "questionnaires, outline inherent risks (data hosting, access, business continuity), "
            "and recommend an approval status (Approved / Under Assessment / Flagged) and a risk tier."
        ),
        "tools": ["corpus"],
    },
    {
        "id": "customer-trust-agent",
        "name": "Customer Trust Agent",
        "instructions": (
            "You are the Customer Trust Agent. You answer customer and prospect security questions "
            "professionally and reassuringly, grounded in the organization's actual controls. Use the "
            "search tool and the GRC graph to cite real posture; never invent controls that do not exist."
        ),
        "tools": ["corpus", "graph"],
    },
    {
        "id": "risk-propagation-agent",
        "name": "Risk Propagation Agent",
        "instructions": (
            "You are the Risk Propagation Agent. You trace how failing controls cascade risk across "
            "assets and integrations in the Trust Graph, and recommend specific control tests or "
            "mitigations to lower residual risk. Always read the live graph state first."
        ),
        "tools": ["graph", "corpus"],
    },
]


def _default_claude_model():
    """Always-constructable Claude model (default provider) for agent serving."""
    from agno.models.anthropic import Claude
    return Claude(
        id=ai_gateway.PROVIDER_DEFAULT_MODEL["claude"],
        api_key=ai_gateway.get_env_provider_key("claude"),
    )


def _model_for_org(org_id: Optional[str]):
    """Build the agno model for the org's active provider (Claude default).

    Never returns None: if the active provider is the local engine or cannot be
    constructed, fall back to a Claude model so agents are always serveable.
    """
    try:
        db = database.SessionLocal()
        try:
            config = ai_gateway.get_active_provider_config(db, org_id=org_id)
            api_key = ai_gateway.get_decrypted_key(config)
            model = ai_gateway._build_model(config.id, api_key, config)
            if model is not None:
                return model
        finally:
            db.close()
    except Exception as e:
        print(f"Falling back to default Claude model for agents: {e}")
    return _default_claude_model()


def build_grc_agents(org_id: str = DEFAULT_COMPANY_ID) -> List[Agent]:
    """Construct the full set of GRC agno agents for an organization.

    Tools are bound to `org_id` via closures so every agent reads only its own
    tenant's corpus and graph — the LLM cannot cross organizations.
    """
    model = _model_for_org(org_id)
    tool_registry = {
        "corpus": make_corpus_tool(org_id),
        "graph": make_graph_tool(org_id),
    }
    agents: List[Agent] = []
    for d in AGENT_DEFINITIONS:
        agents.append(Agent(
            id=d["id"],
            name=d["name"],
            model=model,
            instructions=d["instructions"],
            tools=[tool_registry[key] for key in d["tools"]],
            markdown=True,
            telemetry=False,
        ))
    return agents


def build_agent(agent_id: str, org_id: str = DEFAULT_COMPANY_ID) -> Optional[Agent]:
    for agent in build_grc_agents(org_id):
        if agent.id == agent_id:
            return agent
    return None


# ---------------------------------------------------------------------------
# Backwards-compatible wrappers used by /api/ai/agent-query in main.py
# ---------------------------------------------------------------------------

def _run(agent_id: str, prompt: str, org_id: str) -> str:
    agent = build_agent(agent_id, org_id)
    if agent is None:
        return ai_gateway.generate_content(prompt, org_id=org_id)
    try:
        return (agent.run(prompt).content or "").strip()
    except Exception as e:
        print(f"Agent {agent_id} run failed: {e}. Falling back to gateway.")
        return ai_gateway.generate_content(prompt, org_id=org_id)


def _extract_steps(result) -> list:
    """Turn an agno RunOutput into a UI-friendly list of 'thinking' steps."""
    steps = []

    def _get(obj, key, default=None):
        if isinstance(obj, dict):
            return obj.get(key, default)
        return getattr(obj, key, default)

    reasoning = _get(result, "reasoning_content", None)
    if reasoning:
        steps.append({"type": "reasoning", "title": "Reasoning", "detail": str(reasoning)[:4000]})

    for step in (_get(result, "reasoning_steps", None) or []):
        title = _get(step, "title", "Reasoning step")
        detail = _get(step, "reasoning", None) or _get(step, "action", None) or _get(step, "result", "")
        steps.append({"type": "reasoning", "title": str(title), "detail": str(detail)[:2000]})

    for tool in (_get(result, "tools", None) or []):
        name = _get(tool, "tool_name", None) or _get(tool, "name", "tool")
        args = _get(tool, "tool_args", None) or _get(tool, "args", {})
        output = _get(tool, "result", None) or _get(tool, "content", "")
        steps.append({
            "type": "tool",
            "title": f"Called {name}",
            "args": args,
            "detail": str(output)[:2000] if output else "",
        })
    return steps


def run_agent_detailed(agent_id: str, prompt: str, org_id: str) -> dict:
    """Run an agent and return both its answer and the steps it took."""
    agent = build_agent(agent_id, org_id)
    if agent is None:
        return {"content": ai_gateway.generate_content(prompt, org_id=org_id), "steps": []}
    try:
        result = agent.run(prompt)
        return {"content": (result.content or "").strip(), "steps": _extract_steps(result)}
    except Exception as e:
        print(f"Agent {agent_id} detailed run failed: {e}. Falling back to gateway.")
        return {"content": ai_gateway.generate_content(prompt, org_id=org_id), "steps": []}


class ComplianceAgent:
    def run_audit(self, policy_text: str, db=None, org_id: str = DEFAULT_COMPANY_ID) -> str:
        return _run("compliance-agent",
                    f"Audit the following draft policy for GRC compliance and list gaps and fixes:\n\n{policy_text}",
                    org_id)


class TPRMAgent:
    def evaluate_vendor(self, vendor_name: str, questionnaire_json: str, db=None, org_id: str = None) -> str:
        return _run("tprm-agent",
                    f"Perform a TPRM audit on vendor '{vendor_name}'. Questionnaire answers:\n{questionnaire_json}",
                    org_id or DEFAULT_COMPANY_ID)


class CustomerTrustAgent:
    def answer_query(self, user_query: str, db=None, org_id: str = DEFAULT_COMPANY_ID) -> str:
        return _run("customer-trust-agent",
                    f"A customer asked this security question: \"{user_query}\". Answer it grounded in our real controls.",
                    org_id)


class AgentForRisk:
    def calculate_risk(self, target_node_id: str, db=None, org_id: str = DEFAULT_COMPANY_ID) -> str:
        return _run("risk-propagation-agent",
                    f"Analyze risk propagation for target node '{target_node_id}' using the live GRC graph.",
                    org_id)
