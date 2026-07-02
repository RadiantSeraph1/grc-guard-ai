"""GRC agents built on the agno framework.

These are real agno `Agent` objects. Each agent is given:
  * the active organization's model (Groq for now / the in-house model, via ai_gateway)
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


def _default_model():
    """Interim fallback model for agent serving (Groq until the in-house model is
    trained). Returns None when no usable provider is configured; callers then
    degrade to the grounded gateway fallback rather than erroring.
    """
    key = ai_gateway.get_env_provider_key("groq")
    if not key:
        return None
    from agno.models.openai.like import OpenAILike
    return OpenAILike(
        id=ai_gateway.PROVIDER_DEFAULT_MODEL["groq"],
        api_key=key,
        base_url=ai_gateway.OPENAI_COMPATIBLE_BASE_URL["groq"],
    )


def _model_for_org(org_id: Optional[str]):
    """Build the agno model for the org's active provider.

    Falls back to the interim default model (Groq) when the active provider is the
    local engine or cannot be constructed. May return None if nothing is usable —
    callers handle that by degrading to the grounded gateway fallback.
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
        print(f"Falling back to interim default model for agents: {e}")
    return _default_model()


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
            instructions=d["instructions"] + FORMATTING_GUIDE,
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
    """Turn an agno RunOutput (an object, not a dict) into UI 'thinking' steps."""
    steps = []
    reasoning = getattr(result, "reasoning_content", None)
    if reasoning:
        steps.append({"type": "reasoning", "title": "Reasoning", "detail": str(reasoning)[:4000]})
    for step in (getattr(result, "reasoning_steps", None) or []):
        detail = getattr(step, "reasoning", None) or getattr(step, "action", None) or getattr(step, "result", "")
        steps.append({"type": "reasoning", "title": str(getattr(step, "title", "Reasoning step")),
                      "detail": str(detail)[:2000]})
    for tool in (getattr(result, "tools", None) or []):
        output = getattr(tool, "result", None) or getattr(tool, "content", "")
        steps.append({"type": "tool",
                      "title": f"Called {getattr(tool, 'tool_name', 'tool')}",
                      "args": getattr(tool, "tool_args", {}),
                      "detail": str(output)[:2000] if output else ""})
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
