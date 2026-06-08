import time
from sqlalchemy.orm import Session
from database import engine, SessionLocal, Base
from models import (
    Organization, Department, User, AIProviderConfig, Integration, Framework, Control, Risk,
    Evidence, Vendor, Asset, Policy, PolicyAcknowledgment, AuditComment
)

DEFAULT_COMPANY_ID = "bank_enterprise"
DEFAULT_COMPANY_NAME = "ARB Apex Bank"
DEFAULT_DEPARTMENTS = [
    ("Security", "Security governance, identity controls, and threat monitoring."),
    ("Compliance", "Regulatory compliance operations and framework readiness."),
    ("Audit", "Internal audit evidence review and testing."),
    ("Engineering", "Platform engineering, asset ownership, and technical controls."),
    ("HR", "People operations, onboarding, and workforce compliance."),
    ("Risk Management", "Enterprise risk appetite, residual risk scoring, and mitigation tracking."),
    ("Data Privacy", "Customer data protection, DPIA reviews, retention, and privacy-by-design controls."),
    ("Treasury", "Liquidity, capital adequacy, ALM, and stress-test evidence ownership."),
    ("Finance", "Financial reporting controls, audit trails, reconciliations, and statutory reporting."),
    ("Legal", "Regulatory obligations, contract risk, breach notification, and policy governance."),
    ("IT Operations", "Infrastructure reliability, change management, backups, and operational resilience."),
    ("Identity & Access", "Joiner-mover-leaver workflows, privileged access, MFA, and access recertification."),
    ("Vendor Management", "Third-party risk, supplier assessments, and due-diligence evidence."),
    ("Incident Response", "Security incident handling, escalation, lessons learned, and tabletop readiness."),
    ("Business Continuity", "BCP/DR testing, continuity plans, RTO/RPO tracking, and crisis management."),
    ("Branch Operations", "Branch-level process controls, physical security, cash operations, and local audits."),
    ("Customer Support", "Customer-facing operational controls, complaint handling, and data access hygiene."),
    ("Core Banking", "Core ledger, payments, transaction processing, and banking platform controls."),
    ("Payments", "Card, ACH, SWIFT, settlement, fraud monitoring, and payment operations controls.")
]

def ensure_departments(db: Session, org_id: str):
    existing = {department.name.lower() for department in db.query(Department).filter_by(org_id=org_id).all()}
    for name, description in DEFAULT_DEPARTMENTS:
        if name.lower() not in existing:
            db.add(Department(
                id=f"dept_{name.lower().replace(' ', '_')}_{org_id}",
                org_id=org_id,
                name=name,
                description=description,
                status="Active",
                created_at=int(time.time())
            ))
    db.commit()

def seed_org_data(db: Session, org_id: str, org_name: str = None):
    org_id = DEFAULT_COMPANY_ID
    org_name = org_name or DEFAULT_COMPANY_NAME
    # Ensure Organization exists
    org = db.query(Organization).filter_by(id=org_id).first()
    if not org:
        org = Organization(id=org_id, name=org_name, created_at=int(time.time()))
        db.add(org)
        db.commit()

    # Check if already seeded for this organization
    if db.query(User).filter_by(org_id=org_id).count() > 0:
        ensure_departments(db, org_id)
        return

    print(f"Seeding {org.name} with banking-grade departmental GRC data...")

    # 1. Users (department and role mapping)
    users = [
        User(id="bank_user_admin", org_id=org_id, email="ciso@arbapexbank.example", name="Alex Carter", role="Admin", department="Security", training_completed=True, background_check_passed=True, status="Active"),
        User(id="bank_user_editor", org_id=org_id, email="compliance@arbapexbank.example", name="David Vance", role="Editor", department="Compliance", training_completed=True, background_check_passed=True, status="Active"),
        User(id="bank_user_auditor", org_id=org_id, email="audit@arbapexbank.example", name="Sarah Jenkins", role="Auditor", department="Audit", training_completed=True, background_check_passed=True, status="Active"),
        User(id="bank_user_employee", org_id=org_id, email="platform@arbapexbank.example", name="John Doe", role="Employee", department="Engineering", training_completed=False, background_check_passed=True, status="Active"),
        User(id="bank_user_hr", org_id=org_id, email="people@arbapexbank.example", name="Jane Smith", role="Employee", department="HR", training_completed=True, background_check_passed=True, status="Active")
    ]
    db.add_all(users)
    db.commit()
    ensure_departments(db, org_id)

    admin_id = users[0].id
    editor_id = users[1].id

    # 2. AI Provider Configurations
    providers = [
        AIProviderConfig(id="local_evidence", org_id=org_id, is_active=True),
        AIProviderConfig(id="gemini", org_id=org_id, is_active=False),
        AIProviderConfig(id="openai", org_id=org_id, is_active=False),
        AIProviderConfig(id="claude", org_id=org_id, is_active=False),
        AIProviderConfig(id="groq", org_id=org_id, is_active=False),
        AIProviderConfig(id="openrouter", org_id=org_id, is_active=False),
        AIProviderConfig(id="mistral", org_id=org_id, is_active=False),
        AIProviderConfig(id="deepseek", org_id=org_id, is_active=False),
        AIProviderConfig(id="perplexity", org_id=org_id, is_active=False),
        AIProviderConfig(id="xai", org_id=org_id, is_active=False),
        AIProviderConfig(id="azure_openai", org_id=org_id, is_active=False),
        AIProviderConfig(id="ollama", org_id=org_id, is_active=False),
        AIProviderConfig(id="local", org_id=org_id, is_active=False),
        AIProviderConfig(id="vast_ai", org_id=org_id, is_active=False),
        AIProviderConfig(id="custom", org_id=org_id, is_active=False)
    ]
    db.add_all(providers)
    db.commit()

    # 3. Integrations
    integrations = [
        Integration(id="aws", org_id=org_id, name="Amazon Web Services", category="Cloud", status="Disconnected"),
        Integration(id="okta", org_id=org_id, name="Okta Identity Manager", category="Identity", status="Disconnected"),
        Integration(id="auth0", org_id=org_id, name="Auth0 Identity Platform", category="Identity", status="Disconnected"),
        Integration(id="github", org_id=org_id, name="GitHub Developer Portal", category="Developer", status="Disconnected"),
        Integration(id="jamf", org_id=org_id, name="Jamf Pro MDM", category="EDR", status="Disconnected"),
        Integration(id="workday", org_id=org_id, name="Workday HRIS", category="HRIS", status="Disconnected")
    ]
    db.add_all(integrations)
    db.commit()

    # 4. Frameworks
    frameworks = [
        Framework(id=f"basel-iii_{org_id}", org_id=org_id, name="Basel III Capital & Liquidity", code="BASEL-III", description="Global regulatory framework on bank capital adequacy, stress testing, and market liquidity risk.", readiness=50.0),
        Framework(id=f"cbest_{org_id}", org_id=org_id, name="CBEST Threat Intelligence", code="CBEST", description="Vulnerability assessment framework simulating cyber-threats against core banking infrastructure.", readiness=100.0),
        Framework(id=f"gdpr_{org_id}", org_id=org_id, name="EU General Data Protection Regulation", code="GDPR", description="Strict European data privacy regulation protecting customer PII and transactions.", readiness=50.0),
        Framework(id=f"soc-2_{org_id}", org_id=org_id, name="SOC 2 Type II Security", code="SOC-2", description="System and Organization Controls auditing security, availability, and confidentiality.", readiness=25.0),
        Framework(id=f"iso-27001_{org_id}", org_id=org_id, name="ISO/IEC 27001 ISMS", code="ISO-27001", description="Standard for establishing and managing a formal Information Security Management System.", readiness=25.0),
        Framework(id=f"pci-dss_{org_id}", org_id=org_id, name="PCI Data Security Standard", code="PCI-DSS", description="Standards governing organizations handling cardholder payment details.", readiness=33.3)
    ]
    db.add_all(frameworks)
    db.commit()

    basel_fid = frameworks[0].id
    cbest_fid = frameworks[1].id
    gdpr_fid = frameworks[2].id
    soc2_fid = frameworks[3].id
    iso27001_fid = frameworks[4].id
    pcidss_fid = frameworks[5].id

    # 5. Controls
    controls = [
        Control(id=f"basel-iii-01_{org_id}", org_id=org_id, control_code="BASEL-CAP-01", title="CET1 Capital Adequacy Ratio", description="Verify the bank maintains a CET1 ratio of at least 4.5% + 2.5% conservation buffer (7.0% total) of risk-weighted assets.", frameworks=basel_fid, status="Passing", owner_id=editor_id, last_tested=int(time.time())),
        Control(id=f"basel-iii-02_{org_id}", org_id=org_id, control_code="BASEL-LIQ-01", title="Liquidity Coverage Ratio Check", description="Verify bank holds high-quality liquid assets (HQLA) to cover total net cash outflows over a 30-day stress scenario.", frameworks=basel_fid, status="Failing", owner_id=editor_id, last_tested=int(time.time())),
        Control(id=f"cbest-01_{org_id}", org_id=org_id, control_code="CBEST-TMT-01", title="Gateway Impersonation Boundary Enforcement", description="Ensure systems detect and alert on unauthorized endpoint spoofing and SWIFT routing impersonations.", frameworks=cbest_fid, status="Passing", owner_id=editor_id, last_tested=int(time.time())),
        Control(id=f"gdpr-01_{org_id}", org_id=org_id, control_code="GDPR-PII-01", title="Database Encryption at Rest", description="Customer personal data including names, account numbers, and address details must be encrypted at rest using AES-256.", frameworks=f"{gdpr_fid},{soc2_fid},{iso27001_fid}", status="Failing", owner_id=editor_id, last_tested=int(time.time())),
        Control(id=f"gdpr-02_{org_id}", org_id=org_id, control_code="GDPR-MASK-01", title="Transaction Log Masking", description="Transaction logging modules must anonymize or mask raw transaction customer records prior to database insertion.", frameworks=gdpr_fid, status="Passing", owner_id=editor_id, last_tested=int(time.time())),
        Control(id=f"soc2-01_{org_id}", org_id=org_id, control_code="SOC2-MFA-01", title="MFA Enforced in Okta Identity Provider", description="Ensure Okta has mandatory Multi-Factor Authentication enabled for all active and administrator accounts.", frameworks=f"{soc2_fid},{iso27001_fid},{pcidss_fid}", status="Warning", owner_id=admin_id, last_tested=int(time.time())),
        Control(id=f"github-01_{org_id}", org_id=org_id, control_code="GIT-BR-01", title="Main Branch Protection Rules", description="GitHub repositories storing GRC configurations must have mandatory branch protection rules (minimum 1 reviewer, status checks).", frameworks=f"{soc2_fid},{iso27001_fid}", status="Failing", owner_id=editor_id, last_tested=int(time.time())),
        Control(id=f"employee-01_{org_id}", org_id=org_id, control_code="SEC-TRAIN-01", title="Security Awareness Training", description="Ensure all active users have completed the mandatory security training modules.", frameworks=f"{soc2_fid},{iso27001_fid}", status="Warning", owner_id=admin_id, last_tested=int(time.time()))
    ]
    db.add_all(controls)
    db.commit()

    # 6. Risks
    risks = [
        Risk(id=f"risk-01_{org_id}", org_id=org_id, title="Capital Adequacy Out-of-Compliance", category="Regulatory", likelihood=2, impact=5, inherent_score=10, residual_score=5, status="Mitigated", owner_id=admin_id),
        Risk(id=f"risk-02_{org_id}", org_id=org_id, title="Liquidity Default Risk under Stress", category="Operational", likelihood=3, impact=4, inherent_score=12, residual_score=12, status="Open", owner_id=editor_id),
        Risk(id=f"risk-03_{org_id}", org_id=org_id, title="Unauthorized Access to Core Database", category="Cyber", likelihood=4, impact=5, inherent_score=20, residual_score=8, status="Mitigated", owner_id=admin_id),
        Risk(id=f"risk-04_{org_id}", org_id=org_id, title="Insecure Developer Pipeline Injection", category="Cyber", likelihood=3, impact=4, inherent_score=12, residual_score=12, status="Open", owner_id=editor_id),
        Risk(id=f"risk-05_{org_id}", org_id=org_id, title="Customer Personal Data Leak (PII)", category="Compliance", likelihood=3, impact=5, inherent_score=15, residual_score=15, status="Open", owner_id=editor_id)
    ]
    db.add_all(risks)
    db.commit()

    # Link Mitigations
    for risk in risks:
        if "risk-01" in risk.id:
            risk.mitigations.append(next(c for c in controls if "basel-iii-01" in c.id))
        elif "risk-02" in risk.id:
            risk.mitigations.append(next(c for c in controls if "basel-iii-02" in c.id))
        elif "risk-03" in risk.id:
            risk.mitigations.append(next(c for c in controls if "gdpr-01" in c.id))
            risk.mitigations.append(next(c for c in controls if "soc2-01" in c.id))
        elif "risk-04" in risk.id:
            risk.mitigations.append(next(c for c in controls if "github-01" in c.id))
        elif "risk-05" in risk.id:
            risk.mitigations.append(next(c for c in controls if "gdpr-01" in c.id))
            risk.mitigations.append(next(c for c in controls if "gdpr-02" in c.id))
    db.commit()

    # 7. Assets
    assets = [
        Asset(id=f"asset-01_{org_id}", org_id=org_id, name="Production Ledger RDS Cluster", type="Cloud Resource", owner_id=admin_id, compliance_status="Failing", is_in_scope=True, integration_id="aws"),
        Asset(id=f"asset-02_{org_id}", org_id=org_id, name="Corporate Git Repo grc-core", type="Repository", owner_id=editor_id, compliance_status="Failing", is_in_scope=True, integration_id="github"),
        Asset(id=f"asset-03_{org_id}", org_id=org_id, name="Workstation MAC-0239", type="Workstation", owner_id=users[3].id, compliance_status="Passing", is_in_scope=True, integration_id="jamf"),
        Asset(id=f"asset-04_{org_id}", org_id=org_id, name="Internal Payroll SaaS", type="SaaS App", owner_id=users[4].id, compliance_status="Passing", is_in_scope=False, integration_id="workday")
    ]
    db.add_all(assets)
    db.commit()

    # 8. Policies
    policies = [
        Policy(id=f"policy-01_{org_id}", org_id=org_id, title="Information Security Policy", version="2.0.1", status="Approved"),
        Policy(id=f"policy-02_{org_id}", org_id=org_id, title="Access Control Policy", version="1.1.0", status="Under Review"),
        Policy(id=f"policy-03_{org_id}", org_id=org_id, title="Incident Response Plan", version="1.0.0", status="Draft")
    ]
    db.add_all(policies)
    db.commit()

    # 9. Policy Acknowledgment Signatures
    acks = [
        PolicyAcknowledgment(id=f"ack-01_{org_id}", org_id=org_id, policy_id=policies[0].id, user_id=admin_id, signed_at=int(time.time() - 86400)),
        PolicyAcknowledgment(id=f"ack-02_{org_id}", org_id=org_id, policy_id=policies[0].id, user_id=users[4].id, signed_at=int(time.time() - 43200))
    ]
    db.add_all(acks)
    db.commit()

    # 10. Vendors (TPRM)
    vendors = [
        Vendor(id=f"vendor-01_{org_id}", org_id=org_id, name="CoreBankingTech Ltd", tier="Critical", inherent_risk="High", residual_risk="Medium", status="Approved", last_assessment_date=int(time.time() - 172800)),
        Vendor(id=f"vendor-02_{org_id}", org_id=org_id, name="OfficeSupplies Co", tier="Low", inherent_risk="Low", residual_risk="Low", status="Approved", last_assessment_date=int(time.time() - 172800)),
        Vendor(id=f"vendor-03_{org_id}", org_id=org_id, name="CloudAnalytics Inc", tier="High", inherent_risk="High", residual_risk="High", status="Under Assessment", last_assessment_date=None)
    ]
    db.add_all(vendors)
    db.commit()

    # 11. Audit Comments
    comments = [
        AuditComment(id=f"comment-01_{org_id}", org_id=org_id, control_id=next(c for c in controls if "gdpr-01" in c.id).id, sender_name="Sarah Jenkins", comment_text="Please supply the latest configuration audit confirming AES-256 is active on the database cluster.", timestamp=int(time.time() - 3600))
    ]
    db.add_all(comments)
    db.commit()

    # 12. Evidence
    evidences = [
        Evidence(id=f"ev-01_{org_id}", org_id=org_id, title="AWS RDS Encryption Snapshot", file_path="uploads/db_enc_config.json", file_size=412, freshness="Expired", upload_time=int(time.time() - 2592000), control_id=next(c for c in controls if "gdpr-01" in c.id).id)
    ]
    db.add_all(evidences)
    db.commit()

    print(f"Organization {org_id} seeding complete.")


def seed_db():
    # Create all tables dynamically
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    try:
        # Seed the single company; departments are the internal operating boundary.
        seed_org_data(db, DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME)
    except Exception as e:
        db.rollback()
        print(f"Error in seed_db: {str(e)}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    seed_db()
