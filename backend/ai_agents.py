import logging
import time
from sqlalchemy.orm import Session
from agno.agent import Agent
from agno.team import Team

from database import SessionLocal
from models import Control, Framework, Risk, RemediationAction
import rag
from ai_gateway import get_brain_model
from pydantic import BaseModel, Field
from typing import List

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Agent Tools
# ---------------------------------------------------------------------------

def search_knowledge_base(query: str, org_id: str) -> str:
    """Search the organization's compliance documents (RAG)."""
    try:
        results = rag.search_documents(query, org_id=org_id, limit=5)
        if not results:
            return "No relevant documentation found."
        text = "\n\n".join([f"Source: {r['filename']} (Page {r['page_number']})\n{r['content']}" for r in results])
        return text
    except Exception as e:
        logger.error(f"Error in search_knowledge_base: {e}")
        return f"Error searching knowledge base: {e}"


def get_framework_controls(framework_name: str, org_id: str) -> str:
    """Retrieve compliance controls for a specific framework (e.g. SOC2, ISO27001)."""
    db = SessionLocal()
    try:
        framework = db.query(Framework).filter(
            Framework.name.ilike(f"%{framework_name}%"),
            Framework.org_id == org_id
        ).first()
        if not framework:
            return f"Framework matching '{framework_name}' not found."
        
        # Control.frameworks is a CSV of framework ids (see framework_library.py),
        # not a foreign key - there is no Control.framework_id column.
        all_controls = db.query(Control).filter(Control.org_id == org_id).all()
        controls = [c for c in all_controls if framework.id in (c.frameworks or "").split(",")]

        if not controls:
            return f"No controls mapped to framework {framework.name}."

        res = [f"Framework: {framework.name}"]
        for c in controls:
            res.append(f"- [{c.status}] {c.control_code}: {c.description}")
        return "\n".join(res)
    finally:
        db.close()


def propose_remediation(target_type: str, target_id: str, proposed_status: str, rationale: str, org_id: str) -> str:
    """Propose a status change for a control or risk. Does NOT apply it - creates
    a PROPOSED RemediationAction that an Admin must approve before anything changes."""
    if target_type not in ("control", "risk"):
        return f"Invalid target_type '{target_type}'; must be 'control' or 'risk'."
    db = SessionLocal()
    try:
        model = Control if target_type == "control" else Risk
        if not db.query(model).filter_by(id=target_id, org_id=org_id).first():
            return f"No {target_type} with id '{target_id}' found for this organization."
        action = RemediationAction(
            org_id=org_id, target_type=target_type, target_id=target_id,
            proposed_status=proposed_status, rationale=rationale,
            status="PROPOSED", proposed_at=int(time.time()),
        )
        db.add(action)
        db.commit()
        db.refresh(action)
        return f"Remediation proposed (id={action.id}) — awaiting Admin approval in the Mechanic queue. Not applied yet."
    finally:
        db.close()


def get_active_risks(org_id: str) -> str:
    """Retrieve all Open risks for the organization."""
    db = SessionLocal()
    try:
        risks = db.query(Risk).filter(Risk.org_id == org_id, Risk.status == "Open").all()
        if not risks:
            return "No open risks found."
        res = []
        for r in risks:
            res.append(f"- {r.title} (Category: {r.category}, Inherent: {r.inherent_score}, Residual: {r.residual_score})")
        return "\n".join(res)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Brain Initialization & XAI Schema
# ---------------------------------------------------------------------------

class FeatureAttribution(BaseModel):
    feature: str = Field(description="The specific regulatory clause, rule, or risk factor identified.")
    importance: str = Field(description="High, Medium, or Low impact on the final decision.")
    explanation: str = Field(description="Why this feature influenced the decision (simulating SHAP/LIME logic).")

class ComplianceExplanation(BaseModel):
    decision: str = Field(description="The final compliance decision or summary (e.g. COMPLIANT, NON_COMPLIANT, or a direct answer).")
    confidence_score: int = Field(description="Confidence score from 0 to 100.")
    feature_attributions: List[FeatureAttribution] = Field(description="The key factors that drove this decision.")
    jurisdictional_conflicts: List[str] = Field(
        default=[],
        description="List of detected cross-jurisdictional regulatory conflicts, e.g. 'EU CRD/CRR conflicts with US Basel III Final Rule on counterparty credit risk calculation'."
    )
    counterfactual: str = Field(
        default="",
        description="Minimal change scenario that would flip this compliance decision (per EU AI Act Art. 86 right-to-explanation)."
    )

def create_brain_agent(org_id: str) -> Team:
    """Instantiate the GRC Brain multi-agent orchestration layer for the given organization."""
    model = get_brain_model(org_id)
    if not model:
        raise ValueError("No AI provider available. Configure one in Settings → AI Gateway.")

    # Closures bind the org_id to the tools so the LLM doesn't need to guess it.
    def tool_search_kb(query: str) -> str:
        """Search the internal knowledge base for policies, evidence, and documents."""
        return search_knowledge_base(query, org_id)
        
    def tool_get_controls(framework_name: str) -> str:
        """Retrieve compliance controls for a specific framework (e.g. SOC2)."""
        return get_framework_controls(framework_name, org_id)
        
    def tool_get_risks() -> str:
        """Retrieve all active risks for the organization."""
        return get_active_risks(org_id)

    def tool_propose_remediation(target_type: str, target_id: str, proposed_status: str, rationale: str) -> str:
        """Propose a status change for a control or risk (target_type: 'control' or 'risk').
        Creates a pending proposal for human approval - never applies the change directly."""
        return propose_remediation(target_type, target_id, proposed_status, rationale, org_id)

    # Vertex AI's Gemini quota is dynamically shared across all Google Cloud
    # customers - a 429 RESOURCE_EXHAUSTED is momentary contention, not a
    # fixed cap. Retry with backoff on every agent, since a single 429
    # anywhere in the delegation chain fails the whole query.
    retry_kwargs = dict(retries=3, delay_between_retries=2, exponential_backoff=True)

    # Specialists
    auditor = Agent(
        name="Compliance Auditor",
        model=model,
        description="Expert compliance auditor focusing on frameworks and controls.",
        instructions="Look up frameworks and map them to controls. Evaluate compliance posture.",
        tools=[tool_get_controls],
        markdown=False,
        **retry_kwargs,
    )

    risk_assessor = Agent(
        name="Risk Assessor",
        model=model,
        description="Expert risk analyst focusing on organizational risk.",
        instructions="Review active risks and identify exposures or missing mitigations.",
        tools=[tool_get_risks],
        markdown=False,
        **retry_kwargs,
    )

    researcher = Agent(
        name="Policy Researcher",
        model=model,
        description="Data researcher specialized in querying internal policy documents.",
        instructions="Search the internal knowledge base to answer questions about internal policies.",
        tools=[tool_search_kb],
        markdown=False,
        **retry_kwargs,
    )

    jurisdiction_reconciler = Agent(
        name="Jurisdiction Reconciler",
        model=model,
        description="Expert in cross-border regulatory conflicts between Basel III/IV, EU CRD/CRR, US Federal Reserve rules, GDPR, and local frameworks.",
        instructions=(
            "When given regulatory provisions from different jurisdictions, identify whether they conflict, "
            "overlap, or are compatible. Always state WHICH jurisdiction's rule takes precedence and WHY "
            "(e.g., lex specialis, more stringent rule, local law override). "
            "Format conflicts as: CONFLICT: [EU CRD/CRR vs US Basel III] — [description]. "
            "If compatible: COMPATIBLE: [explanation]. "
            "Always check Basel III vs Basel IV temporal differences."
        ),
        tools=[tool_get_controls, tool_search_kb],
        markdown=False,
        **retry_kwargs,
    )

    mechanic = Agent(
        name="Mechanic",
        model=model,
        description="Proposes remediation actions for controls/risks. Cannot apply them - only creates a proposal awaiting human Admin approval.",
        instructions=(
            "When an Inspector agent (Compliance Auditor or Risk Assessor) identifies a specific control or risk "
            "that should change status given the evidence discussed (e.g. a control should move to Passing, or a "
            "risk should be marked Mitigated), call propose_remediation with the target_type ('control' or 'risk'), "
            "the exact target id, the proposed_status, and a clear rationale citing the evidence. "
            "You cannot change status directly - your proposal requires human Admin approval before it takes "
            "effect. Never claim a change has been applied; always say it has been proposed and is pending review."
        ),
        tools=[tool_propose_remediation],
        markdown=False,
        **retry_kwargs,
    )

    # The GRC Brain (Orchestrator)
    brain = Team(
        name="GRC Brain",
        model=model,
        members=[auditor, risk_assessor, researcher, jurisdiction_reconciler, mechanic],
        description="Master orchestration agent for GRC Auditor.",
        instructions=(
            "You are the central AI Brain for GRC Auditor. You answer user queries about THIS organization's compliance "
            "posture, risks, and policies - never answer from general training knowledge alone. "
            "For ANY question about whether the organization meets, complies with, or is exposed under a specific "
            "framework, control, or regulatory requirement, you MUST first delegate to the Compliance Auditor (for "
            "control status) AND the Policy Researcher (for uploaded evidence/policy documents) before answering - "
            "even if you already know the general regulatory concept. Delegate to the Risk Assessor for any question "
            "touching organizational risk exposure. Only skip delegation for purely definitional questions that do not "
            "reference this organization's own posture (e.g. 'what is a CET1 ratio' with no compliance question attached). "
            "If the query involves multiple regulatory frameworks or jurisdictions, delegate to the Jurisdiction Reconciler "
            "to identify conflicts. Include any CONFLICT: findings in the jurisdictional_conflicts field. "
            "If the user asks you to fix, remediate, or update a specific control or risk's status, delegate to the "
            "Mechanic to propose the change - never state a status has changed unless the Mechanic confirms a "
            "proposal was created. Proposals require human Admin approval and are never auto-applied. "
            "You MUST synthesize your findings into the strict JSON format defined by your response model to provide "
            "Auditor-ready Explainable AI (XAI) feature attributions. Do NOT output raw markdown."
        ),
        output_schema=ComplianceExplanation,
        markdown=False,
        **retry_kwargs,
    )

    return brain
