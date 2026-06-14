import os
import time
import jwt
import httpx
from dotenv import load_dotenv
from fastapi import Header, HTTPException, Depends, status
from sqlalchemy.orm import Session
from database import get_db
from models import User, Organization, Department
import seed

# Load .env BEFORE reading any environment variables below. auth.py may be
# imported before any other module calls load_dotenv(), so without this the
# Clerk settings would be captured as None and every authed request would 500.
load_dotenv()

CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL")
CLERK_AUDIENCE = os.environ.get("CLERK_AUDIENCE") # Clerk Client ID/Frontend App ID
CLERK_MOCK_AUTH = os.environ.get("CLERK_MOCK_AUTH", "false").lower() == "true"
DEFAULT_COMPANY_ID = os.environ.get("DEFAULT_COMPANY_ID", "bank_enterprise")
DEFAULT_COMPANY_NAME = os.environ.get("DEFAULT_COMPANY_NAME", "Your Organization")
SUPER_ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.environ.get("SUPER_ADMIN_EMAILS", "superadmin@arbapexbank.example").split(",")
    if email.strip()
}
SUPER_ADMIN_USER_IDS = {
    user_id.strip()
    for user_id in os.environ.get("SUPER_ADMIN_USER_IDS", "").split(",")
    if user_id.strip()
}
SUPER_ADMIN_USERNAMES = {
    username.strip().lower()
    for username in os.environ.get("SUPER_ADMIN_USERNAMES", "radiantseraph1").split(",")
    if username.strip()
}

# Cache for JWKS keys to avoid querying Clerk API on every request
jwks_cache = {}

def get_clerk_public_key(kid: str) -> dict:
    """Fetch public key from Clerk JWKS corresponding to kid."""
    global jwks_cache
    if kid in jwks_cache:
        return jwks_cache[kid]
        
    if not CLERK_JWKS_URL:
        raise HTTPException(
            status_code=500,
            detail="Clerk JWKS URL is not configured. Enable CLERK_MOCK_AUTH=true for local bypass."
        )
        
    try:
        response = httpx.get(CLERK_JWKS_URL)
        response.raise_for_status()
        jwks = response.json()
        
        for key in jwks.get("keys", []):
            jwks_cache[key["kid"]] = key
            
        if kid in jwks_cache:
            return jwks_cache[kid]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve Clerk JWKS: {str(e)}"
        )
        
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid token key ID (kid)."
    )

def verify_clerk_token(authorization: str = Header(None)) -> dict:
    """Extract and verify the Clerk JWT token from the Authorization header."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is missing."
        )
        
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be in the format 'Bearer <token>'."
        )
        
    token = parts[1]
    
    # Mock/Bypass mode for local testing/demo without Clerk keys
    if CLERK_MOCK_AUTH:
        try:
            # Decode token without signature verification to extract claims
            payload = jwt.decode(token, options={"verify_signature": False})
            payload["org_id"] = DEFAULT_COMPANY_ID
            payload["org_name"] = DEFAULT_COMPANY_NAME
            return payload
        except Exception as e:
            # If token is not a valid JWT (e.g. dummy test header), return a mock admin payload
            if token == "mock-admin-token":
                return {
                    "sub": "bank_user_admin",
                    "email": "ciso@arbapexbank.example",
                    "name": "Alex Carter",
                    "org_id": DEFAULT_COMPANY_ID,
                    "org_name": DEFAULT_COMPANY_NAME,
                    "public_metadata": {"role": "Admin", "department": "Security"}
                }
            elif token == "mock-super-admin-token":
                return {
                    "sub": "bank_user_super_admin",
                    "email": "superadmin@arbapexbank.example",
                    "name": "Morgan Hale",
                    "org_id": DEFAULT_COMPANY_ID,
                    "org_name": DEFAULT_COMPANY_NAME,
                    "public_metadata": {"role": "SuperAdmin", "department": "Platform Governance"}
                }
            elif token == "mock-editor-token":
                return {
                    "sub": "bank_user_editor",
                    "email": "compliance@arbapexbank.example",
                    "name": "David Vance",
                    "org_id": DEFAULT_COMPANY_ID,
                    "org_name": DEFAULT_COMPANY_NAME,
                    "public_metadata": {"role": "Editor", "department": "Compliance"}
                }
            elif token == "mock-auditor-token":
                return {
                    "sub": "bank_user_auditor",
                    "email": "audit@arbapexbank.example",
                    "name": "Sarah Jenkins",
                    "org_id": DEFAULT_COMPANY_ID,
                    "org_name": DEFAULT_COMPANY_NAME,
                    "public_metadata": {"role": "Auditor", "department": "Audit"}
                }
            elif token == "mock-employee-token":
                return {
                    "sub": "bank_user_employee",
                    "email": "platform@arbapexbank.example",
                    "name": "John Doe",
                    "org_id": DEFAULT_COMPANY_ID,
                    "org_name": DEFAULT_COMPANY_NAME,
                    "public_metadata": {"role": "Employee", "department": "Engineering"}
                }
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Failed to parse token claims: {str(e)}"
            )

    try:
        # Get token header to find the kid
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token header missing key ID (kid)."
            )
            
        jwk_key = get_clerk_public_key(kid)
        
        # Convert JWK to PEM public key using PyJWT/cryptography
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk_key)
        
        decode_kwargs = {
            "algorithms": ["RS256"],
            "options": {"verify_exp": True}
        }
        if CLERK_AUDIENCE:
            decode_kwargs["audience"] = CLERK_AUDIENCE
        else:
            decode_kwargs["options"]["verify_aud"] = False

        # Decode and verify the signature
        payload = jwt.decode(token, public_key, **decode_kwargs)
        # The product is single-company and multi-departmental; Clerk organization claims are ignored.
        payload["org_id"] = DEFAULT_COMPANY_ID
        payload["org_name"] = DEFAULT_COMPANY_NAME
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired."
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid signature or claims: {str(e)}"
        )

def get_current_user(payload: dict = Depends(verify_clerk_token), db: Session = Depends(get_db)) -> User:
    """Retrieve or register the authenticated user in the database."""
    clerk_id = payload.get("sub")
    email = payload.get("email") or payload.get("email_address")
    name = payload.get("name") or payload.get("first_name", "") + " " + payload.get("last_name", "")
    name = (name or email or clerk_id or "Active User").strip()
    username = payload.get("username") or payload.get("preferred_username")
    
    org_id = DEFAULT_COMPANY_ID
    org_name = DEFAULT_COMPANY_NAME
    
    # Metadata contains user role and department
    metadata = payload.get("public_metadata", {})
    role = metadata.get("role", "Admin")
    department = metadata.get("department", "General")
    if (
        clerk_id in SUPER_ADMIN_USER_IDS
        or (email and email.lower() in SUPER_ADMIN_EMAILS)
        or (username and username.lower() in SUPER_ADMIN_USERNAMES)
    ):
        role = "SuperAdmin"
        department = "Platform Governance"
    
    # 1. Ensure Organization is provisioned and seeded
    org = db.query(Organization).filter_by(id=org_id).first()
    if not org:
        # Create organization record
        org = Organization(id=org_id, name=org_name, created_at=int(time.time()))
        db.add(org)
        db.commit()
        db.refresh(org)
        
        # Seed default GRC data for the company operating model
        try:
            seed.seed_org_data(db, org_id, org_name)
        except Exception as e:
            print(f"Error seeding company data {org_id}: {str(e)}")
            
    # 2. Ensure User is provisioned under the single company key.
    user = db.query(User).filter_by(id=clerk_id, org_id=org_id).first()
    if not user:
        user = db.query(User).filter_by(id=clerk_id).first()
    if not user and email:
        user = db.query(User).filter_by(email=email, org_id=org_id).first() or db.query(User).filter_by(email=email).first()
    department_record = db.query(Department).filter_by(org_id=org_id, name=department).first()
    if not department_record:
        department_record = Department(
            id=f"dept_{org_id}_{department.lower().replace(' ', '_')}",
            org_id=org_id,
            name=department,
            description="Provisioned from authenticated user metadata.",
            status="Active",
            created_at=int(time.time())
        )
        db.add(department_record)
        db.commit()

    if not user:
        # Register new user from Clerk payload in database dynamically (SCIM-like provisioning)
        user = User(
            id=clerk_id,
            org_id=org_id,
            email=email,
            name=name,
            role=role,
            department=department,
            training_completed=False,
            background_check_passed=False,
            status="Active"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        updated = False
        if email and user.email != email:
            user.email = email
            updated = True
        if user.org_id != org_id:
            user.org_id = org_id
            updated = True
        if name and user.name != name:
            user.name = name
            updated = True
        if user.role != role:
            user.role = role
            updated = True
        if not user.department or user.department != department:
            user.department = department
            updated = True
        if not user.status:
            user.status = "Active"
            updated = True
        if updated:
            db.commit()
            db.refresh(user)
        
    return user

class RequireRole:
    """Dependency injection helper to restrict routes by role (RBAC)."""
    def __init__(self, allowed_roles: list[str]):
        self.allowed_roles = allowed_roles
        
    def __call__(self, user: User = Depends(get_current_user)) -> User:
        if user.role == "SuperAdmin" and "Admin" in self.allowed_roles:
            return user
        if user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {', '.join(self.allowed_roles)}. Your role: {user.role}"
            )
        return user

def verify_abac_access(resource_owner_id: str, user: User = Depends(get_current_user)):
    """Attribute-Based Access Control: Verify if the user owns the resource or is an Admin."""
    if user.role in ["Admin", "SuperAdmin"]:
        return True
    if resource_owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You do not own this resource."
        )
    return True
