"""Organization bootstrap.

This project ships with NO seeded business data. When an organization is
first provisioned we create only the empty Organization record plus the
configuration scaffolding the app needs to be usable:

  * AI provider catalog rows (all inactive; keys are supplied via Settings/.env)
  * Integration connector catalog rows (all Disconnected)

Everything else - frameworks, controls, risks, assets, policies, evidence,
vendors, users, departments - starts empty and is populated by the operator via
live connectors, document ingestion, and the UI.
"""

import time
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from database import engine, SessionLocal, Base
from models import Organization, AIProviderConfig, Integration
from integration_clients import INTEGRATION_CATALOG


def run_light_migrations():
    """Idempotently add columns introduced after the initial schema.

    create_all() never ALTERs existing tables, so older databases miss newly
    added columns. This keeps existing deployments working without a full reset.
    """
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        if "integrations" in tables:
            cols = {c["name"] for c in inspector.get_columns("integrations")}
            with engine.begin() as conn:
                if "last_audit_summary" not in cols:
                    conn.execute(text("ALTER TABLE integrations ADD COLUMN last_audit_summary VARCHAR"))
                if "last_audit_checks" not in cols:
                    conn.execute(text("ALTER TABLE integrations ADD COLUMN last_audit_checks JSON"))

        if "vector_chunks" in tables:
            cols = {c["name"] for c in inspector.get_columns("vector_chunks")}
            with engine.begin() as conn:
                if "regulatory_version" not in cols:
                    conn.execute(text("ALTER TABLE vector_chunks ADD COLUMN regulatory_version VARCHAR"))
                if "pii_redaction_count" not in cols:
                    conn.execute(text("ALTER TABLE vector_chunks ADD COLUMN pii_redaction_count INTEGER"))
                if "effective_date" not in cols:
                    conn.execute(text("ALTER TABLE vector_chunks ADD COLUMN effective_date VARCHAR"))
                if "expiration_date" not in cols:
                    conn.execute(text("ALTER TABLE vector_chunks ADD COLUMN expiration_date VARCHAR"))

        if "ai_provider_configs" in tables:
            cols = {c["name"] for c in inspector.get_columns("ai_provider_configs")}
            with engine.begin() as conn:
                if "tuning_status" not in cols:
                    conn.execute(text("ALTER TABLE ai_provider_configs ADD COLUMN tuning_status VARCHAR"))
                if "tuning_job_name" not in cols:
                    conn.execute(text("ALTER TABLE ai_provider_configs ADD COLUMN tuning_job_name VARCHAR"))
                if "tuning_result_model" not in cols:
                    conn.execute(text("ALTER TABLE ai_provider_configs ADD COLUMN tuning_result_model VARCHAR"))
                if "tuning_error" not in cols:
                    conn.execute(text("ALTER TABLE ai_provider_configs ADD COLUMN tuning_error VARCHAR"))

        if "feedback" in tables:
            cols = {c["name"] for c in inspector.get_columns("feedback")}
            if "transparency_rating" not in cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE feedback ADD COLUMN transparency_rating INTEGER"))
    except Exception as e:
        print(f"Light migration skipped: {e}")

DEFAULT_COMPANY_ID = "bank_enterprise"
DEFAULT_COMPANY_NAME = "Your Organization"

# AI provider catalog: Vertex AI (Gemini) only, authenticated via Application
# Default Credentials - no API key needed. The active provider is resolved at
# request time in ai_gateway (gemini auto-activates once usable). When it's
# not usable, AI features return an explicit "no model available" notice.
AI_PROVIDER_CATALOG = ["gemini"]


def ensure_ai_providers(db: Session, org_id: str):
    existing = {c.id for c in db.query(AIProviderConfig).filter_by(org_id=org_id).all()}
    for provider_id in AI_PROVIDER_CATALOG:
        if provider_id not in existing:
            db.add(AIProviderConfig(
                id=provider_id,
                org_id=org_id,
                is_active=False,
            ))
    db.commit()


def ensure_integration_catalog(db: Session, org_id: str):
    existing = {i.id for i in db.query(Integration).filter_by(org_id=org_id).all()}
    for entry in INTEGRATION_CATALOG:
        if entry["id"] not in existing:
            db.add(Integration(
                id=entry["id"],
                org_id=org_id,
                name=entry["name"],
                category=entry["category"],
                status="Disconnected",
            ))
    db.commit()


def seed_org_data(db: Session, org_id: str, org_name: str = None):
    """Provision an empty organization with config scaffolding only."""
    org_name = org_name or DEFAULT_COMPANY_NAME
    org = db.query(Organization).filter_by(id=org_id).first()
    if not org:
        org = Organization(id=org_id, name=org_name, created_at=int(time.time()))
        db.add(org)
        db.commit()

    ensure_ai_providers(db, org_id)
    ensure_integration_catalog(db, org_id)


def seed_db():
    """Create all tables and provision the default organization scaffolding."""
    Base.metadata.create_all(bind=engine)
    run_light_migrations()
    db: Session = SessionLocal()
    try:
        seed_org_data(db, DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME)
    except Exception as e:
        db.rollback()
        print(f"Error in seed_db: {str(e)}")
        raise e
    finally:
        db.close()


if __name__ == "__main__":
    seed_db()
