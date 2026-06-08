import json
import time
from sqlalchemy.orm import Session
import database
import models
import ai_gateway
import rag

DEFAULT_COMPANY_ID = "bank_enterprise"

class ComplianceAgent:
    """Agent for policy audits, mapping policy drafts to control guidelines."""
    def run_audit(self, policy_text: str, db: Session, org_id: str = DEFAULT_COMPANY_ID) -> str:
        # Search for matched regulations in RAG scoped to the company key.
        matched_regs = rag.search_documents(policy_text, org_id=org_id, limit=3)
        context_str = "\n\n".join([f"Source: {r['filename']} (Page {r['page_number']}):\n{r['content']}" for r in matched_regs])
        
        prompt = f"""
        Analyze the following draft policy text for GRC compliance.
        
        Matched Regulatory Controls and References:
        {context_str if context_str else "No specific regulatory matching chunk found in index."}
        
        Policy Draft:
        "{policy_text}"
        
        Task:
        1. Identify compliance alignment or gaps.
        2. Give concrete recommendations for updates.
        """
        system_instruction = "You are the Compliance Agent. Your specialty is policy auditing and mapping to framework controls."
        return ai_gateway.generate_content(prompt, system_instruction, org_id=org_id)

class TPRMAgent:
    """Agent for vendor risk assessments and automated security questionnaire analysis."""
    def evaluate_vendor(self, vendor_name: str, questionnaire_json: str, db: Session, org_id: str = None) -> str:
        prompt = f"""
        Perform a Third-Party Risk Management (TPRM) audit on the vendor: {vendor_name}.
        
        Questionnaire Answers:
        {questionnaire_json}
        
        Task:
        1. Evaluate the vendor's security controls based on their responses.
        2. Outline inherent risks (data hosting, access controls, business continuity).
        3. Recommend a final approval status (Approved, Under Assessment, or Flagged) and risk rating tier.
        """
        system_instruction = "You are the TPRM Vendor Risk Agent. Your specialty is analyzing third-party vendors and security questionnaires."
        return ai_gateway.generate_content(prompt, system_instruction, org_id=org_id)

class CustomerTrustAgent:
    """Agent for customer trust center answering security query scenarios using RAG databases."""
    def answer_query(self, user_query: str, db: Session, org_id: str = DEFAULT_COMPANY_ID) -> str:
        # Query RAG first, scoped to the company key.
        matched_regs = rag.search_documents(user_query, org_id=org_id, limit=3)
        context_str = "\n\n".join([f"Source: {r['filename']} (Page {r['page_number']}):\n{r['content']}" for r in matched_regs])
        
        prompt = f"""
        A customer has asked this security question: "{user_query}"
        
        Use the following internal GRC controls database information to answer accurately and build customer trust.
        
        Internal GRC Posture / Reference:
        {context_str if context_str else "Standard security controls baseline."}
        
        Task:
        Provide a professional, clear, and reassuring response explaining how our controls address their security concerns.
        """
        system_instruction = "You are the Customer Trust Agent. Your specialty is answering customer questionnaires based on internal compliance controls."
        return ai_gateway.generate_content(prompt, system_instruction, org_id=org_id)

class AgentForRisk:
    """Agent for threat propagation and risk calculations across the Trust Graph nodes."""
    def calculate_risk(self, target_node_id: str, db: Session, org_id: str = DEFAULT_COMPANY_ID) -> str:
        # Gather trust graph context scoped to the company key.
        integrations = db.query(models.Integration).filter_by(org_id=org_id).all()
        assets = db.query(models.Asset).filter_by(org_id=org_id).all()
        controls = db.query(models.Control).filter_by(org_id=org_id).all()
        risks = db.query(models.Risk).filter_by(org_id=org_id).all()
        
        # Build node list and status descriptions
        node_status = []
        for i in integrations:
            node_status.append(f"Integration '{i.name}' (ID: {i.id}) is {i.status}")
        for a in assets:
            scope_str = "In Scope" if a.is_in_scope else "Out of Scope"
            node_status.append(f"Asset '{a.name}' (ID: {a.id}, Type: {a.type}) is {a.compliance_status} ({scope_str})")
        for c in controls:
            node_status.append(f"Control '{c.title}' (ID: {c.id}, Code: {c.control_code}) is {c.status}")
        for r in risks:
            node_status.append(f"Risk '{r.title}' (ID: {r.id}, Category: {r.category}) is {r.status} (Inherent: {r.inherent_score}, Residual: {r.residual_score})")
            
        nodes_context = "\n".join(node_status)
        
        prompt = f"""
        Analyze the risk propagation path for target node ID: "{target_node_id}".
        
        Current Relational GRC Node Postures:
        {nodes_context}
        
        Task:
        1. Trace security vulnerabilities flowing to/from the target node based on the GRC model.
        2. Identify how failing controls propagate risk to assets or integrations.
        3. Recommend specific control tests or mitigation changes to lower the residual risk.
        """
        system_instruction = "You are the Risk Propagation Agent. Your specialty is auditing vulnerabilities and scoring cascading security risks across the Trust Graph."
        return ai_gateway.generate_content(prompt, system_instruction, org_id=org_id)
