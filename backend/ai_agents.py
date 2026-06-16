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

# Shared output-formatting contract appended to every agent. Keeps responses
# clean and structured (Markdown is rendered by the UI), with no decorative
# emojis or ASCII separators.
FORMATTING_GUIDE = (
    "\n\nOutput format rules:\n"
    "- Write in clean, well-structured Markdown that renders nicely (the UI renders Markdown).\n"
    "- Use short section headings, bullet lists, and bold labels to organise the answer.\n"
    "- When comparing items or listing controls/gaps, use a proper Markdown table with a header row.\n"
    "- Do NOT use emojis. Do NOT use decorative ASCII separators or horizontal rules.\n"
    "- Keep prose tight; prefer lists and tables over long paragraphs. Be specific and grounded."
)


# ---------------------------------------------------------------------------
# Tools (plain functions -> agno auto-wraps them as tools)
# ---------------------------------------------------------------------------

def search_compliance_corpus(query: str, org_id: str = DEFAULT_COMPANY_ID) -> str:
    """Search the organization's ingested regulatory / evidence corpus (RAG).

    Args:
        query: The natural-language search query.
        org_id: The organization key to scope the search to.
    Returns:
        Matching source chunks with filename and page number, or a notice if empty.
    """
    matches = rag.search_documents(query, org_id=org_id, limit=4)
    if not matches:
        return "No documents have been ingested into the corpus yet for this organization."
    return "\n\n".join(
        f"Source: {m['filename']} (Page {m['page_number']}):\n{m['content']}" for m in matches
    )


def get_grc_graph_state(org_id: str = DEFAULT_COMPANY_ID) -> str:
    """Return the current control / risk / asset / integration posture for the org.

    Args:
        org_id: The organization key to scope the query to.
    Returns:
        A textual snapshot of nodes and their statuses (empty notice if none).
    """
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
        "tools": [search_compliance_corpus, get_grc_graph_state],
    },
    {
        "id": "tprm-agent",
        "name": "TPRM Vendor Risk Agent",
        "instructions": (
            "You are the Third-Party Risk Management Agent. You evaluate vendor security "
            "questionnaires, outline inherent risks (data hosting, access, business continuity), "
            "and recommend an approval status (Approved / Under Assessment / Flagged) and a risk tier."
        ),
        "tools": [search_compliance_corpus],
    },
    {
        "id": "customer-trust-agent",
        "name": "Customer Trust Agent",
        "instructions": (
            "You are the Customer Trust Agent. You answer customer and prospect security questions "
            "professionally and reassuringly, grounded in the organization's actual controls. Use the "
            "search tool and the GRC graph to cite real posture; never invent controls that do not exist."
        ),
        "tools": [search_compliance_corpus, get_grc_graph_state],
    },
    {
        "id": "risk-propagation-agent",
        "name": "Risk Propagation Agent",
        "instructions": (
            "You are the Risk Propagation Agent. You trace how failing controls cascade risk across "
            "assets and integrations in the Trust Graph, and recommend specific control tests or "
            "mitigations to lower residual risk. Always read the live graph state first."
        ),
        "tools": [get_grc_graph_state, search_compliance_corpus],
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
    """Construct the full set of GRC agno agents for an organization."""
    model = _model_for_org(org_id)
    agents: List[Agent] = []
    for d in AGENT_DEFINITIONS:
        agents.append(Agent(
            id=d["id"],
            name=d["name"],
            model=model,
            instructions=d["instructions"] + FORMATTING_GUIDE,
            tools=d["tools"],
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
    try:
        agent = build_agent(agent_id, org_id)
        if agent is None:
            return _grounded_fallback(prompt, org_id)
        content = (agent.run(prompt).content or "").strip()
        if _is_failure_content(content):
            return _grounded_fallback(prompt, org_id)
        return content
    except Exception as e:
        print(f"Agent {agent_id} run failed: {e}. Falling back to gateway.")
        return _grounded_fallback(prompt, org_id)


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


# Markers that indicate the model emitted a provider/tool-calling error as its
# "answer" rather than actually answering. Common with smaller models (e.g.
# Groq llama) that struggle with structured function calling.
_TOOL_FAILURE_MARKERS = (
    "failed to call a function",
    "failed_generation",
    "tool call validation failed",
    "function call",
)


def _is_failure_content(content: str) -> bool:
    if not content or not content.strip():
        return True
    low = content.lower()
    return any(m in low for m in _TOOL_FAILURE_MARKERS)


def _grounded_fallback(prompt: str, org_id: str) -> str:
    """Plain (no-tool) answer, but still grounded by injecting the corpus + graph
    context into the prompt so a tool-incapable model keeps GRC grounding."""
    try:
        corpus = search_compliance_corpus(prompt, org_id=org_id)
    except Exception:
        corpus = ""
    try:
        graph = get_grc_graph_state(org_id=org_id)
    except Exception:
        graph = ""
    grounded_prompt = (
        f"{prompt}\n\n---\nReference material (use if relevant):\n"
        f"[Corpus]\n{corpus}\n\n[GRC graph]\n{graph}"
    )
    return ai_gateway.generate_content(
        grounded_prompt,
        "You are a senior banking GRC analysis agent." + FORMATTING_GUIDE,
        org_id=org_id,
    )


def run_agent_detailed(agent_id: str, prompt: str, org_id: str) -> dict:
    """Run an agent and return both its answer and the steps it took.

    Every failure path (agent construction, model build, the run itself, or a
    model that emits a tool-calling error as its answer) degrades to a grounded
    no-tool gateway call, so the endpoint always returns a usable answer.
    """
    try:
        agent = build_agent(agent_id, org_id)
        if agent is None:
            return {"content": _grounded_fallback(prompt, org_id), "steps": []}
        result = agent.run(prompt)
        content = (result.content or "").strip()
        if _is_failure_content(content):
            print(f"Agent {agent_id} returned a tool-failure answer; using grounded fallback.")
            return {"content": _grounded_fallback(prompt, org_id),
                    "steps": _extract_steps(result)}
        return {"content": content, "steps": _extract_steps(result)}
    except Exception as e:
        print(f"Agent {agent_id} detailed run failed: {e}. Falling back to gateway.")
        return {"content": _grounded_fallback(prompt, org_id), "steps": []}


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
