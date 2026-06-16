from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, Table, LargeBinary
from sqlalchemy.orm import relationship
from database import Base

class Organization(Base):
    __tablename__ = "organizations"

    id = Column(String, primary_key=True, index=True) # Single company key
    name = Column(String, nullable=False)
    created_at = Column(Integer)

    # Relationships
    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")
    departments = relationship("Department", back_populates="organization", cascade="all, delete-orphan")
    ai_configs = relationship("AIProviderConfig", back_populates="organization", cascade="all, delete-orphan")
    integrations = relationship("Integration", back_populates="organization", cascade="all, delete-orphan")
    frameworks = relationship("Framework", back_populates="organization", cascade="all, delete-orphan")
    controls = relationship("Control", back_populates="organization", cascade="all, delete-orphan")
    risks = relationship("Risk", back_populates="organization", cascade="all, delete-orphan")
    evidence = relationship("Evidence", back_populates="organization", cascade="all, delete-orphan")
    vendors = relationship("Vendor", back_populates="organization", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="organization", cascade="all, delete-orphan")
    policies = relationship("Policy", back_populates="organization", cascade="all, delete-orphan")
    policy_acknowledgments = relationship("PolicyAcknowledgment", back_populates="organization", cascade="all, delete-orphan")
    comments = relationship("AuditComment", back_populates="organization", cascade="all, delete-orphan")
    vector_chunks = relationship("VectorChunk", back_populates="organization", cascade="all, delete-orphan")
    control_status_events = relationship("ControlStatusEvent", back_populates="organization", cascade="all, delete-orphan")
    remediation_tasks = relationship("RemediationTask", back_populates="organization", cascade="all, delete-orphan")

class Department(Base):
    __tablename__ = "departments"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String, index=True, nullable=False)
    description = Column(String, nullable=True)
    status = Column(String, default="Active")
    created_at = Column(Integer)

    organization = relationship("Organization", back_populates="departments")

# Association table for many-to-many relationship between Controls and Risks
control_risk_association = Table(
    "control_risk_link",
    Base.metadata,
    Column("control_id", String, ForeignKey("controls.id", ondelete="CASCADE"), primary_key=True),
    Column("risk_id", String, ForeignKey("risks.id", ondelete="CASCADE"), primary_key=True)
)

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True) # Clerk user ID
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    email = Column(String, unique=True, index=True)
    name = Column(String)
    role = Column(String, default="Employee") # Admin, Editor, Auditor, Viewer, Employee
    department = Column(String, default="General")
    training_completed = Column(Boolean, default=False)
    background_check_passed = Column(Boolean, default=False)
    status = Column(String, default="Active") # Active, Onboarding, Offboarding

    # Relationships
    organization = relationship("Organization", back_populates="users")
    controls = relationship("Control", back_populates="owner")
    risks = relationship("Risk", back_populates="owner")
    assets = relationship("Asset", back_populates="owner")
    acknowledgments = relationship("PolicyAcknowledgment", back_populates="user")

class AIProviderConfig(Base):
    __tablename__ = "ai_provider_configs"

    id = Column(String, primary_key=True, index=True) # e.g. 'openai', 'claude', 'gemini', 'groq', etc.
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True, index=True)
    api_key = Column(String, nullable=True) # Authenticated encrypted value
    base_url = Column(String, nullable=True)
    model_override = Column(String, nullable=True)
    is_active = Column(Boolean, default=False)

    organization = relationship("Organization", back_populates="ai_configs")

class Integration(Base):
    __tablename__ = "integrations"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True, index=True)
    name = Column(String)
    category = Column(String) # Cloud, Identity, HRIS, EDR, Developer
    status = Column(String, default="Disconnected") # Connected, Error, Disconnected
    credentials = Column(String, nullable=True) # Encrypted
    last_sync = Column(Integer, nullable=True)
    last_audit_summary = Column(String, nullable=True) # Human-readable result of the last live sync

    organization = relationship("Organization", back_populates="integrations")


class Framework(Base):
    __tablename__ = "frameworks"

    id = Column(String, primary_key=True, index=True) # e.g. basel-iii, cbest, gdpr, soc-2, iso-27001, pci-dss
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String)
    code = Column(String)
    description = Column(String)
    readiness = Column(Float, default=0.0) # Readiness percent 0.0 - 100.0

    organization = relationship("Organization", back_populates="frameworks")

class Control(Base):
    __tablename__ = "controls"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    control_code = Column(String, index=True) # e.g. CET1-01, MFA-02
    title = Column(String)
    description = Column(String)
    frameworks = Column(String) # Comma-separated list of framework IDs
    status = Column(String, default="Failing") # Passing, Warning, Failing
    owner_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_tested = Column(Integer, nullable=True)

    # Relationships
    organization = relationship("Organization", back_populates="controls")
    owner = relationship("User", back_populates="controls")
    evidence = relationship("Evidence", back_populates="control")
    risks = relationship("Risk", secondary=control_risk_association, back_populates="mitigations")
    comments = relationship("AuditComment", back_populates="control")

class Risk(Base):
    __tablename__ = "risks"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    title = Column(String)
    category = Column(String) # Operational, Cyber, Credit, Regulatory, Compliance
    likelihood = Column(Integer, default=1) # 1 - 5
    impact = Column(Integer, default=1) # 1 - 5
    inherent_score = Column(Integer, default=1) # Likelihood * Impact (1 - 25)
    residual_score = Column(Integer, default=1) # Score after mitigations (1 - 25)
    status = Column(String, default="Open") # Open, Mitigated, Accepted
    owner_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    organization = relationship("Organization", back_populates="risks")
    owner = relationship("User", back_populates="risks")
    mitigations = relationship("Control", secondary=control_risk_association, back_populates="risks")

class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    title = Column(String)
    file_path = Column(String)
    file_size = Column(Integer)
    freshness = Column(String, default="Current") # Current, Expired, Expiring
    upload_time = Column(Integer)
    control_id = Column(String, ForeignKey("controls.id", ondelete="CASCADE"), nullable=True)

    organization = relationship("Organization", back_populates="evidence")
    control = relationship("Control", back_populates="evidence")

class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String)
    tier = Column(String, default="Low") # Critical, High, Medium, Low
    inherent_risk = Column(String, default="Low") # Critical, High, Medium, Low
    residual_risk = Column(String, default="Low")
    status = Column(String, default="Under Assessment") # Approved, Under Assessment, Flagged
    questionnaire_answers = Column(String, default="{}") # JSON representation
    last_assessment_date = Column(Integer, nullable=True)

    organization = relationship("Organization", back_populates="vendors")

class Asset(Base):
    __tablename__ = "assets"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String)
    type = Column(String) # Cloud Resource, Workstation, Repository, SaaS App
    owner_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    compliance_status = Column(String, default="Failing") # Passing, Warning, Failing
    is_in_scope = Column(Boolean, default=True)
    integration_id = Column(String, nullable=True)

    organization = relationship("Organization", back_populates="assets")
    owner = relationship("User", back_populates="assets")


class Policy(Base):
    __tablename__ = "policies"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    title = Column(String)
    file_path = Column(String, nullable=True)
    version = Column(String, default="1.0.0")
    status = Column(String, default="Draft") # Draft, Under Review, Approved

    organization = relationship("Organization", back_populates="policies")
    acknowledgments = relationship("PolicyAcknowledgment", back_populates="policy", cascade="all, delete-orphan")

class PolicyAcknowledgment(Base):
    __tablename__ = "policy_acknowledgments"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    policy_id = Column(String, ForeignKey("policies.id", ondelete="CASCADE"))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"))
    signed_at = Column(Integer)

    organization = relationship("Organization", back_populates="policy_acknowledgments")
    policy = relationship("Policy", back_populates="acknowledgments")
    user = relationship("User", back_populates="acknowledgments")

class AuditComment(Base):
    __tablename__ = "audit_comments"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    control_id = Column(String, ForeignKey("controls.id", ondelete="CASCADE"))
    sender_name = Column(String)
    comment_text = Column(String)
    timestamp = Column(Integer)

    organization = relationship("Organization", back_populates="comments")
    control = relationship("Control", back_populates="comments")

class VectorChunk(Base):
    __tablename__ = "vector_chunks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    filename = Column(String)
    page_number = Column(Integer)
    content = Column(String)
    embedding = Column(LargeBinary, nullable=True) # Stores the text-embedding-004 binary array of float32s

    organization = relationship("Organization", back_populates="vector_chunks")


class ControlStatusEvent(Base):
    """Append-only history of control status changes.

    Powers drift detection (a Passing control regressing to Failing/Warning)
    and historical readiness trends. Written whenever a control's status
    changes, primarily from connector syncs.
    """
    __tablename__ = "control_status_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    control_id = Column(String, ForeignKey("controls.id", ondelete="CASCADE"), index=True, nullable=True)
    control_code = Column(String, index=True)
    old_status = Column(String, nullable=True)
    new_status = Column(String)
    source = Column(String, default="sync")  # sync, manual, scheduler
    is_drift = Column(Boolean, default=False)  # Passing -> Failing/Warning regression
    acknowledged = Column(Boolean, default=False)
    detected_at = Column(Integer, index=True)

    organization = relationship("Organization", back_populates="control_status_events")


class RemediationTask(Base):
    """An actionable task to fix a failing/at-risk control."""
    __tablename__ = "remediation_tasks"

    id = Column(String, primary_key=True, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    control_id = Column(String, ForeignKey("controls.id", ondelete="SET NULL"), nullable=True)
    control_code = Column(String, nullable=True)
    owner_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    priority = Column(String, default="Medium")  # Critical, High, Medium, Low
    status = Column(String, default="Open")  # Open, In Progress, Blocked, Done
    due_date = Column(Integer, nullable=True)
    created_at = Column(Integer)
    updated_at = Column(Integer, nullable=True)

    organization = relationship("Organization", back_populates="remediation_tasks")
