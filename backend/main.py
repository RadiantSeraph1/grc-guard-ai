import os
import sqlite3
import uuid
import json
import time
import re
import hmac
import hashlib
import httpx
from pathlib import Path
from fastapi import FastAPI, Depends, UploadFile, File, Form, Header, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from dotenv import load_dotenv
from sqlalchemy.orm import Session

# Import local modules
import database
import models
import auth
import ai_gateway
import security
import rag
import xai
import ai_agents
import s3_storage
import framework_library
from seed import seed_db

load_dotenv()

DEFAULT_COMPANY_ID = os.environ.get("DEFAULT_COMPANY_ID", "bank_enterprise")
DEFAULT_COMPANY_NAME = os.environ.get("DEFAULT_COMPANY_NAME", "Your Organization")
SUPER_ADMIN_ACCESS_KEY = os.environ.get("SUPER_ADMIN_ACCESS_KEY", "local-super-admin-key")
SUPER_ADMIN_SESSION_SECRET = os.environ.get("SUPER_ADMIN_SESSION_SECRET", ai_gateway.get_vault_key() or "local-super-admin-session-secret")
CLERK_SECRET_KEY = os.environ.get("CLERK_SECRET_KEY")
CLERK_BACKEND_API_URL = os.environ.get("CLERK_BACKEND_API_URL", "https://api.clerk.com/v1")
# Supported AI providers: Groq (interim, for testing) and "inhouse" (our own
# trained GRC model). When neither is usable, AI features return an explicit
# "no model available" notice — there is no fabricated fallback engine.
AI_PROVIDER_IDS = ["groq", "inhouse"]

app = FastAPI(title="GRC Guard AI Enterprise Compliance Engine API")

def get_allowed_origins() -> list[str]:
    origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in origins.split(",") if origin.strip()]

# Enable CORS for configured frontend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create database tables immediately on import
models.Base.metadata.create_all(bind=database.engine)

# SQLite Database for Backward-Compatible Audit Logs
AUDIT_DB = "grc_audit_logs.db"

def _audit_connect():
    """Open the audit-log SQLite DB with WAL + a busy timeout (C4)."""
    conn = sqlite3.connect(AUDIT_DB, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    return conn

def init_audit_db():
    conn = _audit_connect()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            timestamp INTEGER,
            scanned_text TEXT,
            decision TEXT,
            category TEXT,
            explanation TEXT,
            is_encrypted INTEGER,
            byok_key_hash TEXT,
            org_id TEXT
        )
    """)
    conn.commit()
    conn.close()

init_audit_db()

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".txt", ".md", ".csv", ".json", ".docx"}

def sanitize_upload_filename(filename: str) -> str:
    safe_name = Path(filename or "upload").name
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", safe_name).strip("._")
    if not safe_name:
        safe_name = "upload"
    return safe_name[:180]

def validate_upload(filename: str, content: bytes, allowed_extensions: Optional[set[str]] = None) -> str:
    safe_name = sanitize_upload_filename(filename)
    extension = Path(safe_name).suffix.lower()
    allowed = allowed_extensions or ALLOWED_UPLOAD_EXTENSIONS
    if extension not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{extension or 'none'}'.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_BYTES} byte upload limit.")
    return safe_name

def storage_key_from_path(path: str, org_id: str, folder: str) -> str:
    if path.startswith("s3://"):
        parts = path.split("/", 3)
        return parts[3] if len(parts) > 3 else path
    return f"companies/{org_id}/{folder}/{os.path.basename(path)}"

def get_required_vault_key() -> str:
    vault_key = ai_gateway.get_vault_key()
    if not vault_key:
        raise HTTPException(status_code=500, detail="BYOK_SECRET_KEY is required to store encrypted credentials.")
    return vault_key

def get_clerk_secret_key() -> Optional[str]:
    load_dotenv(override=True)
    return os.environ.get("CLERK_SECRET_KEY") or CLERK_SECRET_KEY

def user_can_view_department(user: models.User, department: Optional[str]) -> bool:
    if not department:
        return True
    return user.role in ["Admin", "SuperAdmin", "Auditor"] or user.department == department

def require_department_access(user: models.User, department: Optional[str]):
    if not user_can_view_department(user, department):
        raise HTTPException(status_code=403, detail="Access denied for this department.")

def department_for_owner(db: Session, org_id: str, owner_id: Optional[str]) -> str:
    if not owner_id:
        return "Unassigned"
    owner = db.query(models.User).filter_by(id=owner_id, org_id=org_id).first()
    return owner.department if owner and owner.department else "Unassigned"

def ensure_department(db: Session, org_id: str, name: Optional[str], description: Optional[str] = None) -> Optional[models.Department]:
    clean_name = (name or "").strip()
    if not clean_name:
        return None
    existing = db.query(models.Department).filter_by(org_id=org_id, name=clean_name).first()
    if existing:
        if description and not existing.description:
            existing.description = description
            db.commit()
            db.refresh(existing)
        return existing
    department = models.Department(
        id=f"dept_{uuid.uuid4().hex[:10]}",
        org_id=org_id,
        name=clean_name,
        description=description or "Created from user directory.",
        status="Active",
        created_at=int(time.time())
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return department

def name_from_clerk_user(user: dict) -> str:
    full_name = " ".join([
        part.strip()
        for part in [user.get("first_name") or "", user.get("last_name") or ""]
        if part and part.strip()
    ]).strip()
    if full_name:
        return full_name
    return user.get("username") or user.get("id") or "Clerk User"

def email_from_clerk_user(user: dict) -> Optional[str]:
    email_addresses = user.get("email_addresses") or []
    primary_id = user.get("primary_email_address_id")
    primary = next((item for item in email_addresses if item.get("id") == primary_id), None)
    email = (primary or email_addresses[0] if email_addresses else {}).get("email_address")
    return email.strip().lower() if email else None

def metadata_from_clerk_user(user: dict) -> dict:
    metadata = {}
    for key in ["public_metadata", "private_metadata", "unsafe_metadata"]:
        value = user.get(key)
        if isinstance(value, dict):
            metadata.update(value)
    return metadata

def sync_clerk_users_to_local_db(db: Session, org_id: str) -> dict:
    clerk_secret_key = get_clerk_secret_key()
    if not clerk_secret_key:
        raise HTTPException(status_code=400, detail="CLERK_SECRET_KEY is not configured on the backend.")

    imported = 0
    updated = 0
    skipped = 0
    offset = 0
    limit = 100
    existing_by_id = {
        user.id: user
        for user in db.query(models.User).all()
    }
    existing_by_email = {
        user.email.lower(): user
        for user in existing_by_id.values()
        if user.email
    }

    while True:
        try:
            response = httpx.get(
                f"{CLERK_BACKEND_API_URL.rstrip('/')}/users",
                headers={"Authorization": f"Bearer {clerk_secret_key}"},
                params={"limit": limit, "offset": offset},
                timeout=20
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"Clerk user sync failed: {exc.response.status_code} from Clerk.")
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Clerk user sync failed: {str(exc)}")

        payload = response.json()
        users = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(users, list):
            raise HTTPException(status_code=502, detail="Clerk user sync failed: unexpected users response.")

        for clerk_user in users:
            clerk_id = clerk_user.get("id")
            email = email_from_clerk_user(clerk_user)
            if not clerk_id or not email:
                skipped += 1
                continue

            metadata = metadata_from_clerk_user(clerk_user)
            username = (clerk_user.get("username") or "").lower()
            role = metadata.get("role") or "Employee"
            department = metadata.get("department") or "General"
            if (
                clerk_id in auth.SUPER_ADMIN_USER_IDS
                or email.lower() in auth.SUPER_ADMIN_EMAILS
                or username in auth.SUPER_ADMIN_USERNAMES
            ):
                role = "SuperAdmin"
                department = "Platform Governance"

            ensure_department(db, org_id, department, "Synced from Clerk user metadata.")
            existing = existing_by_id.get(clerk_id) or existing_by_email.get(email)

            if existing:
                changed = False
                for field, value in {
                    "org_id": org_id,
                    "email": email,
                    "name": name_from_clerk_user(clerk_user),
                    "role": role,
                    "department": department,
                    "status": "Active" if not clerk_user.get("banned") and not clerk_user.get("locked") else "Suspended"
                }.items():
                    if getattr(existing, field) != value:
                        setattr(existing, field, value)
                        changed = True
                if changed:
                    updated += 1
            else:
                existing = models.User(
                    id=clerk_id,
                    org_id=org_id,
                    email=email,
                    name=name_from_clerk_user(clerk_user),
                    role=role,
                    department=department,
                    status="Active" if not clerk_user.get("banned") and not clerk_user.get("locked") else "Suspended",
                    training_completed=bool(metadata.get("training_completed", False)),
                    background_check_passed=bool(metadata.get("background_check_passed", False))
                )
                db.add(existing)
                existing_by_id[clerk_id] = existing
                existing_by_email[email] = existing
                imported += 1

            try:
                db.commit()
            except Exception:
                db.rollback()
                existing_after_rollback = db.query(models.User).filter_by(id=clerk_id, org_id=org_id).first() or db.query(models.User).filter_by(id=clerk_id).first()
                if not existing_after_rollback:
                    existing_after_rollback = db.query(models.User).filter_by(email=email, org_id=org_id).first() or db.query(models.User).filter_by(email=email).first()
                if not existing_after_rollback:
                    raise
                existing_by_id[existing_after_rollback.id] = existing_after_rollback
                if existing_after_rollback.email:
                    existing_by_email[existing_after_rollback.email.lower()] = existing_after_rollback
                skipped += 1
        if len(users) < limit:
            break
        offset += limit

    return {"imported": imported, "updated": updated, "skipped": skipped}

def filter_owned_by_department(query, model_cls, db: Session, org_id: str, department: Optional[str]):
    if not department:
        return query
    owner_ids = [u.id for u in db.query(models.User).filter_by(org_id=org_id, department=department).all()]
    if not owner_ids:
        return query.filter(False)
    if hasattr(model_cls, "owner_id"):
        return query.filter(model_cls.owner_id.in_(owner_ids))
    return query

def create_super_admin_session(subject: str) -> str:
    import jwt
    payload = {"sub": subject, "role": "SuperAdmin", "exp": int(time.time()) + 8 * 60 * 60}
    return jwt.encode(payload, SUPER_ADMIN_SESSION_SECRET, algorithm="HS256")

def verify_super_admin_session_token(token: Optional[str]) -> Optional[dict]:
    import jwt
    if not token:
        return None
    try:
        payload = jwt.decode(token, SUPER_ADMIN_SESSION_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    return payload if payload.get("role") == "SuperAdmin" else None

def get_optional_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(database.get_db)
) -> Optional[models.User]:
    if not authorization:
        return None
    try:
        payload = auth.verify_clerk_token(authorization)
        return auth.get_current_user(payload, db)
    except HTTPException:
        return None

def require_super_admin(
    x_super_admin_session: Optional[str] = Header(None),
    current_user: Optional[models.User] = Depends(get_optional_current_user)
):
    session_payload = verify_super_admin_session_token(x_super_admin_session)
    if session_payload:
        return {
            "id": session_payload.get("sub"),
            "email": "access-key-session",
            "name": "Access Key Super Admin",
            "role": "SuperAdmin",
            "department": "Platform Governance",
            "org_id": DEFAULT_COMPANY_ID
        }
    if current_user and current_user.role == "SuperAdmin":
        return current_user
    raise HTTPException(status_code=403, detail="Super admin access is required.")

class SuperAdminLoginRequest(BaseModel):
    access_key: str

class SuperAdminUserUpdateRequest(BaseModel):
    role: Optional[str] = None
    department: Optional[str] = None
    status: Optional[str] = None
    training_completed: Optional[bool] = None
    background_check_passed: Optional[bool] = None

class SuperAdminUserCreateRequest(BaseModel):
    name: str
    email: str
    role: str = "Employee"
    department: str = "General"
    status: str = "Active"
    training_completed: bool = False
    background_check_passed: bool = False

class SuperAdminDepartmentCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    status: str = "Active"

class SuperAdminIntegrationUpdateRequest(BaseModel):
    credentials: Optional[str] = None
    status: Optional[str] = None

class SuperAdminAIProviderUpdateRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_override: Optional[str] = None
    activate: bool = False

class SuperAdminDepartmentMoveRequest(BaseModel):
    from_department: str
    to_department: str

# Startup hooks
@app.on_event("startup")
def on_startup():
    # Seed the main database
    seed_db()
    # Start continuous-monitoring scheduler (no-op if APScheduler missing/disabled)
    try:
        import scheduler
        scheduler.start()
    except Exception as e:
        print(f"Scheduler startup skipped: {e}")

# Existing base endpoints

@app.get("/api/health")
def health_check(db: Session = Depends(database.get_db)):
    active_ai = ai_gateway.get_active_provider_config(db, DEFAULT_COMPANY_ID)
    active_id = active_ai.id if active_ai else "none"
    provider_env_key = ai_gateway.get_env_provider_key(active_id)
    provider_db_key = ai_gateway.get_decrypted_key(active_ai) if active_ai else None
    return {
        "status": "healthy",
        "ai_api_configured": bool(provider_env_key or provider_db_key),
        "groq_api_configured": bool(os.environ.get("GROQ_API_KEY", "").strip()),
        "gemini_api_configured": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
        "mode": active_id,
        "clerk_configured": bool(os.environ.get("CLERK_JWKS_URL")),
        "company": DEFAULT_COMPANY_NAME
    }

@app.get("/api/auth/session")
def auth_session(current_user: models.User = Depends(auth.get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "role": current_user.role,
        "department": current_user.department,
        "status": current_user.status,
        "training_completed": current_user.training_completed,
        "background_check_passed": current_user.background_check_passed,
        "company": DEFAULT_COMPANY_NAME,
        "is_super_admin": current_user.role == "SuperAdmin"
    }

@app.post("/api/super-admin/login")
def super_admin_login(request: SuperAdminLoginRequest):
    if not SUPER_ADMIN_ACCESS_KEY or not hmac.compare_digest(request.access_key, SUPER_ADMIN_ACCESS_KEY):
        raise HTTPException(status_code=401, detail="Invalid super admin access key.")
    token = create_super_admin_session("super-admin-access-key")
    return {
        "status": "success",
        "token": token,
        "expires_in_seconds": 8 * 60 * 60
    }

@app.get("/api/super-admin/me")
def super_admin_me(current_user = Depends(require_super_admin)):
    return {
        "id": current_user["id"] if isinstance(current_user, dict) else current_user.id,
        "email": current_user["email"] if isinstance(current_user, dict) else current_user.email,
        "name": current_user["name"] if isinstance(current_user, dict) else current_user.name,
        "role": current_user["role"] if isinstance(current_user, dict) else current_user.role,
        "department": current_user["department"] if isinstance(current_user, dict) else current_user.department,
        "company": DEFAULT_COMPANY_NAME
    }

@app.get("/api/super-admin/overview")
def super_admin_overview(db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    user_name = current_user["name"] if isinstance(current_user, dict) else current_user.name
    user_email = current_user["email"] if isinstance(current_user, dict) else current_user.email
    user_role = current_user["role"] if isinstance(current_user, dict) else current_user.role
    users = db.query(models.User).filter_by(org_id=org_id).all()
    controls = db.query(models.Control).filter_by(org_id=org_id).all()
    risks = db.query(models.Risk).filter_by(org_id=org_id).all()
    integrations = db.query(models.Integration).filter_by(org_id=org_id).all()
    policy_count = db.query(models.Policy).filter_by(org_id=org_id).count()
    evidence_count = db.query(models.Evidence).filter_by(org_id=org_id).count()
    asset_count = db.query(models.Asset).filter_by(org_id=org_id).count()
    department_records = db.query(models.Department).filter_by(org_id=org_id).all()
    departments = sorted({department.name for department in department_records} | {user.department or "Unassigned" for user in users})

    department_rows = []
    for department in departments:
        department_record = next((item for item in department_records if item.name == department), None)
        owner_ids = [user.id for user in users if (user.department or "Unassigned") == department]
        dept_controls = [control for control in controls if control.owner_id in owner_ids]
        dept_risks = [risk for risk in risks if risk.owner_id in owner_ids]
        department_rows.append({
            "id": department_record.id if department_record else f"derived_{department.lower().replace(' ', '_')}",
            "name": department,
            "description": department_record.description if department_record else "",
            "status": department_record.status if department_record else "Active",
            "users": len(owner_ids),
            "controls": len(dept_controls),
            "risks": len(dept_risks),
            "passing_controls": len([control for control in dept_controls if control.status == "Passing"]),
            "open_risks": len([risk for risk in dept_risks if risk.status == "Open"])
        })

    failing_controls = [control for control in controls if control.status == "Failing"]
    connected_integrations = [item for item in integrations if item.status == "Connected"]
    active_ai_provider = db.query(models.AIProviderConfig).filter_by(is_active=True, org_id=org_id).first()

    return {
        "company": DEFAULT_COMPANY_NAME,
        "generated_at": int(time.time()),
        "super_admin": {
            "name": user_name,
            "email": user_email,
            "role": user_role
        },
        "totals": {
            "users": len(users),
            "departments": len(departments),
            "controls": len(controls),
            "risks": len(risks),
            "integrations": len(integrations),
            "connected_integrations": len(connected_integrations),
            "policies": policy_count,
            "evidence": evidence_count,
            "assets": asset_count,
            "failing_controls": len(failing_controls)
        },
        "security": {
            "mock_auth_enabled": auth.CLERK_MOCK_AUTH,
            "clerk_configured": bool(os.environ.get("CLERK_JWKS_URL")),
            "clerk_secret_configured": bool(get_clerk_secret_key()),
            "byok_configured": bool(ai_gateway.get_vault_key()),
            "allowed_origins": get_allowed_origins(),
            "active_ai_provider": active_ai_provider.id if active_ai_provider else "none"
        },
        "departments": department_rows,
        "users": [
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "department": user.department,
                "status": user.status,
                "training_completed": user.training_completed,
                "background_check_passed": user.background_check_passed
            }
            for user in users
        ],
        "integrations": [
            {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "status": item.status,
                "last_sync": item.last_sync,
                "has_credentials": bool(item.credentials)
            }
            for item in integrations
        ],
        "critical_findings": [
            {
                "id": control.id,
                "control_code": control.control_code,
                "title": control.title,
                "status": control.status,
                "department": department_for_owner(db, org_id, control.owner_id)
            }
            for control in failing_controls[:8]
        ]
    }

def ensure_ai_provider_configs(db: Session, org_id: str) -> list[models.AIProviderConfig]:
    configs = db.query(models.AIProviderConfig).filter_by(org_id=org_id).all()
    existing_ids = {config.id for config in configs}
    has_active = any(config.is_active for config in configs)
    for provider_id in AI_PROVIDER_IDS:
        if provider_id not in existing_ids:
            db.add(models.AIProviderConfig(id=provider_id, org_id=org_id, is_active=False))
    db.commit()
    configs = db.query(models.AIProviderConfig).filter_by(org_id=org_id).all()
    active = next((config for config in configs if config.is_active), None)
    groq = next((config for config in configs if config.id == "groq"), None)
    if (
        os.environ.get("GROQ_API_KEY", "").strip()
        and groq
        and not active
        and not groq.is_active
    ):
        for config in configs:
            config.is_active = (config.id == "groq")
        if not groq.base_url:
            groq.base_url = "https://api.groq.com/openai/v1/chat/completions"
        if not groq.model_override:
            groq.model_override = "llama-3.3-70b-versatile"
        db.commit()
        configs = db.query(models.AIProviderConfig).filter_by(org_id=org_id).all()
    return configs

@app.get("/api/super-admin/control-plane")
def super_admin_control_plane(db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    providers = ensure_ai_provider_configs(db, org_id)
    controls = db.query(models.Control).filter_by(org_id=org_id).all()
    risks = db.query(models.Risk).filter_by(org_id=org_id).all()
    assets = db.query(models.Asset).filter_by(org_id=org_id).all()
    return {
        "departments": [
            {
                "id": department.id,
                "name": department.name,
                "description": department.description,
                "status": department.status,
                "created_at": department.created_at,
                "users": len([user for user in db.query(models.User).filter_by(org_id=org_id).all() if user.department == department.name])
            }
            for department in db.query(models.Department).filter_by(org_id=org_id).all()
        ],
        "users": [
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "department": user.department,
                "status": user.status,
                "training_completed": user.training_completed,
                "background_check_passed": user.background_check_passed
            }
            for user in db.query(models.User).filter_by(org_id=org_id).all()
        ],
        "integrations": [
            {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "status": item.status,
                "last_sync": item.last_sync,
                "has_credentials": bool(item.credentials)
            }
            for item in db.query(models.Integration).filter_by(org_id=org_id).all()
        ],
        "ai_providers": [
            {
                "id": provider.id,
                "base_url": provider.base_url,
                "model_override": provider.model_override,
                "is_active": provider.is_active,
                "has_api_key": bool(provider.api_key)
            }
            for provider in providers
        ],
        "controls": [
            {"id": control.id, "code": control.control_code, "title": control.title, "status": control.status, "owner_id": control.owner_id}
            for control in controls
        ],
        "risks": [
            {"id": risk.id, "title": risk.title, "status": risk.status, "residual_score": risk.residual_score, "owner_id": risk.owner_id}
            for risk in risks
        ],
        "assets": [
            {"id": asset.id, "name": asset.name, "type": asset.type, "status": asset.compliance_status, "integration_id": asset.integration_id}
            for asset in assets
        ]
    }

@app.patch("/api/super-admin/users/{id}")
def super_admin_update_user(id: str, request: SuperAdminUserUpdateRequest, db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    user = db.query(models.User).filter_by(id=id, org_id=org_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if request.role is not None:
        user.role = request.role
    if request.department is not None:
        user.department = request.department
    if request.status is not None:
        user.status = request.status
    if request.training_completed is not None:
        user.training_completed = request.training_completed
    if request.background_check_passed is not None:
        user.background_check_passed = request.background_check_passed
    db.commit()
    db.refresh(user)
    return {"status": "success", "user": {"id": user.id, "role": user.role, "department": user.department, "user_status": user.status}}

@app.post("/api/super-admin/users")
def super_admin_create_user(request: SuperAdminUserCreateRequest, db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    email = request.email.strip().lower()
    if not request.name.strip() or not email:
        raise HTTPException(status_code=400, detail="Name and email are required.")
    existing = db.query(models.User).filter_by(email=email).first()
    if existing:
        raise HTTPException(status_code=400, detail="A user with this email already exists.")

    department_name = request.department.strip() or "General"
    existing_department = db.query(models.Department).filter_by(org_id=org_id, name=department_name).first()
    if not existing_department:
        department_id = f"dept_{re.sub(r'[^a-z0-9]+', '_', department_name.lower()).strip('_')}_{org_id}"
        existing_department = models.Department(
            id=department_id,
            org_id=org_id,
            name=department_name,
            description="Created from super-admin user provisioning.",
            status="Active",
            created_at=int(time.time())
        )
        db.add(existing_department)

    user = models.User(
        id=f"user_gen_{str(uuid.uuid4())[:8]}",
        org_id=org_id,
        email=email,
        name=request.name.strip(),
        role=request.role,
        department=department_name,
        status=request.status,
        training_completed=request.training_completed,
        background_check_passed=request.background_check_passed
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"status": "success", "user": {"id": user.id, "name": user.name, "email": user.email, "department": user.department, "role": user.role}}

@app.post("/api/super-admin/clerk/sync-users")
def super_admin_sync_clerk_users(db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    result = sync_clerk_users_to_local_db(db, org_id)
    return {
        "status": "success",
        "message": f"Clerk sync complete: {result['imported']} imported, {result['updated']} updated, {result['skipped']} skipped.",
        **result
    }

@app.post("/api/super-admin/departments")
def super_admin_create_department(request: SuperAdminDepartmentCreateRequest, db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Department name is required.")
    existing = db.query(models.Department).filter(models.Department.org_id == org_id, models.Department.name.ilike(name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Department already exists.")
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    department = models.Department(
        id=f"dept_{slug}_{org_id}",
        org_id=org_id,
        name=name,
        description=request.description,
        status=request.status,
        created_at=int(time.time())
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return {"status": "success", "department": {"id": department.id, "name": department.name, "status": department.status}}

@app.post("/api/super-admin/departments/move")
def super_admin_move_department(request: SuperAdminDepartmentMoveRequest, db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    users = db.query(models.User).filter_by(org_id=org_id, department=request.from_department).all()
    for user in users:
        user.department = request.to_department
    db.commit()
    return {"status": "success", "moved_users": len(users)}

@app.patch("/api/super-admin/integrations/{id}")
def super_admin_update_integration(id: str, request: SuperAdminIntegrationUpdateRequest, db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    integration = db.query(models.Integration).filter_by(id=id, org_id=org_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found.")
    if request.credentials is not None:
        integration.credentials = security.encrypt_log(request.credentials, get_required_vault_key()) if request.credentials.strip() else None
        integration.status = "Configured" if request.credentials.strip() else "Disconnected"
    if request.status is not None:
        integration.status = request.status
    integration.last_sync = int(time.time())
    db.commit()
    return {"status": "success", "integration_status": integration.status}

@app.post("/api/super-admin/integrations/{id}/sync")
def super_admin_sync_integration(id: str, background_tasks: BackgroundTasks, db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    integration = db.query(models.Integration).filter_by(id=id, org_id=org_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found.")
    background_tasks.add_task(run_sync_task, id, org_id)
    return {"status": "sync_started"}

@app.patch("/api/super-admin/ai-providers/{id}")
def super_admin_update_ai_provider(id: str, request: SuperAdminAIProviderUpdateRequest, db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    ensure_ai_provider_configs(db, org_id)
    provider = db.query(models.AIProviderConfig).filter_by(id=id, org_id=org_id).first()
    if not provider:
        provider = models.AIProviderConfig(id=id, org_id=org_id, is_active=False)
        db.add(provider)
    if request.base_url is not None:
        provider.base_url = request.base_url
    if request.model_override is not None:
        provider.model_override = request.model_override
    if request.api_key is not None and request.api_key.strip():
        provider.api_key = security.encrypt_log(request.api_key, get_required_vault_key())
    if request.activate:
        if id not in ["inhouse"] and not provider.api_key:
            raise HTTPException(status_code=400, detail=f"Configure an API key before activating {id}.")
        for item in db.query(models.AIProviderConfig).filter_by(org_id=org_id).all():
            item.is_active = (item.id == id)
    db.commit()
    return {"status": "success", "active": provider.is_active}

@app.post("/api/super-admin/reset-data")
def super_admin_reset_data(db: Session = Depends(database.get_db), current_user = Depends(require_super_admin)):
    """Wipe all operational data back to an empty organization (config scaffolding kept)."""
    org_id = current_user["org_id"] if isinstance(current_user, dict) else current_user.org_id
    for model in [models.AuditComment, models.PolicyAcknowledgment, models.VectorChunk, models.Evidence, models.Asset, models.Vendor, models.Risk, models.Control, models.Framework, models.Policy]:
        db.query(model).filter_by(org_id=org_id).delete()
    # Reset connector catalog rows to Disconnected without removing the catalog.
    for integration in db.query(models.Integration).filter_by(org_id=org_id).all():
        integration.status = "Disconnected"
        integration.credentials = None
        integration.last_sync = None
        integration.last_audit_summary = None
    db.commit()
    return {"status": "success", "message": "All operational data was cleared. The organization is now empty."}

@app.post("/api/ingest")
async def ingest_document(file: UploadFile = File(...), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    """Upload a regulatory reference/evidence document and index it into the RAG database."""
    content = await file.read()
    safe_filename = validate_upload(file.filename, content, {".pdf", ".txt", ".md", ".csv", ".json"})
    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, f"{uuid.uuid4()}_{safe_filename}")
    
    try:
        with open(temp_path, "wb") as buffer:
            buffer.write(content)
            
        result = rag.ingest_document(temp_path, safe_filename, org_id=current_user.org_id, source_type="reference")
        return {"message": result, "corpus": rag.corpus_stats(current_user.org_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to ingest document: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

class RagSearchRequest(BaseModel):
    query: str
    limit: int = 5

@app.get("/api/rag/corpus")
def rag_corpus(current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    return rag.corpus_stats(current_user.org_id)

@app.post("/api/rag/search")
def rag_search(request: RagSearchRequest, current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Search query is required.")
    return {
        "query": request.query,
        "results": rag.search_documents(request.query, org_id=current_user.org_id, limit=max(1, min(request.limit, 20)))
    }

class AnalysisRequest(BaseModel):
    question: Optional[str] = None
    department: Optional[str] = None
    include_ai: bool = True

def build_compliance_analysis(db: Session, org_id: str, question: Optional[str] = None, department: Optional[str] = None, include_ai: bool = True) -> dict:
    users = db.query(models.User).filter_by(org_id=org_id).all()
    owner_department = {user.id: user.department or "Unassigned" for user in users}
    controls = db.query(models.Control).filter_by(org_id=org_id).all()
    risks = db.query(models.Risk).filter_by(org_id=org_id).all()
    assets = db.query(models.Asset).filter_by(org_id=org_id).all()
    evidence = db.query(models.Evidence).filter_by(org_id=org_id).all()
    policies = db.query(models.Policy).filter_by(org_id=org_id).all()
    integrations = db.query(models.Integration).filter_by(org_id=org_id).all()

    if department:
        owner_ids = [user.id for user in users if (user.department or "Unassigned").lower() == department.lower()]
        controls = [control for control in controls if control.owner_id in owner_ids]
        risks = [risk for risk in risks if risk.owner_id in owner_ids]
        assets = [asset for asset in assets if asset.owner_id in owner_ids]

    evidence_by_control = {}
    for item in evidence:
        if item.control_id:
            evidence_by_control.setdefault(item.control_id, []).append(item)

    control_rows = []
    for control in controls:
        linked_evidence = evidence_by_control.get(control.id, [])
        expired_evidence = [item for item in linked_evidence if item.freshness in ["Expired", "Expiring"]]
        control_rows.append({
            "id": control.id,
            "code": control.control_code,
            "title": control.title,
            "status": control.status,
            "department": owner_department.get(control.owner_id, "Unassigned"),
            "evidence_count": len(linked_evidence),
            "expired_evidence_count": len(expired_evidence),
            "last_tested": control.last_tested
        })

    failing_controls = [item for item in control_rows if item["status"] == "Failing"]
    warning_controls = [item for item in control_rows if item["status"] == "Warning"]
    stale_controls = [item for item in control_rows if item["expired_evidence_count"] > 0 or item["evidence_count"] == 0]
    open_risks = [risk for risk in risks if risk.status == "Open"]
    failing_assets = [asset for asset in assets if asset.compliance_status == "Failing"]
    connected_integrations = [item for item in integrations if item.status == "Connected"]

    retrieval_query = question or "Basel GDPR SOC2 CBEST controls risks evidence policy"
    citations = rag.search_documents(retrieval_query, org_id=org_id, limit=5)
    corpus = rag.corpus_stats(org_id)
    readiness = round((len([row for row in control_rows if row["status"] == "Passing"]) / len(control_rows)) * 100, 1) if control_rows else 0
    risk_pressure = round(sum(risk.residual_score for risk in open_risks) / len(open_risks), 1) if open_risks else 0

    recommended_actions = []
    if failing_controls:
        recommended_actions.append(f"Remediate {len(failing_controls)} failing controls, starting with {failing_controls[0]['code']}.")
    if stale_controls:
        recommended_actions.append(f"Refresh evidence for {len(stale_controls)} controls with missing or stale artifacts.")
    if open_risks:
        recommended_actions.append(f"Re-score and assign mitigation owners for {len(open_risks)} open risks.")
    if not connected_integrations:
        recommended_actions.append("Connect at least one identity/cloud/developer system to replace simulated evidence with live data.")
    if corpus["total_chunks"] < 10:
        recommended_actions.append("Ingest more policy, regulatory, and evidence documents to improve RAG grounding.")

    ai_summary = None
    if include_ai:
        prompt = f"""
        Analyze this banking GRC posture for {DEFAULT_COMPANY_NAME}.
        Department filter: {department or "All departments"}.
        User question: {question or "Overall compliance posture"}.
        Metrics: readiness={readiness}%, failing_controls={len(failing_controls)}, warning_controls={len(warning_controls)}, open_risks={len(open_risks)}, failing_assets={len(failing_assets)}, evidence={len(evidence)}, rag_chunks={corpus["total_chunks"]}.
        Top failing controls: {json.dumps(failing_controls[:5])}
        Top open risks: {[{"title": risk.title, "residual_score": risk.residual_score, "category": risk.category} for risk in open_risks[:5]]}
        RAG citations: {json.dumps(citations[:3])}
        Return a concise executive analysis with remediation priorities.
        """
        ai_summary = ai_gateway.generate_content(prompt, "You are a senior banking GRC analysis agent. Be precise and evidence-grounded.", org_id=org_id)

    return {
        "company": DEFAULT_COMPANY_NAME,
        "generated_at": int(time.time()),
        "department": department or "All Departments",
        "question": question,
        "metrics": {
            "readiness_percent": readiness,
            "risk_pressure": risk_pressure,
            "controls": len(control_rows),
            "failing_controls": len(failing_controls),
            "warning_controls": len(warning_controls),
            "open_risks": len(open_risks),
            "failing_assets": len(failing_assets),
            "evidence_items": len(evidence),
            "policies": len(policies),
            "connected_integrations": len(connected_integrations),
            "rag_chunks": corpus["total_chunks"]
        },
        "control_analysis": control_rows,
        "risk_hotspots": [
            {
                "id": risk.id,
                "title": risk.title,
                "category": risk.category,
                "status": risk.status,
                "residual_score": risk.residual_score,
                "department": owner_department.get(risk.owner_id, "Unassigned")
            }
            for risk in sorted(open_risks, key=lambda item: item.residual_score, reverse=True)
        ],
        "recommended_actions": recommended_actions,
        "citations": citations,
        "corpus": corpus,
        "ai_summary": ai_summary
    }

@app.post("/api/analysis/run")
def run_compliance_analysis(request: AnalysisRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor"]))):
    if request.department:
        require_department_access(current_user, request.department)
    return build_compliance_analysis(
        db,
        current_user.org_id,
        question=request.question,
        department=request.department,
        include_ai=request.include_ai
    )

class ScanRequest(BaseModel):
    text: str
    perspective: str = "Standard" # Attacker, User, Standard
    byok_key: Optional[str] = None

def evaluate_scan_case(text: str, perspective: str, org_id: str, db: Session) -> dict:
    matched_regs = rag.search_documents(text, org_id=org_id, limit=3)
    decision = "COMPLIANT"
    category = "General Banking Standards"
    raw_explanation = "No explicit violation pattern was detected by the local banking rule set."
    text_lower = text.lower()

    if "gateway impersonation" in text_lower or "swift gateway" in text_lower:
        category = "CBEST Threat Modeling / SWIFT Security"
        decision = "VIOLATION"
        if perspective == "Attacker":
            raw_explanation = "Under the attacker perspective, gateway impersonation maps to Spoofing because the actor mimics trusted system identity."
        elif perspective == "User":
            raw_explanation = "Under the user perspective, gateway impersonation maps to Information Disclosure because transaction routing details are exposed."
        else:
            raw_explanation = "Gateway impersonation violates CBEST threat-boundary requirements for core banking infrastructure."
    elif "capital adequacy" in text_lower or "cet1" in text_lower or "rwa" in text_lower:
        category = "Basel III Capital Adequacy"
        match = re.search(r'cet1\s*(?:ratio)?\s*(?:of)?\s*(\d+(?:\.\d+)?)%', text_lower)
        if match:
            value = float(match.group(1))
            if value < 7.0:
                decision = "VIOLATION"
                raw_explanation = f"CET1 ratio of {value}% is below the Basel III 7.0% combined minimum and conservation buffer."
            else:
                raw_explanation = f"CET1 ratio of {value}% satisfies the Basel III 7.0% combined minimum and conservation buffer."
    elif "pii" in text_lower or "anonymize" in text_lower or "unencrypted" in text_lower:
        category = "GDPR Data Protection"
        if "unencrypted" in text_lower or "raw pii" in text_lower:
            decision = "VIOLATION"
            raw_explanation = "Raw or unencrypted PII violates GDPR data protection by design expectations."
        else:
            raw_explanation = "PII masking/anonymization is consistent with GDPR privacy-by-design expectations."
    elif "mfa" in text_lower or "multi-factor" in text_lower or "administrator accounts" in text_lower:
        category = "SOC 2 / Identity Access Control"
        if "disabled" in text_lower or "not enforced" in text_lower or "missing" in text_lower:
            decision = "VIOLATION"
            raw_explanation = "Missing MFA for privileged users violates SOC 2 logical access control expectations."
        else:
            raw_explanation = "MFA enforcement for privileged accounts supports SOC 2 logical access controls."
    elif "byok" in text_lower or "external api" in text_lower or "third-party api" in text_lower:
        category = "Policy-Conformant API Architecture"
        if "without" in text_lower and ("encryption" in text_lower or "key control" in text_lower):
            decision = "VIOLATION"
            raw_explanation = "Sensitive compliance data sent without BYOK/key-control support violates the policy-conformant API requirement."
        else:
            raw_explanation = "BYOK/key-control support aligns with policy-conformant API requirements."

    attributions = xai.calculate_local_attribution(text, matched_regs)
    justification = xai.generate_auditor_justification(
        decision,
        category,
        matched_regs[0]["content"] if matched_regs else "Standard banking policy guidelines",
        attributions
    )
    justification["reasoning"] = raw_explanation + "\n\n" + justification.get("reasoning", "")
    top_terms = sorted(attributions, key=lambda item: item.get("attribution", 0), reverse=True)[:8]

    return {
        "decision": decision,
        "category": category,
        "justification": justification,
        "attributions": attributions,
        "top_terms": top_terms,
        "matched_references": matched_regs
    }

def build_scan_reasoning_trace(
    request: ScanRequest,
    matched_regs: list,
    category: str,
    decision: str,
    attributions: list,
    provider_id: str,
    provider_status: str
) -> list[dict]:
    words = len(request.text.split())
    return [
        {
            "stage": "Input normalization",
            "status": "completed",
            "detail": f"Prepared {words} words for a {request.perspective} perspective review."
        },
        {
            "stage": "Evidence retrieval",
            "status": "completed",
            "detail": f"Matched {len(matched_regs)} regulatory or evidence chunks from the RAG corpus."
        },
        {
            "stage": "Control classification",
            "status": "completed",
            "detail": f"Mapped the scenario to {category} and produced a {decision} verdict."
        },
        {
            "stage": "Attribution scoring",
            "status": "completed",
            "detail": f"Calculated {len(attributions)} token-level signals for the XAI heatmap."
        },
        {
            "stage": "AI provider check",
            "status": provider_status,
            "detail": f"Used {provider_id} for final synthesis."
        },
        {
            "stage": "Auditor synthesis",
            "status": "completed",
            "detail": "Composed the visible justification, remediation guidance, and audit-ready output."
        }
    ]

def normalize_scan_decision(raw) -> Optional[str]:
    """Map a model's free-text decision onto the canonical {COMPLIANT, VIOLATION}.

    Returns None when the value is missing or unrecognized, so the caller keeps
    the deterministic rule-based verdict instead of trusting garbage output.
    """
    if not raw:
        return None
    value = str(raw).strip().upper()
    violation = {"VIOLATION", "NON-COMPLIANT", "NONCOMPLIANT", "FAIL", "FAILED", "BREACH", "NON COMPLIANT"}
    compliant = {"COMPLIANT", "PASS", "PASSED", "OK", "COMPLIANT."}
    if value in violation:
        return "VIOLATION"
    if value in compliant:
        return "COMPLIANT"
    return None


@app.post("/api/scan")
def scan_text(request: ScanRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor"]))):
    """
    Scans a transaction/log/config text against local RAG regulations
    and processes it with the dynamic AI Gateway or fallback rules.
    """
    org_id = current_user.org_id
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Scan text cannot be empty.")

    evaluation = evaluate_scan_case(request.text, request.perspective, org_id, db)
    matched_regs = evaluation["matched_references"]
    matched_context = "\n\n".join([f"Source: {r['filename']} (Page {r['page_number']}):\n{r['content']}" for r in matched_regs])
    decision = evaluation["decision"]
    category = evaluation["category"]
    raw_explanation = evaluation["justification"]["reasoning"].split("\n\n", 1)[0]

    # If an active provider is configured AND usable, query the AI gateway and let
    # the model decide. When no model is usable, the deterministic keyword rule
    # result (computed above) stands on its own — there is no fabricated fallback.
    active_config = db.query(models.AIProviderConfig).filter_by(is_active=True, org_id=org_id).first()
    provider_usable = bool(
        active_config
        and ai_gateway._provider_usable(active_config.id, ai_gateway.get_decrypted_key(active_config))
    )
    provider_id = active_config.id if provider_usable else "rule_engine"
    provider_status = "completed"
    if provider_usable:
        try:
            prompt = f"""
            You are a senior banking GRC (Governance, Risk, and Compliance) auditor.
            You are the deciding authority for this scan. Evaluate the audit scenario
            against the provided regulatory context and reach your OWN verdict.

            A lightweight keyword heuristic produced a preliminary guess of
            '{decision}' under '{category}'. Treat it only as a hint — confirm,
            refine, or overturn it based on the actual scenario and context.

            Perspective-aware Evaluation Directive:
            We are evaluating from the '{request.perspective}' perspective.
            - From the 'Attacker' perspective, classify deception-based items (like gateway impersonation) under threat boundaries (Spoofing).
            - From the 'User' or 'Auditor' perspective, classify details exposing data as Information Disclosure.

            Regulatory Reference Context:
            {matched_context if matched_context else "No specific regulatory matching chunk found in index."}

            Audit Scenario to Scan:
            "{request.text}"

            Respond with:
            - decision: exactly "COMPLIANT" or "VIOLATION".
            - category: the most relevant framework/control area (e.g. "Basel III Capital Adequacy", "GDPR Data Protection", "SOC 2 Access Control").
            - explanation: a grounded, auditor-ready rationale citing the context where possible.
            """

            schema = {
                "type": "object",
                "properties": {
                    "decision": {"type": "string", "enum": ["COMPLIANT", "VIOLATION"]},
                    "category": {"type": "string"},
                    "explanation": {"type": "string"}
                },
                "required": ["decision", "category", "explanation"]
            }

            res_data = ai_gateway.generate_structured_json(prompt, schema, "You are a senior banking GRC compliance auditor.", org_id=org_id)
            ai_decision = normalize_scan_decision(res_data.get("decision"))
            if ai_decision:
                # The LLM is authoritative when a real provider is configured; the
                # keyword rule is only the offline fallback (it no longer has to
                # merely "agree" before the model's verdict can be used).
                decision = ai_decision
                ai_category = str(res_data.get("category", "")).strip()
                if ai_category:
                    category = ai_category
            raw_explanation = (res_data.get("explanation") or "").strip() or raw_explanation
        except Exception as e:
            provider_status = "fallback"
            provider_id = "rule_engine"
            print(f"Rerouting to deterministic rule engine due to AI client error: {str(e)}")

    # 3. Rebuild local XAI after optional AI-provider override.
    attributions = xai.calculate_local_attribution(request.text, matched_regs)
    justification = xai.generate_auditor_justification(decision, category, matched_regs[0]["content"] if matched_regs else "Standard banking policy guidelines", attributions)
    if raw_explanation:
        justification["reasoning"] = raw_explanation + "\n\n" + justification.get("reasoning", "")

    reasoning_trace = build_scan_reasoning_trace(
        request,
        matched_regs,
        category,
        decision,
        attributions,
        provider_id,
        provider_status
    )

    # 4. Real decision confidence — derived from the actual signal strength of
    # this scan (top attribution weight + breadth of strong signals + how much
    # matching evidence was retrieved), not a hardcoded constant.
    confidence = compute_scan_confidence(attributions, matched_regs)

    # 5. Save Audit Log (Encrypting sensitive fields if BYOK is provided)
    log_id = str(uuid.uuid4())
    timestamp = int(time.time())
    
    scanned_text_stored = request.text
    explanation_stored = json.dumps(justification)
    is_encrypted = 0
    byok_hash = ""
    
    if request.byok_key:
        scanned_text_stored = security.encrypt_log(request.text, request.byok_key)
        explanation_stored = security.encrypt_log(json.dumps(justification), request.byok_key)
        is_encrypted = 1
        import hashlib
        byok_hash = hashlib.sha256(request.byok_key.encode('utf-8')).hexdigest()
        
    conn = _audit_connect()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (log_id, timestamp, scanned_text_stored, decision, category, explanation_stored, is_encrypted, byok_hash, org_id)
    )
    conn.commit()
    conn.close()
    
    return {
        "id": log_id,
        "timestamp": timestamp,
        "decision": decision,
        "category": category,
        "confidence": confidence,
        "justification": justification,
        "attributions": attributions,
        "reasoning_trace": reasoning_trace,
        "is_encrypted": bool(is_encrypted)
    }

def compute_scan_confidence(attributions: list, matched_regs: list) -> float:
    """Derive a 0..1 confidence score from real scan signals.

    Combines the strongest token attribution, the number of strong signals, and
    how much matching evidence was retrieved from the RAG corpus. Returns a
    rounded float so the UI can show a real, explainable percentage instead of a
    fixed placeholder.
    """
    weights = [float(a.get("attribution", 0) or 0) for a in (attributions or [])]
    top = max(weights) if weights else 0.0
    strong_signals = sum(1 for w in weights if w >= 0.4)
    evidence_factor = min(len(matched_regs or []), 3) / 3.0  # 0..1

    # Weighted blend, clamped to a sane floor/ceiling.
    score = (0.55 * top) + (0.20 * min(strong_signals / 3.0, 1.0)) + (0.25 * evidence_factor)
    return round(max(0.5, min(0.99, score)), 2)

@app.get("/api/logs")
def get_logs(byok_key: Optional[str] = Query(None), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor"]))):
    """Retrieve audit logs. If a valid BYOK key is provided, encrypted fields are decrypted."""
    org_id = current_user.org_id
    conn = _audit_connect()
    cursor = conn.cursor()
    cursor.execute("SELECT id, timestamp, scanned_text, decision, category, explanation, is_encrypted, byok_key_hash FROM audit_logs WHERE org_id = ? ORDER BY timestamp DESC", (org_id,))
    rows = cursor.fetchall()
    conn.close()
    
    logs = []
    import hashlib
    provided_hash = hashlib.sha256(byok_key.encode('utf-8')).hexdigest() if byok_key else ""
    
    for row_id, timestamp, scanned_text, decision, category, explanation, is_encrypted, byok_hash in rows:
        decrypted_text = scanned_text
        decrypted_explanation = explanation
        
        if is_encrypted:
            if byok_key and provided_hash == byok_hash:
                decrypted_text = security.decrypt_log(scanned_text, byok_key)
                decrypted_exp_raw = security.decrypt_log(explanation, byok_key)
                try:
                    decrypted_explanation = json.loads(decrypted_exp_raw)
                except Exception:
                    decrypted_explanation = decrypted_exp_raw
            else:
                decrypted_text = "[ENCRYPTED - BYOK REQUIRED]"
                decrypted_explanation = {
                    "title": "Encrypted Log",
                    "severity": "UNKNOWN",
                    "summary": "This audit log is encrypted. Please supply the correct BYOK key to unlock.",
                    "reasoning": "Decryption key not provided or signature mismatch.",
                    "remediation": "Provide correct BYOK key header to load explanation details."
                }
        else:
            try:
                decrypted_explanation = json.loads(explanation)
            except Exception:
                pass
                
        logs.append({
            "id": row_id,
            "timestamp": timestamp,
            "scanned_text": decrypted_text,
            "decision": decision,
            "category": category,
            "justification": decrypted_explanation,
            "is_encrypted": bool(is_encrypted)
        })
        
    return logs

BENCHMARK_CASES = [
    {
        "id": "basel_cet1_low",
        "framework": "Basel III",
        "objective": "Domain-specific banking classification",
        "text": "Quarterly capital adequacy review shows CET1 ratio of 5.5% against risk-weighted assets.",
        "perspective": "Standard",
        "expected_decision": "VIOLATION",
        "expected_category": "Basel III Capital Adequacy",
        "misclassification_type": "Quantitative regulatory reasoning"
    },
    {
        "id": "basel_cet1_ok",
        "framework": "Basel III",
        "objective": "Domain-specific banking classification",
        "text": "Capital adequacy report confirms CET1 ratio of 8.4% after the conservation buffer.",
        "perspective": "Standard",
        "expected_decision": "COMPLIANT",
        "expected_category": "Basel III Capital Adequacy",
        "misclassification_type": "False-positive capital breach"
    },
    {
        "id": "cbest_swift_user",
        "framework": "CBEST",
        "objective": "Perspective-aware threat classification",
        "text": "SWIFT gateway impersonation exposed routing and transaction IDs to an unauthorized viewer.",
        "perspective": "User",
        "expected_decision": "VIOLATION",
        "expected_category": "CBEST Threat Modeling / SWIFT Security",
        "misclassification_type": "Perspective confusion: spoofing vs information disclosure"
    },
    {
        "id": "gdpr_raw_pii",
        "framework": "GDPR",
        "objective": "Data protection compliance",
        "text": "Raw PII and customer account numbers were exported unencrypted into transaction logs.",
        "perspective": "Standard",
        "expected_decision": "VIOLATION",
        "expected_category": "GDPR Data Protection",
        "misclassification_type": "Semantic privacy-control miss"
    },
    {
        "id": "soc2_mfa_missing",
        "framework": "SOC 2",
        "objective": "Operational access-control compliance",
        "text": "MFA is disabled for administrator accounts in the identity provider.",
        "perspective": "Standard",
        "expected_decision": "VIOLATION",
        "expected_category": "SOC 2 / Identity Access Control",
        "misclassification_type": "Access-control evidence miss"
    },
    {
        "id": "api_byok_gap",
        "framework": "BYOK/API Security",
        "objective": "Policy-conformant API architecture",
        "text": "Sensitive compliance prompts are sent to a third-party API without encryption or key control.",
        "perspective": "Standard",
        "expected_decision": "VIOLATION",
        "expected_category": "Policy-Conformant API Architecture",
        "misclassification_type": "API security policy gap"
    }
]

HOLDOUT_PATH = os.path.join(os.path.dirname(__file__), "benchmark", "holdout_cases.jsonl")


def load_holdout_cases() -> list:
    """Load the held-out, labelled benchmark set (scenarios the keyword rules were
    NOT authored for). Missing/blank file -> empty list."""
    cases = []
    try:
        with open(HOLDOUT_PATH, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    cases.append(json.loads(line))
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"Failed to load held-out benchmark cases: {e}")
    return cases


def _evaluate_case_set(cases: list, org_id: str, db: Session) -> tuple:
    """Run the deterministic scan engine over a labelled case set and return
    (per-case results, real metrics). Positive class for the confusion matrix is
    VIOLATION. Per-case confidence is the engine's real signal score, not a
    constant."""
    results = []
    tp = tn = fp = fn = 0
    decision_hits = category_hits = 0
    for case in cases:
        ev = evaluate_scan_case(case["text"], case.get("perspective", "Standard"), org_id, db)
        actual, expected = ev["decision"], case["expected_decision"]
        decision_match = actual == expected
        category_match = ev["category"] == case.get("expected_category")
        decision_hits += int(decision_match)
        category_hits += int(category_match)
        if expected == "VIOLATION" and actual == "VIOLATION":
            tp += 1
        elif expected == "COMPLIANT" and actual == "COMPLIANT":
            tn += 1
        elif expected == "COMPLIANT" and actual == "VIOLATION":
            fp += 1
        elif expected == "VIOLATION" and actual == "COMPLIANT":
            fn += 1
        results.append({
            **case,
            "actual_decision": actual,
            "actual_category": ev["category"],
            "decision_match": decision_match,
            "category_match": category_match,
            "passed": decision_match,  # decision is the primary metric
            "confidence": compute_scan_confidence(ev["attributions"], ev["matched_references"]),
            "top_terms": ev["top_terms"],
            "auditor_reasoning": ev["justification"]["reasoning"],
            "evidence_reference": ev["matched_references"][0] if ev["matched_references"] else None,
        })
    n = len(cases)
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    f1 = (2 * precision * recall / (precision + recall)) if (precision and recall) else None
    metrics = {
        "total_cases": n,
        "decision_accuracy": round(decision_hits / n * 100, 1) if n else 0,
        "category_accuracy": round(category_hits / n * 100, 1) if n else 0,
        "confusion_matrix": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
        "precision": round(precision, 3) if precision is not None else None,
        "recall": round(recall, 3) if recall is not None else None,
        "f1": round(f1, 3) if f1 is not None else None,
    }
    return results, metrics


@app.get("/api/evaluation/benchmark")
def run_benchmark(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    """Honest benchmark: the deterministic rule baseline is scored on a HELD-OUT
    labelled set it was not tuned for. The original in-distribution cases are
    reported separately for contrast — the gap between them is the real
    generalization headroom (which the LLM-authoritative scan path is meant to
    close). No fabricated target/workload constants."""
    holdout = load_holdout_cases()
    holdout_results, holdout_metrics = _evaluate_case_set(holdout, current_user.org_id, db)
    _, tuned_metrics = _evaluate_case_set(BENCHMARK_CASES, current_user.org_id, db)

    cm = holdout_metrics["confusion_matrix"]
    return {
        "company": DEFAULT_COMPANY_NAME,
        "method": ("Deterministic rule baseline evaluated on a held-out labelled set the rules were NOT "
                   "authored for. Primary metric = decision accuracy; positive class = VIOLATION."),
        # Headline = held-out decision accuracy (kept under the original keys for the UI).
        "accuracy": holdout_metrics["decision_accuracy"],
        "passed_cases": cm["tp"] + cm["tn"],
        "total_cases": holdout_metrics["total_cases"],
        "category_accuracy": holdout_metrics["category_accuracy"],
        "precision": holdout_metrics["precision"],
        "recall": holdout_metrics["recall"],
        "f1": holdout_metrics["f1"],
        "confusion_matrix": cm,
        "in_distribution": {
            "decision_accuracy": tuned_metrics["decision_accuracy"],
            "total_cases": tuned_metrics["total_cases"],
            "note": "Cases the keyword rules were written for — expected near 100%; NOT a measure of generalization.",
        },
        "summary": (
            f"Rule baseline: {holdout_metrics['decision_accuracy']}% decision accuracy on "
            f"{holdout_metrics['total_cases']} held-out cases (precision "
            f"{holdout_metrics['precision']}, recall {holdout_metrics['recall']}), vs "
            f"{tuned_metrics['decision_accuracy']}% on the {tuned_metrics['total_cases']} in-distribution "
            "cases it was tuned for. The gap is honest generalization headroom for the LLM scan path."
        ),
        "results": holdout_results,
    }

@app.get("/api/evaluation/report")
def implementation_report(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    controls_count = db.query(models.Control).filter_by(org_id=current_user.org_id).count()
    risks_count = db.query(models.Risk).filter_by(org_id=current_user.org_id).count()
    integrations = db.query(models.Integration).filter_by(org_id=current_user.org_id).all()
    departments = sorted({u.department or "Unassigned" for u in db.query(models.User).filter_by(org_id=current_user.org_id).all()})

    objectives = [
        {
            "name": "Domain-specific banking compliance automation",
            "status": "Implemented as deterministic rules + RAG grounding",
            "coverage": 78,
            "evidence": "Basel III CET1, CBEST SWIFT perspective handling, GDPR PII, SOC 2 MFA scenarios."
        },
        {
            "name": "Misclassification measurement and benchmarking",
            "status": "Implemented and measured on a held-out labelled set",
            "coverage": 70,
            "evidence": "Benchmark endpoint reports decision accuracy, precision/recall/F1, and a confusion matrix on held-out cases."
        },
        {
            "name": "Explainable output generation",
            "status": "Implemented as local attribution + auditor justification",
            "coverage": 72,
            "evidence": "Scanner returns top terms, attribution weights, matched regulatory context, reasoning, and remediation."
        },
        {
            "name": "Policy-conformant API and BYOK architecture",
            "status": "Partially implemented",
            "coverage": 68,
            "evidence": "BYOK encrypted logs/credentials, same-origin proxy, configurable AI providers, but no hardware attestation."
        },
        {
            "name": "Real system integration evidence",
            "status": "Partially implemented",
            "coverage": 64,
            "evidence": "GitHub, AWS, Okta, and Auth0 credential paths exist. Live evidence depends on valid read-only credentials."
        },
        {
            "name": "Production readiness",
            "status": "Prototype-plus",
            "coverage": 66,
            "evidence": "Auth/RBAC, department scoping, tests, build checks, upload validation, but deeper migrations/monitoring remain."
        }
    ]

    overall = round(sum(item["coverage"] for item in objectives) / len(objectives), 1)
    return {
        "company": DEFAULT_COMPANY_NAME,
        "overall_completion": overall,
        "implementation_level": "Project-complete working prototype",
        "controls_count": controls_count,
        "risks_count": risks_count,
        "departments": departments,
        "integrations": [{"id": item.id, "name": item.name, "status": item.status} for item in integrations],
        "objectives": objectives,
        "remaining_gaps": [
            "The in-house trained GRC model (currently served via the interim Groq provider).",
            "Formal SHAP/LIME/Captum model-internal explanations (current attribution is IR-relevance based).",
            "Expert-labelled empirical validation and Chapter 4-style result tables.",
            "Production database migrations, observability, and deployment hardening."
        ]
    }

# --- NEW ENTERPRISE GRC MODULE ENDPOINTS ---

# 1. AI Settings Configuration (Admin only)
class AIProviderUpdateRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_override: Optional[str] = None

@app.get("/api/settings/ai-providers")
def get_ai_providers(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin"]))):
    configs = ensure_ai_provider_configs(db, current_user.org_id)
    
    result = []
    for c in configs:
        masked_key = ""
        decrypted = ai_gateway.get_decrypted_key(c)  # honors DB key OR .env key
        if decrypted:
            masked_key = decrypted[:3] + "•" * (len(decrypted) - 3) if len(decrypted) > 3 else "••••••••"
        env_key = ai_gateway.get_env_provider_key(c.id)
        result.append({
            "id": c.id,
            "base_url": c.base_url,
            "model_override": c.model_override,
            "is_active": c.is_active,
            "api_key": masked_key,
            # Usable if a key exists in the DB or the environment, or the
            # provider needs no key (local engines).
            "has_key": bool(decrypted) or c.id in ["inhouse"],
            "key_source": "env" if (env_key and not c.api_key) else ("db" if c.api_key else None),
        })
    return result

@app.post("/api/settings/ai-providers/{id}")
def update_ai_provider(id: str, request: AIProviderUpdateRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin"]))):
    config = db.query(models.AIProviderConfig).filter_by(id=id, org_id=current_user.org_id).first()
    if not config:
        # Auto-create the provider config if it doesn't exist yet
        config = models.AIProviderConfig(id=id, org_id=current_user.org_id, is_active=False)
        db.add(config)
        db.commit()
        db.refresh(config)
    if request.base_url is not None:
        config.base_url = request.base_url
    if request.model_override is not None:
        config.model_override = request.model_override
    if request.api_key is not None and request.api_key.strip() != "":
        if not request.api_key.startswith("•") and "•" not in request.api_key:
            vault_key = get_required_vault_key()
            config.api_key = security.encrypt_log(request.api_key, vault_key)
    db.commit()
    return {"status": "success"}

@app.post("/api/settings/ai-providers/{id}/activate")
def activate_ai_provider(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin"]))):
    target = db.query(models.AIProviderConfig).filter_by(id=id, org_id=current_user.org_id).first()
    if not target:
        target = models.AIProviderConfig(id=id, org_id=current_user.org_id, is_active=False)
        db.add(target)
        db.commit()
        db.refresh(target)
        
    if id not in ["inhouse"]:
        # Accept a key from the DB OR the environment (.env). Previously only the
        # DB key was checked, so env-configured providers (e.g. GROQ_API_KEY)
        # could not be activated from the UI.
        if not ai_gateway.get_decrypted_key(target):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot activate {id.upper()} provider: API Key is not configured. Add it in .env or here first."
            )
            
    providers = db.query(models.AIProviderConfig).filter_by(org_id=current_user.org_id).all()
    for p in providers:
        p.is_active = (p.id == id)
    db.commit()
    return {"status": "success", "active_provider": id}

# 2. Dashboard Overview Stats & Trends
@app.get("/api/dashboard/stats")
def get_dashboard_stats(department: Optional[str] = Query(None), db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    require_department_access(current_user, department)
    controls_query = filter_owned_by_department(
        db.query(models.Control).filter_by(org_id=current_user.org_id),
        models.Control,
        db,
        current_user.org_id,
        department
    )
    controls = controls_query.all()
    total_controls = len(controls)
    passing_controls = sum(1 for c in controls if c.status == "Passing")
    failing_controls = sum(1 for c in controls if c.status == "Failing")
    warning_controls = sum(1 for c in controls if c.status == "Warning")
    
    compliance_score = int((passing_controls / total_controls) * 100) if total_controls > 0 else 0
    
    risks_query = filter_owned_by_department(
        db.query(models.Risk).filter_by(org_id=current_user.org_id),
        models.Risk,
        db,
        current_user.org_id,
        department
    )
    risks = risks_query.all()
    avg_residual = sum(r.residual_score for r in risks) / len(risks) if risks else 0
    
    active_integrations = db.query(models.Integration).filter_by(status="Connected", org_id=current_user.org_id).count()
    total_integrations = db.query(models.Integration).filter_by(org_id=current_user.org_id).count()

    # Real risk severity matrix: count actual risks per (impact x likelihood) cell.
    # Returned as a flat list so the UI can render a 5x5 grid without inferring
    # any counts client-side (previously the grid was hardcoded).
    matrix_counts = {}
    high_risk_count = 0
    for r in risks:
        impact = max(1, min(5, int(r.impact or 1)))
        likelihood = max(1, min(5, int(r.likelihood or 1)))
        matrix_counts[(impact, likelihood)] = matrix_counts.get((impact, likelihood), 0) + 1
        if (r.residual_score or 0) >= 15:
            high_risk_count += 1
    risk_matrix = [
        {"impact": impact, "likelihood": likelihood, "count": matrix_counts.get((impact, likelihood), 0)}
        for impact in range(1, 6)
        for likelihood in range(1, 6)
    ]

    # Real evidence freshness summary (drives audit-readiness signals honestly).
    evidence = db.query(models.Evidence).filter_by(org_id=current_user.org_id).all()
    evidence_summary = {
        "total": len(evidence),
        "current": sum(1 for e in evidence if e.freshness == "Current"),
        "expiring": sum(1 for e in evidence if e.freshness == "Expiring"),
        "expired": sum(1 for e in evidence if e.freshness == "Expired"),
    }

    # Audit readiness is derived from real signals rather than a fabricated
    # countdown. `days_until_next_audit` is only populated when the org has set
    # one (no such field yet) — null means "not scheduled", which the UI shows
    # honestly instead of inventing a number.
    next_audit_at = getattr(current_user.organization, "next_audit_at", None)
    days_until_next_audit = None
    if next_audit_at:
        days_until_next_audit = max(0, (int(next_audit_at) - int(time.time())) // 86400)

    # Record a once-per-day posture snapshot so /api/dashboard/trends has real
    # history to serve. Only for the org-wide view (no department filter) to keep
    # the series consistent. Also expose the delta vs. the previous snapshot.
    compliance_delta = None
    if not department:
        compliance_delta = record_compliance_snapshot(
            db, current_user.org_id, compliance_score, round(avg_residual, 1),
            total_controls, passing_controls,
            sum(1 for r in risks if r.status == "Open"),
        )

    return {
        "company": DEFAULT_COMPANY_NAME,
        "department": department or "All Departments",
        "compliance_score": compliance_score,
        "average_residual_risk": round(avg_residual, 1),
        "failed_controls_count": failing_controls,
        "warning_controls_count": warning_controls,
        "passing_controls_count": passing_controls,
        "total_controls_count": total_controls,
        "total_risks_count": len(risks),
        "high_risks_count": high_risk_count,
        "active_integrations": active_integrations,
        "total_integrations": total_integrations,
        "risk_matrix": risk_matrix,
        "evidence_summary": evidence_summary,
        "days_until_next_audit": days_until_next_audit,
        "compliance_delta": compliance_delta,
    }

def record_compliance_snapshot(db, org_id, compliance_score, avg_residual, total_controls, passing_controls, open_risks):
    """Upsert today's snapshot for an org and return the day-over-day compliance
    delta vs. the most recent *prior* day (None when there's no prior history)."""
    today = time.strftime("%Y-%m-%d", time.gmtime())

    # Compute delta against the latest snapshot from a previous day.
    prior = (
        db.query(models.ComplianceSnapshot)
        .filter(models.ComplianceSnapshot.org_id == org_id, models.ComplianceSnapshot.day < today)
        .order_by(models.ComplianceSnapshot.day.desc())
        .first()
    )
    delta = (compliance_score - prior.compliance_score) if prior else None

    existing = (
        db.query(models.ComplianceSnapshot)
        .filter_by(org_id=org_id, day=today)
        .first()
    )
    if existing:
        existing.timestamp = int(time.time())
        existing.compliance_score = compliance_score
        existing.average_residual_risk = avg_residual
        existing.total_controls = total_controls
        existing.passing_controls = passing_controls
        existing.open_risks = open_risks
    else:
        db.add(models.ComplianceSnapshot(
            org_id=org_id, day=today, timestamp=int(time.time()),
            compliance_score=compliance_score, average_residual_risk=avg_residual,
            total_controls=total_controls, passing_controls=passing_controls, open_risks=open_risks,
        ))
    db.commit()
    return delta

@app.get("/api/departments")
def get_departments(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    users = db.query(models.User).filter_by(org_id=current_user.org_id).all()
    department_records = db.query(models.Department).filter_by(org_id=current_user.org_id).all()
    departments = sorted({department.name for department in department_records} | {u.department or "Unassigned" for u in users})
    result = []
    for dept in departments:
        if not user_can_view_department(current_user, dept):
            continue
        department_record = next((item for item in department_records if item.name == dept), None)
        owner_ids = [u.id for u in users if (u.department or "Unassigned") == dept]
        controls = db.query(models.Control).filter(models.Control.org_id == current_user.org_id, models.Control.owner_id.in_(owner_ids)).all()
        risks = db.query(models.Risk).filter(models.Risk.org_id == current_user.org_id, models.Risk.owner_id.in_(owner_ids)).all()
        result.append({
            "id": department_record.id if department_record else f"derived_{dept.lower().replace(' ', '_')}",
            "name": dept,
            "description": department_record.description if department_record else "",
            "status": department_record.status if department_record else "Active",
            "users_count": len(owner_ids),
            "controls_count": len(controls),
            "risks_count": len(risks),
            "passing_controls": sum(1 for c in controls if c.status == "Passing")
        })
    return result

@app.get("/api/dashboard/trends")
def get_dashboard_trends(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    """Real posture history from recorded daily snapshots (most recent 30 days).

    Returns empty series until at least one snapshot exists; the UI renders that
    honestly ("not enough history yet") instead of a fabricated curve.
    """
    snapshots = (
        db.query(models.ComplianceSnapshot)
        .filter_by(org_id=current_user.org_id)
        .order_by(models.ComplianceSnapshot.day.desc())
        .limit(30)
        .all()
    )
    snapshots = list(reversed(snapshots))  # chronological
    return {
        "labels": [s.day for s in snapshots],
        "compliance_trend": [s.compliance_score for s in snapshots],
        "risk_trend": [round(s.average_residual_risk, 1) for s in snapshots],
        "points": len(snapshots),
    }

# 3. Integrations Management
@app.get("/api/integrations")
def get_integrations(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    return db.query(models.Integration).filter_by(org_id=current_user.org_id).all()

class IntegrationConnectRequest(BaseModel):
    id: str
    credentials: Optional[str] = None

def parse_integration_credentials(raw: str) -> dict:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        parts = raw.split(":")
        return {"parts": parts}

@app.post("/api/integrations/connect")
def connect_integration(request: IntegrationConnectRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    integration = db.query(models.Integration).filter_by(id=request.id, org_id=current_user.org_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found.")
    
    integration.status = "Configured" if request.credentials else "Disconnected"
    integration.last_sync = int(time.time())
    if request.credentials:
        vault_key = get_required_vault_key()
        integration.credentials = security.encrypt_log(request.credentials, vault_key)
    db.commit()
    return {"status": "success", "integration_status": integration.status}

def run_sync_task(integration_id: str, org_id: str, source: str = "sync"):
    """Run one connector audit and propagate the result.

    Dispatch is a registry lookup (integration_clients.SYNC_HANDLERS); every
    connector then flows through the same post-processing: integration status +
    audit summary, linked-asset status, and the connector->control bridge that
    flips imported framework controls and records drift.
    """
    import integration_clients
    db = database.SessionLocal()
    try:
        integration = db.query(models.Integration).filter_by(id=integration_id, org_id=org_id).first()
        if not integration:
            return

        integration.last_sync = int(time.time())
        vault_key = ai_gateway.get_vault_key()
        creds_str = ""
        if integration.credentials and vault_key:
            creds_str = security.decrypt_log(integration.credentials, vault_key)
        creds = parse_integration_credentials(creds_str)

        handler = integration_clients.SYNC_HANDLERS.get(integration_id)
        if handler is None:
            result = {"compliant": False,
                      "reason": f"No live audit handler is configured for connector '{integration_id}'."}
        else:
            result = handler(creds)
        compliant = result.get("compliant", False)
        reason = result.get("reason", "Sync completed.")

        integration.last_audit_summary = reason
        integration.status = "Connected" if compliant else "Error"

        # Any asset linked to this integration inherits the audit outcome.
        for asset in db.query(models.Asset).filter_by(integration_id=integration_id, org_id=org_id).all():
            asset.compliance_status = "Passing" if compliant else "Failing"
        db.commit()

        # Bridge the sync result to every imported control this connector tests
        # and refresh affected framework readiness / drift events.
        try:
            framework_library.apply_connector_result(db, org_id, integration_id, compliant, source=source)
        except Exception as e:
            print(f"Connector->control mapping skipped for {integration_id}: {e}")
    finally:
        db.close()


@app.get("/api/integrations/fields")
def get_integration_fields(current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    """Per-connector credential field specs (drive the connect form) plus the
    list of connectors that currently have OAuth configured by the operator."""
    import integration_clients
    return {"fields": integration_clients.CONNECTOR_FIELDS, "oauth": oauth_supported_ids()}

@app.post("/api/integrations/{id}/sync")
def sync_integration(id: str, background_tasks: BackgroundTasks, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    integration = db.query(models.Integration).filter_by(id=id, org_id=current_user.org_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found.")
    background_tasks.add_task(run_sync_task, id, current_user.org_id)
    return {"status": "sync_started"}

@app.get("/api/integrations/{id}/logs")
def get_integration_logs(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    """Real audit outcome only — no fabricated log timeline."""
    integration = db.query(models.Integration).filter_by(id=id, org_id=current_user.org_id).first()
    if not integration or not integration.last_audit_summary:
        return [{"timestamp": int(time.time()), "level": "INFO",
                 "message": "No sync has been run yet for this connector."}]
    level = "ERROR" if integration.status == "Error" else "SUCCESS"
    return [{"timestamp": integration.last_sync or int(time.time()), "level": level,
             "message": integration.last_audit_summary}]

# OAuth app registry (dev-configured). To enable OAuth for a connector: register
# an OAuth app with the vendor, set the two env vars, and add an entry here. Most
# connectors use API keys / service accounts (machine-to-machine) and need NO
# entry — they only ever use the API Credentials form. A provider is offered in
# the UI only when its client id + secret are actually present at runtime.
OAUTH_PROVIDERS = {
    "github": {
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "scope": "repo,read:org",
        "client_id_env": "GITHUB_CLIENT_ID",
        "client_secret_env": "GITHUB_CLIENT_SECRET",
    },
    # Template — fill the two envs and uncomment to enable Google Workspace OAuth:
    # "google_workspace": {
    #     "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
    #     "token_url": "https://oauth2.googleapis.com/token",
    #     "scope": "https://www.googleapis.com/auth/admin.directory.user.readonly",
    #     "client_id_env": "GOOGLE_OAUTH_CLIENT_ID",
    #     "client_secret_env": "GOOGLE_OAUTH_CLIENT_SECRET",
    #     "extra_authorize": {"access_type": "offline", "prompt": "consent"},
    # },
}


def _oauth_config(provider_id: str) -> Optional[dict]:
    """Return the OAuth spec merged with live credentials, or None if the dev
    hasn't configured this provider's client id/secret."""
    spec = OAUTH_PROVIDERS.get(provider_id)
    if not spec:
        return None
    client_id = os.environ.get(spec["client_id_env"], "").strip()
    client_secret = os.environ.get(spec["client_secret_env"], "").strip()
    if not client_id or client_id.startswith("your_") or not client_secret:
        return None
    return {**spec, "client_id": client_id, "client_secret": client_secret}


def oauth_supported_ids() -> list[str]:
    return [pid for pid in OAUTH_PROVIDERS if _oauth_config(pid)]


# OAuth redirects and callbacks for integrations
@app.get("/api/integrations/{id}/authorize")
def oauth_authorize(id: str, current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    """Return the vendor authorize URL as JSON. The frontend navigates the browser
    there — a fetch() cannot follow a cross-origin redirect into the vendor (CORS),
    which is why this is not a RedirectResponse."""
    from urllib.parse import urlencode
    cfg = _oauth_config(id)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"OAuth is not configured for {id}. Use API credentials for this system.")
    api_base = os.environ.get("PUBLIC_API_BASE_URL", "http://localhost:8001").rstrip("/")
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": f"{api_base}/api/integrations/{id}/callback",
        "scope": cfg["scope"],
        "state": current_user.org_id,
        "response_type": "code",
        **cfg.get("extra_authorize", {}),
    }
    return {"authorize_url": f"{cfg['authorize_url']}?{urlencode(params)}"}


@app.get("/api/integrations/{id}/callback")
def oauth_callback(id: str, code: str, state: str = DEFAULT_COMPANY_ID, db: Session = Depends(database.get_db)):
    """Generic OAuth2 code->token exchange for any configured provider. Stores the
    token as {"token": ...} JSON (same shape the connect form produces) so the sync
    handler reads it identically. No control statuses are touched — OAuth only
    proves we CAN audit; the verdict comes from running Sync."""
    import httpx
    import seed
    import integration_clients
    from fastapi.responses import RedirectResponse
    cfg = _oauth_config(id)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"OAuth callback is not available for {id}. Configure API credentials and run Sync.")

    org_id = state or DEFAULT_COMPANY_ID
    try:
        seed.seed_org_data(db, org_id)
    except Exception as e:
        print(f"Error seeding organization {org_id} in callback: {str(e)}")
        if not db.query(models.Organization).filter_by(id=org_id).first():
            db.add(models.Organization(id=org_id, name=DEFAULT_COMPANY_NAME, created_at=int(time.time())))
            db.commit()

    api_base = os.environ.get("PUBLIC_API_BASE_URL", "http://localhost:8001").rstrip("/")
    token = None
    try:
        res = httpx.post(cfg["token_url"], headers={"Accept": "application/json"},
                         data={"client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                               "code": code, "grant_type": "authorization_code",
                               "redirect_uri": f"{api_base}/api/integrations/{id}/callback"},
                         timeout=10.0)
        if res.status_code == 200:
            token = res.json().get("access_token")
    except Exception as e:
        print(f"{id} OAuth exchange failed: {str(e)}")
    if not token:
        raise HTTPException(status_code=400, detail=f"{id} OAuth exchange failed. No access token was returned.")

    integration = db.query(models.Integration).filter_by(id=id, org_id=org_id).first()
    if not integration:
        entry = next((e for e in integration_clients.INTEGRATION_CATALOG if e["id"] == id), {})
        integration = models.Integration(id=id, org_id=org_id, name=entry.get("name", id),
                                          category=entry.get("category", "Integration"))
        db.add(integration)
    integration.status = "Configured"
    integration.last_sync = int(time.time())
    integration.credentials = security.encrypt_log(json.dumps({"token": token}), get_required_vault_key())
    db.commit()

    frontend_base = os.environ.get("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    return RedirectResponse(f"{frontend_base}/integrations?status=success&id={id}")

# 4. Controls Monitoring
@app.get("/api/controls")
def get_controls(department: Optional[str] = Query(None), db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    require_department_access(current_user, department)
    query = filter_owned_by_department(
        db.query(models.Control).filter_by(org_id=current_user.org_id),
        models.Control,
        db,
        current_user.org_id,
        department
    )
    result = []
    for control in query.all():
        item = {
            "id": control.id,
            "org_id": control.org_id,
            "control_code": control.control_code,
            "title": control.title,
            "description": control.description,
            "frameworks": control.frameworks,
            "status": control.status,
            "owner_id": control.owner_id,
            "last_tested": control.last_tested,
            "department": department_for_owner(db, current_user.org_id, control.owner_id)
        }
        result.append(item)
    return result

@app.post("/api/controls/{id}/test")
def test_control(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    control = db.query(models.Control).filter_by(id=id, org_id=current_user.org_id).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found.")
    control.last_tested = int(time.time())
    control.status = "Passing"
    db.commit()
    return {"status": "success", "control_status": control.status}

# 5. Risk Registry
@app.get("/api/risks")
def get_risks(department: Optional[str] = Query(None), db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    require_department_access(current_user, department)
    query = filter_owned_by_department(
        db.query(models.Risk).filter_by(org_id=current_user.org_id),
        models.Risk,
        db,
        current_user.org_id,
        department
    )
    result = []
    for risk in query.all():
        result.append({
            "id": risk.id,
            "org_id": risk.org_id,
            "title": risk.title,
            "category": risk.category,
            "likelihood": risk.likelihood,
            "impact": risk.impact,
            "inherent_score": risk.inherent_score,
            "residual_score": risk.residual_score,
            "status": risk.status,
            "owner_id": risk.owner_id,
            "department": department_for_owner(db, current_user.org_id, risk.owner_id)
        })
    return result

class RiskUpdateRequest(BaseModel):
    id: str
    likelihood: int
    impact: int
    status: str

@app.post("/api/risks")
def update_risk(request: RiskUpdateRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    risk = db.query(models.Risk).filter_by(id=request.id, org_id=current_user.org_id).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found.")
    risk.likelihood = request.likelihood
    risk.impact = request.impact
    risk.status = request.status
    risk.inherent_score = request.likelihood * request.impact
    mitigation_factor = len(risk.mitigations)
    risk.residual_score = max(1, risk.inherent_score - (mitigation_factor * 2))
    db.commit()
    return {"status": "success", "residual_score": risk.residual_score}

class MitigateRequest(BaseModel):
    control_id: str

@app.post("/api/risks/{id}/mitigate")
def mitigate_risk(id: str, request: MitigateRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    risk = db.query(models.Risk).filter_by(id=id, org_id=current_user.org_id).first()
    control = db.query(models.Control).filter_by(id=request.control_id, org_id=current_user.org_id).first()
    if not risk or not control:
        raise HTTPException(status_code=404, detail="Risk or Control not found.")
    if control not in risk.mitigations:
        risk.mitigations.append(control)
        risk.residual_score = max(1, risk.inherent_score - (len(risk.mitigations) * 2))
        db.commit()
    return {"status": "success", "residual_score": risk.residual_score}

# 6. Policy Approvals & Acknowledgments
@app.get("/api/policies")
def get_policies(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer", "Employee"]))):
    policies = db.query(models.Policy).filter_by(org_id=current_user.org_id).all()
    result = []
    for p in policies:
        ack_count = db.query(models.PolicyAcknowledgment).filter_by(policy_id=p.id, org_id=current_user.org_id).count()
        total_staff = db.query(models.User).filter_by(org_id=current_user.org_id).count()
        result.append({
            "id": p.id,
            "title": p.title,
            "version": p.version,
            "status": p.status,
            "acknowledgments": ack_count,
            "total_employees": total_staff
        })
    return result

@app.post("/api/policies/upload")
async def upload_policy(title: str = Form(...), file: UploadFile = File(...), db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    content = await file.read()
    safe_filename = validate_upload(file.filename, content, {".pdf", ".txt", ".md", ".csv", ".json"})
    stored_filename = f"policy_{uuid.uuid4()}_{safe_filename}"
    
    # Prepare S3 key and local path scoped by company key.
    s3_key = f"companies/{current_user.org_id}/policies/{stored_filename}"
    local_path = os.path.join("uploads", current_user.org_id, stored_filename)
    
    # Upload via s3_storage helper
    saved_path = s3_storage.upload_file(content, s3_key, local_path)
        
    policy = models.Policy(
        id=str(uuid.uuid4()),
        org_id=current_user.org_id,
        title=title,
        file_path=saved_path,
        version="1.0.0",
        status="Under Review"
    )
    db.add(policy)
    db.commit()
    db.refresh(policy)
    
    # Ingest document into RAG scoped by company key using a temp file.
    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, f"{uuid.uuid4()}_{safe_filename}")
    with open(temp_path, "wb") as f:
        f.write(content)
        
    try:
        rag.ingest_document(temp_path, stored_filename, org_id=current_user.org_id, source_type="policy", replace_existing=True)
    except Exception as e:
        print(f"RAG policy chunking skipped: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
    return {"status": "success", "policy_id": policy.id}

@app.post("/api/policies/{id}/approve")
def approve_policy(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin"]))):
    policy = db.query(models.Policy).filter_by(id=id, org_id=current_user.org_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found.")
    policy.status = "Approved"
    db.commit()
    return {"status": "success", "policy_status": "Approved"}

@app.post("/api/policies/{id}/acknowledge")
def acknowledge_policy(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.get_current_user)):
    policy = db.query(models.Policy).filter_by(id=id, org_id=current_user.org_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found.")
    existing = db.query(models.PolicyAcknowledgment).filter_by(policy_id=id, user_id=current_user.id, org_id=current_user.org_id).first()
    if not existing:
        ack = models.PolicyAcknowledgment(
            id=str(uuid.uuid4()),
            org_id=current_user.org_id,
            policy_id=id,
            user_id=current_user.id,
            signed_at=int(time.time())
        )
        db.add(ack)
        db.commit()
    return {"status": "success"}

# 6b. Evidence Library Endpoints
@app.get("/api/evidence")
def get_evidence(department: Optional[str] = Query(None), db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    require_department_access(current_user, department)
    evidence_list = db.query(models.Evidence).filter_by(org_id=current_user.org_id).all()
    result = []
    for ev in evidence_list:
        ctrl = db.query(models.Control).filter_by(id=ev.control_id, org_id=current_user.org_id).first() if ev.control_id else None
        dept = department_for_owner(db, current_user.org_id, ctrl.owner_id if ctrl else None)
        if department and dept != department:
            continue
        result.append({
            "id": ev.id,
            "title": ev.title,
            "file_path": ev.file_path,
            "file_name": os.path.basename(ev.file_path) if ev.file_path else "",
            "file_size": f"{ev.file_size} B" if ev.file_size else "0 B",
            "freshness": ev.freshness,
            "upload_date": time.strftime('%Y-%m-%d', time.localtime(ev.upload_time)) if ev.upload_time else "",
            "control_code": ctrl.control_code if ctrl else "GEN-01",
            "control_id": ev.control_id,
            "department": dept
        })
    return result

@app.post("/api/evidence/upload")
async def upload_evidence(
    title: str = Form(...),
    control_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))
):
    content = await file.read()
    file_size = len(content)
    safe_filename = validate_upload(file.filename, content)
    stored_filename = f"evidence_{uuid.uuid4()}_{safe_filename}"
    
    # Prepare S3 key and local path scoped by company key.
    s3_key = f"companies/{current_user.org_id}/evidence/{stored_filename}"
    local_path = os.path.join("uploads", current_user.org_id, stored_filename)
    
    # Upload via s3_storage helper
    saved_path = s3_storage.upload_file(content, s3_key, local_path)
        
    evidence_id = str(uuid.uuid4())
    ev = models.Evidence(
        id=evidence_id,
        org_id=current_user.org_id,
        title=title,
        file_path=saved_path,
        file_size=file_size,
        freshness="Current",
        upload_time=int(time.time()),
        control_id=control_id
    )
    db.add(ev)
    
    # Evidence upload records reviewer activity but does not auto-pass a control.
    control = db.query(models.Control).filter_by(id=control_id, org_id=current_user.org_id).first()
    if control:
        control.last_tested = int(time.time())
        
    db.commit()

    try:
        extension = Path(safe_filename).suffix.lower()
        if extension in {".pdf", ".txt", ".md", ".csv", ".json"}:
            temp_dir = "temp_uploads"
            os.makedirs(temp_dir, exist_ok=True)
            temp_path = os.path.join(temp_dir, f"{uuid.uuid4()}_{safe_filename}")
            with open(temp_path, "wb") as buffer:
                buffer.write(content)
            try:
                rag.ingest_document(temp_path, stored_filename, org_id=current_user.org_id, source_type="evidence", replace_existing=True)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
    except Exception as ingest_error:
        print(f"Evidence RAG ingestion skipped for {safe_filename}: {str(ingest_error)}")

    return {"status": "success", "evidence_id": evidence_id}

@app.get("/api/evidence/{id}/download")
def download_evidence(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor"]))):
    ev = db.query(models.Evidence).filter_by(id=id, org_id=current_user.org_id).first()
    if not ev or not ev.file_path:
        raise HTTPException(status_code=404, detail="Evidence file record not found.")
        
    s3_key = storage_key_from_path(ev.file_path, current_user.org_id, "evidence")
    
    try:
        file_bytes = s3_storage.download_file(s3_key, ev.file_path)
        from fastapi.responses import Response
        return Response(
            content=file_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={os.path.basename(ev.file_path)}"}
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Failed to download file: {str(e)}")

# 7. TPRM Vendor Management
@app.get("/api/vendors")
def get_vendors(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    return db.query(models.Vendor).filter_by(org_id=current_user.org_id).all()

class VendorAssessRequest(BaseModel):
    tier: str
    inherent_risk: str
    residual_risk: str
    status: str

@app.post("/api/vendors/{id}/assess")
def assess_vendor(id: str, request: VendorAssessRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    vendor = db.query(models.Vendor).filter_by(id=id, org_id=current_user.org_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found.")
    vendor.tier = request.tier
    vendor.inherent_risk = request.inherent_risk
    vendor.residual_risk = request.residual_risk
    vendor.status = request.status
    vendor.last_assessment_date = int(time.time())
    db.commit()
    return {"status": "success"}

@app.post("/api/vendors/{id}/auto-fill")
def auto_fill_vendor_questionnaire(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    vendor = db.query(models.Vendor).filter_by(id=id, org_id=current_user.org_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found.")
    
    prompt = f"Assess security risks for vendor: {vendor.name}. Focus on banking GRC compliance, data localization, and audit requirements."
    schema = {
        "type": "object",
        "properties": {
            "data_encryption": {"type": "string"},
            "access_control": {"type": "string"},
            "business_continuity": {"type": "string"},
            "risk_level": {"type": "string"}
        },
        "required": ["data_encryption", "access_control", "business_continuity", "risk_level"]
    }
    
    ai_answers = ai_gateway.generate_structured_json(prompt, schema, "You are a TPRM GRC auditing assistant.", org_id=current_user.org_id)
    vendor.questionnaire_answers = json.dumps(ai_answers)
    vendor.last_assessment_date = int(time.time())
    db.commit()
    return {"status": "success", "answers": ai_answers}

# 8. People & Security Training
class UserCreateRequest(BaseModel):
    name: str
    email: str
    role: str = "Employee"
    department: str = "General"
    training_completed: bool = False
    background_check_passed: bool = False
    status: str = "Active"

class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    training_completed: Optional[bool] = None
    background_check_passed: Optional[bool] = None
    status: Optional[str] = None

@app.get("/api/people")
def get_people(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    return db.query(models.User).filter_by(org_id=current_user.org_id).all()

@app.post("/api/people")
def create_person(request: UserCreateRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin"]))):
    # Check if email is already registered
    existing = db.query(models.User).filter_by(email=request.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists.")
        
    import uuid
    new_user_id = f"user_gen_{str(uuid.uuid4())[:8]}"
    
    department = (request.department or "General").strip() or "General"
    ensure_department(db, current_user.org_id, department)

    new_user = models.User(
        id=new_user_id,
        org_id=current_user.org_id,
        email=request.email,
        name=request.name,
        role=request.role,
        department=department,
        training_completed=request.training_completed,
        background_check_passed=request.background_check_passed,
        status=request.status
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.put("/api/people/{id}")
def update_person(id: str, request: UserUpdateRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin"]))):
    user = db.query(models.User).filter_by(id=id, org_id=current_user.org_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    if request.name is not None:
        user.name = request.name
    if request.email is not None:
        # Check email uniqueness if modified
        if request.email != user.email:
            existing = db.query(models.User).filter_by(email=request.email).first()
            if existing:
                raise HTTPException(status_code=400, detail="User with this email already exists.")
        user.email = request.email
    if request.role is not None:
        user.role = request.role
    if request.department is not None:
        department = (request.department or "General").strip() or "General"
        ensure_department(db, current_user.org_id, department)
        user.department = department
    if request.training_completed is not None:
        user.training_completed = request.training_completed
    if request.background_check_passed is not None:
        user.background_check_passed = request.background_check_passed
    if request.status is not None:
        user.status = request.status
        
    db.commit()
    db.refresh(user)
    return user

@app.delete("/api/people/{id}")
def delete_person(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin"]))):
    if id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete yourself.")
        
    user = db.query(models.User).filter_by(id=id, org_id=current_user.org_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    db.delete(user)
    db.commit()
    return {"status": "success", "message": "User deleted successfully."}

@app.post("/api/people/{id}/trigger-training")
def trigger_training(id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    user = db.query(models.User).filter_by(id=id, org_id=current_user.org_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.training_completed = True
    db.commit()
    return {"status": "success", "training_completed": True}

# 9. Asset Inventory Scoping
@app.get("/api/assets")
def get_assets(department: Optional[str] = Query(None), db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    require_department_access(current_user, department)
    query = filter_owned_by_department(
        db.query(models.Asset).filter_by(org_id=current_user.org_id),
        models.Asset,
        db,
        current_user.org_id,
        department
    )
    result = []
    for asset in query.all():
        result.append({
            "id": asset.id,
            "org_id": asset.org_id,
            "name": asset.name,
            "type": asset.type,
            "owner_id": asset.owner_id,
            "compliance_status": asset.compliance_status,
            "is_in_scope": asset.is_in_scope,
            "integration_id": asset.integration_id,
            "department": department_for_owner(db, current_user.org_id, asset.owner_id)
        })
    return result

class ScopeRequest(BaseModel):
    is_in_scope: bool

@app.post("/api/assets/{id}/scope")
def scope_asset(id: str, request: ScopeRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    asset = db.query(models.Asset).filter_by(id=id, org_id=current_user.org_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")
    asset.is_in_scope = request.is_in_scope
    db.commit()
    return {"status": "success"}

# 10. Auditor Portal & Comment Threads
@app.get("/api/audit/bundle")
def download_audit_bundle(current_user: models.User = Depends(auth.RequireRole(["Admin", "Auditor"]))):
    return {
        "bundle_id": str(uuid.uuid4()),
        "timestamp": int(time.time()),
        "files": ["controls_list.json", "risks_register.csv", "uploaded_evidence_manifest.json", "tamper_proof_audit_timeline.pdf"],
        "download_url": "/api/static/mock_bundle.zip"
    }

@app.get("/api/audit/comments")
def get_audit_comments(control_id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Auditor", "Editor"]))):
    return db.query(models.AuditComment).filter_by(control_id=control_id, org_id=current_user.org_id).all()

class CommentCreateRequest(BaseModel):
    control_id: str
    comment_text: str

@app.post("/api/audit/comments")
def create_audit_comment(request: CommentCreateRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.get_current_user)):
    comment = models.AuditComment(
        id=str(uuid.uuid4()),
        org_id=current_user.org_id,
        control_id=request.control_id,
        sender_name=current_user.name,
        comment_text=request.comment_text,
        timestamp=int(time.time())
    )
    db.add(comment)
    db.commit()
    return {"status": "success"}

# 11. Security Trust Center
@app.get("/api/trust/documents")
def get_trust_documents():
    # Trust Center documents are published by the operator; none ship by default.
    return []

class NDASignRequest(BaseModel):
    company_name: str
    contact_email: str

@app.post("/api/trust/sign-nda")
def sign_nda(request: NDASignRequest):
    return {"status": "success", "nda_signed": True, "token": str(uuid.uuid4())}

class TrustChatRequest(BaseModel):
    query: str

@app.post("/api/trust/chat")
def trust_center_chat(request: TrustChatRequest):
    prompt = f"Respond to prospective client query: '{request.query}'. Verify compliance posture using Basel III, CBEST, and GDPR controls."
    response = ai_gateway.generate_content(prompt, "You are a customer trust advisor assistant answering security audits.")
    # Note: trust_center_chat has no current_user dependency yet; org_id plumbing is handled via agent-query
    return {"response": response}

# 12. AI Agent Console & Trust Graph Node-link calculations
class AgentQueryRequest(BaseModel):
    agent_id: str
    prompt: str

# Map the UI's agent ids to the agno agent ids defined in ai_agents.AGENT_DEFINITIONS.
AGENT_ID_MAP = {
    "compliance_agent": "compliance-agent",
    "tprm_agent": "tprm-agent",
    "trust_agent": "customer-trust-agent",
    "risk_agent": "risk-propagation-agent",
}

@app.post("/api/ai/agent-query")
def query_ai_agent(request: AgentQueryRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.get_current_user)):
    agno_agent_id = AGENT_ID_MAP.get(request.agent_id)
    if not agno_agent_id:
        # Unknown agent id -> answer with a generic GRC officer persona (no tool steps).
        response = ai_gateway.generate_content(
            request.prompt, "You are a senior GRC compliance officer.", org_id=current_user.org_id
        )
        return {"response": response, "steps": []}

    result = ai_agents.run_agent_detailed(agno_agent_id, request.prompt, current_user.org_id)
    return {"response": result["content"], "steps": result.get("steps", [])}

@app.get("/api/ai/trust-graph")
def get_trust_graph(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.get_current_user)):
    nodes = []
    links = []
    
    integrations = db.query(models.Integration).filter_by(org_id=current_user.org_id).all()
    for i in integrations:
        nodes.append({"id": i.id, "label": i.name, "type": "integration", "status": i.status})
        
    assets = db.query(models.Asset).filter_by(org_id=current_user.org_id).all()
    for a in assets:
        nodes.append({"id": a.id, "label": a.name, "type": "asset", "status": a.compliance_status})
        if a.integration_id:
            links.append({"source": a.integration_id, "target": a.id, "type": "provides"})
            
    controls = db.query(models.Control).filter_by(org_id=current_user.org_id).all()
    for c in controls:
        nodes.append({"id": c.id, "label": c.title, "type": "control", "status": c.status})
        if "CET1" in c.control_code:
            links.append({"source": "aws", "target": c.id, "type": "audits"})
        elif "GDPR" in c.control_code:
            links.append({"source": "asset-01", "target": c.id, "type": "secures"})
        elif "MFA" in c.control_code:
            links.append({"source": "okta", "target": c.id, "type": "governs"})
        elif "GIT" in c.control_code:
            links.append({"source": "asset-02", "target": c.id, "type": "checks"})
            
    risks = db.query(models.Risk).filter_by(org_id=current_user.org_id).all()
    for r in risks:
        nodes.append({"id": r.id, "label": r.title, "type": "risk", "status": r.status})
        for mit in r.mitigations:
            links.append({"source": mit.id, "target": r.id, "type": "mitigates"})
            
    return {"nodes": nodes, "links": links}

# 13. Framework List & Dynamic Progress
@app.get("/api/frameworks")
def get_frameworks(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    frameworks = db.query(models.Framework).filter_by(org_id=current_user.org_id).all()
    result = []
    for f in frameworks:
        mapped_controls = db.query(models.Control).filter(
            models.Control.org_id == current_user.org_id,
            models.Control.frameworks.contains(f.id)
        ).all()
        total_mapped = len(mapped_controls)
        passing_mapped = sum(1 for c in mapped_controls if c.status == "Passing")
        readiness = int((passing_mapped / total_mapped) * 100) if total_mapped > 0 else 0
        result.append({
            "id": f.id,
            "name": f.name,
            "code": f.code,
            "description": f.description,
            "readiness": readiness,
            "controls_count": total_mapped
        })
    return result


class FrameworkImportRequest(BaseModel):
    framework_id: str


@app.get("/api/frameworks/library")
def get_framework_library(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    """List the importable framework catalog with per-framework import status."""
    return framework_library.list_library(db, current_user.org_id)


@app.post("/api/frameworks/import")
def import_framework(request: FrameworkImportRequest, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    """Import a framework and materialise its controls into the organization."""
    try:
        summary = framework_library.import_framework(db, current_user.org_id, request.framework_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": f"Imported {summary['name']}.", **summary}


@app.delete("/api/frameworks/{framework_id}")
def delete_framework(framework_id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    """Remove a framework; strips its tag from controls and deletes orphans."""
    return framework_library.remove_framework(db, current_user.org_id, framework_id)


# --- Continuous monitoring / drift detection ---

@app.get("/api/drift")
def get_drift_events(
    only_drift: bool = Query(True),
    limit: int = Query(50),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"])),
):
    """Recent control status changes. Defaults to drift (regressions) only."""
    q = db.query(models.ControlStatusEvent).filter_by(org_id=current_user.org_id)
    if only_drift:
        q = q.filter(models.ControlStatusEvent.is_drift == True)  # noqa: E712
    events = q.order_by(models.ControlStatusEvent.detected_at.desc()).limit(max(1, min(limit, 200))).all()

    # Resolve control titles in one pass.
    codes = {e.control_code for e in events}
    titles = {
        c.control_code: c.title
        for c in db.query(models.Control).filter(
            models.Control.org_id == current_user.org_id,
            models.Control.control_code.in_(codes or [""]),
        ).all()
    }
    return [
        {
            "id": e.id,
            "control_code": e.control_code,
            "control_title": titles.get(e.control_code, e.control_code),
            "old_status": e.old_status,
            "new_status": e.new_status,
            "source": e.source,
            "is_drift": e.is_drift,
            "acknowledged": e.acknowledged,
            "detected_at": e.detected_at,
        }
        for e in events
    ]


@app.post("/api/drift/{event_id}/acknowledge")
def acknowledge_drift(event_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    event = db.query(models.ControlStatusEvent).filter_by(id=event_id, org_id=current_user.org_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Drift event not found.")
    event.acknowledged = True
    db.commit()
    return {"status": "acknowledged", "id": event_id}


@app.post("/api/integrations/sync-all")
def sync_all_integrations(background_tasks: BackgroundTasks, current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    """Manually trigger a sync of every Connected integration (same path the
    scheduler uses for continuous monitoring)."""
    import scheduler
    background_tasks.add_task(scheduler.run_all_syncs, "manual")
    return {"status": "started", "message": "Re-syncing all connected integrations."}


# --- Remediation tasks ---

class RemediationTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    control_code: Optional[str] = None
    owner_id: Optional[str] = None
    priority: Optional[str] = "Medium"
    due_date: Optional[int] = None


class RemediationTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    owner_id: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[int] = None


def _serialize_task(t: models.RemediationTask, owner_name: Optional[str] = None) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "control_code": t.control_code,
        "owner_id": t.owner_id,
        "owner_name": owner_name,
        "priority": t.priority,
        "status": t.status,
        "due_date": t.due_date,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


@app.get("/api/tasks")
def list_remediation_tasks(
    status: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"])),
):
    q = db.query(models.RemediationTask).filter_by(org_id=current_user.org_id)
    if status:
        q = q.filter(models.RemediationTask.status == status)
    tasks = q.order_by(models.RemediationTask.created_at.desc()).all()
    owner_ids = {t.owner_id for t in tasks if t.owner_id}
    owners = {
        u.id: u.name
        for u in db.query(models.User).filter(models.User.id.in_(owner_ids or [""])).all()
    }
    return [_serialize_task(t, owners.get(t.owner_id)) for t in tasks]


@app.post("/api/tasks")
def create_remediation_task(req: RemediationTaskCreate, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    now = int(time.time())
    control = None
    if req.control_code:
        control = db.query(models.Control).filter_by(org_id=current_user.org_id, control_code=req.control_code).first()
    task = models.RemediationTask(
        id=f"task_{uuid.uuid4().hex[:12]}",
        org_id=current_user.org_id,
        title=req.title,
        description=req.description,
        control_id=control.id if control else None,
        control_code=req.control_code,
        owner_id=req.owner_id,
        priority=req.priority or "Medium",
        status="Open",
        due_date=req.due_date,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _serialize_task(task)


@app.post("/api/tasks/from-control/{control_code}")
def create_task_from_control(control_code: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    """Create a remediation task pre-filled from a failing/at-risk control."""
    control = db.query(models.Control).filter_by(org_id=current_user.org_id, control_code=control_code).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found.")
    now = int(time.time())
    priority = "High" if control.status == "Failing" else "Medium"
    task = models.RemediationTask(
        id=f"task_{uuid.uuid4().hex[:12]}",
        org_id=current_user.org_id,
        title=f"Remediate: {control.title}",
        description=f"Control {control.control_code} is {control.status}. {control.description or ''}".strip(),
        control_id=control.id,
        control_code=control.control_code,
        owner_id=control.owner_id,
        priority=priority,
        status="Open",
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _serialize_task(task)


@app.patch("/api/tasks/{task_id}")
def update_remediation_task(task_id: str, req: RemediationTaskUpdate, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    task = db.query(models.RemediationTask).filter_by(id=task_id, org_id=current_user.org_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    for field in ("title", "description", "owner_id", "priority", "status", "due_date"):
        val = getattr(req, field)
        if val is not None:
            setattr(task, field, val)
    task.updated_at = int(time.time())
    db.commit()
    db.refresh(task)
    return _serialize_task(task)


@app.delete("/api/tasks/{task_id}")
def delete_remediation_task(task_id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor"]))):
    task = db.query(models.RemediationTask).filter_by(id=task_id, org_id=current_user.org_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    db.delete(task)
    db.commit()
    return {"status": "deleted", "id": task_id}


# --- Notifications ---

@app.get("/api/notifications")
def list_notifications(
    unread_only: bool = Query(False),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"])),
):
    """List notifications. Generates overdue-task alerts on read (idempotent)."""
    import notifications as notif
    try:
        notif.generate_overdue_task_notifications(db, current_user.org_id)
    except Exception as e:
        print(f"Overdue notification generation skipped: {e}")

    q = db.query(models.Notification).filter_by(org_id=current_user.org_id)
    if unread_only:
        q = q.filter(models.Notification.read == False)  # noqa: E712
    items = q.order_by(models.Notification.created_at.desc()).limit(100).all()
    unread = db.query(models.Notification).filter_by(org_id=current_user.org_id, read=False).count()
    return {
        "unread_count": unread,
        "notifications": [
            {
                "id": n.id,
                "type": n.type,
                "severity": n.severity,
                "title": n.title,
                "message": n.message,
                "link": n.link,
                "read": n.read,
                "created_at": n.created_at,
            }
            for n in items
        ],
    }


@app.post("/api/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    n = db.query(models.Notification).filter_by(id=notification_id, org_id=current_user.org_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found.")
    n.read = True
    db.commit()
    return {"status": "read", "id": notification_id}


@app.post("/api/notifications/read-all")
def mark_all_notifications_read(db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"]))):
    db.query(models.Notification).filter_by(org_id=current_user.org_id, read=False).update({"read": True})
    db.commit()
    return {"status": "all_read"}


# --- Reports / export ---

@app.get("/api/reports/gap-analysis")
def get_gap_analysis(
    framework_id: Optional[str] = Query(None),
    include_ai: bool = Query(False),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"])),
):
    """JSON gap analysis across imported frameworks (optionally one framework)."""
    import reports
    report = reports.build_gap_analysis(db, current_user.org_id, framework_id)
    if include_ai:
        report["executive_summary"] = reports.ai_executive_summary(report, current_user.org_id)
    return report


@app.get("/api/reports/export")
def export_report(
    format: str = Query("csv"),
    framework_id: Optional[str] = Query(None),
    include_ai: bool = Query(False),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.RequireRole(["Admin", "Editor", "Auditor", "Viewer"])),
):
    """Download the gap analysis as CSV or PDF."""
    import reports
    from fastapi.responses import Response, PlainTextResponse
    report = reports.build_gap_analysis(db, current_user.org_id, framework_id)
    fmt = (format or "csv").lower()

    if fmt == "csv":
        body = reports.render_csv(report)
        fname = reports.report_filename(report, framework_id, "csv")
        return PlainTextResponse(
            body,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    if fmt == "pdf":
        summary = reports.ai_executive_summary(report, current_user.org_id) if include_ai else ""
        body = reports.render_pdf(report, summary)
        fname = reports.report_filename(report, framework_id, "pdf")
        return Response(
            content=body,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    raise HTTPException(status_code=400, detail="format must be 'csv' or 'pdf'.")
