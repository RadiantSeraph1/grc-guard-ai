import os
import httpx
from typing import Dict, Any, Optional, List

# ---------------------------------------------------------------------------
# Connector catalog
# ---------------------------------------------------------------------------
# Banking-focused data sources. Rows are provisioned per-organization (status
# "Disconnected") so operators connect real systems. Every connector talks to a
# live API when credentials are supplied - there is no canned data behind them.
#
#   * gcp / google_workspace : cloud + identity posture (live SaaS credentials)
#   * fineract               : core-banking control posture (self-hosted Apache
#                              Fineract - a real open-source core banking ledger)
#   * wazuh                  : endpoint/EDR posture (self-hosted Wazuh manager)
INTEGRATION_CATALOG: List[Dict[str, str]] = [
    {"id": "gcp", "name": "Google Cloud Platform", "category": "Cloud",
     "description": "Audits GCS bucket encryption / public access and Cloud Storage posture."},
    {"id": "google_workspace", "name": "Google Workspace", "category": "Identity",
     "description": "Audits Workspace users and 2-Step Verification enrollment via Admin SDK."},
    {"id": "fineract", "name": "Apache Fineract (Core Banking)", "category": "Core Banking",
     "description": "Audits core-banking controls on the ledger: maker-checker (four-eyes) approval, password policy, and audit trail."},
    {"id": "wazuh", "name": "Wazuh (EDR/XDR)", "category": "EDR",
     "description": "Audits endpoint agent/sensor coverage, outdated agents, and security manager health."},
]

CATALOG_IDS = {entry["id"] for entry in INTEGRATION_CATALOG}


# ---------------------------------------------------------------------------
# Shared audit helpers
# ---------------------------------------------------------------------------
def _missing(reason: str) -> dict:
    return {"compliant": False, "reason": reason, "details": {}}


def _summarize_posture(subject: str, checks: list) -> dict:
    """Aggregate [(label, passed, detail), ...] into one audit verdict.
    Compliant only when there is at least one check and all pass."""
    passed = sum(1 for _, ok, _ in checks if ok)
    total = len(checks)
    lines = [f"{label}: {'PASS' if ok else 'FAIL'}" + (f" ({detail})" if detail else "")
             for label, ok, detail in checks]
    return {
        "compliant": total > 0 and passed == total,
        "reason": f"{subject}: {passed}/{total} posture checks passed - " + "; ".join(lines),
        "details": {"passed": passed, "total": total,
                    "checks": [{"label": l, "passed": ok, "detail": d} for l, ok, d in checks]},
    }


def _port_spec_hits_admin(spec) -> bool:
    """True if a firewall port spec ('22', '20-25', '*', 'Any') covers SSH(22)
    or RDP(3389). Unknown specs (service tags) flag conservatively as True."""
    spec = str(spec).strip()
    if spec in ("*", "Any", "any", "0-65535"):
        return True
    try:
        lo, hi = (spec.split("-", 1) if "-" in spec else (spec, spec))
        lo, hi = int(lo), int(hi)
        return lo <= 22 <= hi or lo <= 3389 <= hi
    except Exception:
        return True


def _is_stale(iso_ts, days: int = 90) -> bool:
    """True if an ISO8601 last-login timestamp is older than `days`. A missing
    value returns False (avoids false-positives on freshly-created accounts).
    ponytail: Google reports never-logged-in as epoch 1970, which reads as stale."""
    if not iso_ts:
        return False
    try:
        from datetime import datetime, timezone
        t = datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).days > days
    except Exception:
        return False


class GCPClient:
    """Audits Google Cloud Storage encryption / public-access posture.

    Credentials: a service-account JSON key (string) with read access to the
    bucket, supplied as creds["service_account_json"]. Uses the JSON API with an
    OAuth2 access token minted from the service account.
    """
    def __init__(self, service_account_json: Optional[str] = None, project_id: Optional[str] = None):
        self.service_account_json = service_account_json or os.environ.get("GCP_SERVICE_ACCOUNT_JSON")
        self.project_id = project_id or os.environ.get("GCP_PROJECT_ID")

    def _token(self) -> Optional[str]:
        if not self.service_account_json:
            return None
        try:
            import json
            from google.oauth2 import service_account
            from google.auth.transport.requests import Request
            info = json.loads(self.service_account_json)
            # Read-only across GCP so one token covers storage + compute checks.
            creds = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/cloud-platform.read-only"]
            )
            creds.refresh(Request())
            return creds.token
        except Exception:
            return None

    def audit_project_posture(self, bucket_name: Optional[str] = None) -> dict:
        """Project-wide read-only posture audit: every GCS bucket enforces public
        access prevention, no firewall opens SSH/RDP to 0.0.0.0/0, and optionally
        a named bucket's encryption. Needs a service account with a read-only
        role (e.g. roles/viewer or roles/iam.securityReviewer) and the Compute
        API enabled for the firewall check.
        """
        if not self.service_account_json:
            return _missing("GCP service account JSON not configured.")
        if not self.project_id:
            return _missing("GCP project_id is required for a project posture audit.")
        token = self._token()
        if not token:
            return _missing("Failed to mint GCP access token. Check the service account key and scopes.")
        headers = {"Authorization": f"Bearer {token}"}
        checks = []
        try:
            with httpx.Client(timeout=25.0) as client:
                b = client.get("https://storage.googleapis.com/storage/v1/b", headers=headers,
                               params={"project": self.project_id, "fields": "items(name,iamConfiguration)"})
                if b.status_code == 200:
                    buckets = b.json().get("items", [])
                    exposed = [x["name"] for x in buckets
                               if x.get("iamConfiguration", {}).get("publicAccessPrevention") not in ("enforced", "inherited")]
                    checks.append(("GCS public access prevention", not exposed,
                                   "" if not exposed else
                                   f"{len(exposed)} buckets not enforced: {', '.join(exposed[:5])}"))
                else:
                    checks.append(("GCS public access prevention", False, f"bucket list failed {b.status_code}"))

                fw = client.get(f"https://compute.googleapis.com/compute/v1/projects/{self.project_id}/global/firewalls",
                                headers=headers, params={"fields": "items(name,direction,disabled,sourceRanges,allowed)"})
                if fw.status_code == 200:
                    open_fw = set()
                    for f in fw.json().get("items", []):
                        if f.get("disabled") or f.get("direction", "INGRESS") != "INGRESS":
                            continue
                        if "0.0.0.0/0" not in (f.get("sourceRanges") or []):
                            continue
                        for allow in f.get("allowed", []):
                            if allow.get("IPProtocol") not in ("tcp", "all"):
                                continue
                            ports = allow.get("ports")
                            if ports is None or any(_port_spec_hits_admin(p) for p in ports):
                                open_fw.add(f["name"])
                    checks.append(("Firewall SSH/RDP exposure", not open_fw,
                                   "" if not open_fw else
                                   f"{len(open_fw)} allow 22/3389 from 0.0.0.0/0: {', '.join(sorted(open_fw)[:5])}"))
                elif fw.status_code == 403:
                    checks.append(("Firewall SSH/RDP exposure", False, "Compute API disabled or missing permission"))
                else:
                    checks.append(("Firewall SSH/RDP exposure", False, f"firewall list failed {fw.status_code}"))
        except Exception as e:
            checks.append(("GCP checks", False, str(e)[:120]))

        if bucket_name:
            res = self.audit_bucket_encryption(bucket_name)
            checks.append((f"Bucket '{bucket_name}' encryption", res.get("compliant", False),
                           "" if res.get("compliant") else res.get("reason", "")))
        return _summarize_posture("GCP project", checks)

    def audit_bucket_encryption(self, bucket_name: str) -> dict:
        if not self.service_account_json:
            return _missing("GCP service account JSON not configured. Provide service_account_json.")
        if not bucket_name:
            return _missing("GCP bucket name not configured. Provide bucket_name.")
        token = self._token()
        if not token:
            return _missing("Failed to mint GCP access token. Check the service account key and scopes.")
        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.get(
                    f"https://storage.googleapis.com/storage/v1/b/{bucket_name}",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"fields": "encryption,iamConfiguration,name"},
                )
                if res.status_code != 200:
                    return _missing(f"GCP Storage API returned {res.status_code}: {res.text[:200]}")
                data = res.json()
                pap = data.get("iamConfiguration", {}).get("publicAccessPrevention")
                cmek = data.get("encryption", {}).get("defaultKmsKeyName")
                public_blocked = pap in ("enforced", "inherited")
                return {
                    "compliant": public_blocked,
                    "reason": (
                        f"GCS bucket '{bucket_name}' blocks public access (CMEK: {'yes' if cmek else 'Google-managed'})."
                        if public_blocked else
                        f"GCS bucket '{bucket_name}' does not enforce public access prevention."
                    ),
                    "details": {"publicAccessPrevention": pap, "defaultKmsKeyName": cmek},
                }
        except Exception as e:
            return _missing(f"GCP audit failed: {str(e)}")


class GoogleWorkspaceClient:
    """Audits Google Workspace users and 2-Step Verification via the Admin SDK.

    Credentials: a service-account JSON key with domain-wide delegation and the
    subject (an admin email) to impersonate, plus the customer id (default
    "my_customer").
    """
    def __init__(self, service_account_json=None, admin_email=None, customer="my_customer"):
        self.service_account_json = service_account_json or os.environ.get("GOOGLE_WORKSPACE_SA_JSON")
        self.admin_email = admin_email or os.environ.get("GOOGLE_WORKSPACE_ADMIN")
        self.customer = customer or os.environ.get("GOOGLE_WORKSPACE_CUSTOMER", "my_customer")

    def _token(self) -> Optional[str]:
        if not (self.service_account_json and self.admin_email):
            return None
        try:
            import json
            from google.oauth2 import service_account
            from google.auth.transport.requests import Request
            info = json.loads(self.service_account_json)
            creds = service_account.Credentials.from_service_account_info(
                info,
                scopes=["https://www.googleapis.com/auth/admin.directory.user.readonly"],
                subject=self.admin_email,
            )
            creds.refresh(Request())
            return creds.token
        except Exception:
            return None

    def audit_identity_posture(self) -> dict:
        """Identity posture from one directory fetch: all active users enrolled in
        2SV, every admin enrolled in 2SV, and no active account dormant (>90d).
        Needs the same directory.user.readonly scope as the 2SV check."""
        if not (self.service_account_json and self.admin_email):
            return _missing("Google Workspace not configured. Provide service_account_json and admin_email.")
        token = self._token()
        if not token:
            return _missing("Failed to mint Workspace token. Check domain-wide delegation and the admin subject.")
        headers = {"Authorization": f"Bearer {token}"}
        try:
            with httpx.Client(timeout=30.0) as client:
                users, page = [], None
                while True:
                    params = {"customer": self.customer, "maxResults": 200, "projection": "full"}
                    if page:
                        params["pageToken"] = page
                    res = client.get("https://admin.googleapis.com/admin/directory/v1/users",
                                     headers=headers, params=params)
                    if res.status_code != 200:
                        return _missing(f"Workspace users call returned {res.status_code}: {res.text[:200]}")
                    body = res.json()
                    users.extend(body.get("users", []))
                    page = body.get("nextPageToken")
                    if not page:
                        break
        except Exception as e:
            return _missing(f"Google Workspace audit failed: {str(e)}")

        active = [u for u in users if not u.get("suspended")]
        not_2sv = [u.get("primaryEmail") for u in active if not u.get("isEnrolledIn2Sv")]
        admins_no_2sv = [u.get("primaryEmail") for u in active
                         if (u.get("isAdmin") or u.get("isDelegatedAdmin")) and not u.get("isEnrolledIn2Sv")]
        stale = [u.get("primaryEmail") for u in active if _is_stale(u.get("lastLoginTime"))]
        checks = [
            ("2SV enrollment (all active)", len(active) > 0 and not not_2sv,
             "" if not not_2sv else f"{len(not_2sv)} of {len(active)} active users not enrolled"),
            ("Admins have 2SV", not admins_no_2sv,
             "" if not admins_no_2sv else f"{len(admins_no_2sv)} admins without 2SV: {', '.join([e for e in admins_no_2sv if e][:5])}"),
            ("No dormant active accounts", not stale,
             "" if not stale else f"{len([e for e in stale if e])} active >90d since login"),
        ]
        return _summarize_posture("Google Workspace", checks)

    def audit_2sv_enrollment(self) -> dict:
        if not (self.service_account_json and self.admin_email):
            return _missing("Google Workspace not configured. Provide service_account_json and admin_email.")
        token = self._token()
        if not token:
            return _missing("Failed to mint Workspace token. Check domain-wide delegation and the admin subject.")
        headers = {"Authorization": f"Bearer {token}"}
        try:
            with httpx.Client(timeout=30.0) as client:
                users, page = [], None
                while True:
                    params = {"customer": self.customer, "maxResults": 200, "projection": "basic"}
                    if page:
                        params["pageToken"] = page
                    res = client.get(
                        "https://admin.googleapis.com/admin/directory/v1/users",
                        headers=headers, params=params,
                    )
                    if res.status_code != 200:
                        return _missing(f"Workspace users call returned {res.status_code}: {res.text[:200]}")
                    body = res.json()
                    users.extend(body.get("users", []))
                    page = body.get("nextPageToken")
                    if not page:
                        break
                not_enrolled = [u.get("primaryEmail") for u in users
                                if not u.get("isEnrolledIn2Sv") and not u.get("suspended")]
                compliant = len(users) > 0 and len(not_enrolled) == 0
                return {
                    "compliant": compliant,
                    "reason": (
                        f"All {len(users)} Workspace users are enrolled in 2-Step Verification."
                        if compliant else
                        f"2SV gap: {len(not_enrolled)} active Workspace users are not enrolled in 2-Step Verification."
                    ),
                    "details": {"total_users": len(users), "not_enrolled": not_enrolled[:50]},
                }
        except Exception as e:
            return _missing(f"Google Workspace audit failed: {str(e)}")


class FineractClient:
    """Audits core-banking controls on a self-hosted Apache Fineract instance.

    Apache Fineract is a real open-source core-banking ledger. This client hits
    its REST API (default base https://<host>:8443, path /fineract-provider/api/v1)
    with HTTP basic auth and the tenant header. Because Fineract ships a
    self-signed certificate by default, TLS verification is off unless a CA is
    supplied - acceptable for an internal, attested deployment.

    Checks three Basel/CBEST-relevant governance controls:
      * Maker-checker (four-eyes) approval is enabled globally.
      * A strong password validation policy is active.
      * The audit trail is populated (privileged actions are logged).
    """
    def __init__(self, base_url=None, username=None, password=None, tenant="default", verify=False):
        self.base_url = (base_url or os.environ.get("FINERACT_BASE_URL", "")).rstrip("/")
        self.username = username or os.environ.get("FINERACT_USERNAME")
        self.password = password or os.environ.get("FINERACT_PASSWORD")
        self.tenant = tenant or os.environ.get("FINERACT_TENANT", "default")
        self.verify = verify

    def _api(self) -> str:
        return f"{self.base_url}/fineract-provider/api/v1"

    def audit_banking_controls(self) -> dict:
        if not (self.base_url and self.username and self.password):
            return _missing("Fineract not configured. Provide base_url, username, and password.")
        headers = {
            "Fineract-Platform-TenantId": self.tenant,
            "Accept": "application/json",
        }
        auth = (self.username, self.password)
        checks = []
        try:
            with httpx.Client(timeout=30.0, verify=self.verify, headers=headers, auth=auth) as client:
                # 1. Maker-checker (four-eyes) approval enabled globally.
                mc = client.get(f"{self._api()}/configurations/name/maker-checker")
                if mc.status_code == 200:
                    enabled = bool(mc.json().get("enabled"))
                    checks.append(("Maker-checker (four-eyes) enabled", enabled,
                                   "" if enabled else "global maker-checker configuration is OFF"))
                else:
                    checks.append(("Maker-checker (four-eyes) enabled", False,
                                   f"config call failed {mc.status_code}: {mc.text[:120]}"))

                # 2. A strong password validation policy is active.
                pw = client.get(f"{self._api()}/passwordvalidationpolicies")
                if pw.status_code == 200:
                    policies = pw.json() if isinstance(pw.json(), list) else []
                    active = [p for p in policies if p.get("active")]
                    strong = any(
                        (p.get("id") and int(p.get("id")) >= 2)
                        or "strong" in str(p.get("description", "")).lower()
                        for p in active
                    )
                    checks.append(("Strong password policy active", bool(active) and strong,
                                   "" if (active and strong) else
                                   ("no active password policy" if not active
                                    else "active policy is the weakest preset")))
                else:
                    checks.append(("Strong password policy active", False,
                                   f"password policy call failed {pw.status_code}"))

                # 3. Audit trail is populated (privileged actions are logged).
                au = client.get(f"{self._api()}/audits", params={"limit": 1})
                if au.status_code == 200:
                    body = au.json()
                    entries = body.get("pageItems", body) if isinstance(body, dict) else body
                    has_audit = bool(entries)
                    checks.append(("Audit trail active", has_audit,
                                   "" if has_audit else "audit trail returned no entries"))
                else:
                    checks.append(("Audit trail active", False,
                                   f"audit call failed {au.status_code}"))
        except Exception as e:
            return _missing(f"Fineract audit failed: {str(e)}")

        return _summarize_posture("Apache Fineract core banking", checks)


class WazuhClient:
    """Audits endpoint/EDR posture on a self-hosted Wazuh manager.

    Wazuh is a real open-source EDR/XDR. This client authenticates to the Wazuh
    server API (default port 55000), which returns a short-lived JWT, then reads
    agent and manager state. TLS verification is off by default because Wazuh
    ships a self-signed certificate.

    Checks:
      * Endpoint sensor coverage - every enrolled agent (excluding the manager,
        id 000) is actively connected.
      * No outdated agents running stale sensor versions.
      * The security manager's daemons are all running.
    """
    def __init__(self, base_url=None, username=None, password=None, verify=False):
        self.base_url = (base_url or os.environ.get("WAZUH_BASE_URL", "")).rstrip("/")
        self.username = username or os.environ.get("WAZUH_USERNAME")
        self.password = password or os.environ.get("WAZUH_PASSWORD")
        self.verify = verify

    def _token(self, client: httpx.Client) -> Optional[str]:
        res = client.post(f"{self.base_url}/security/user/authenticate",
                          params={"raw": "true"}, auth=(self.username, self.password))
        if res.status_code == 200:
            return res.text.strip()
        return None

    def audit_endpoint_posture(self) -> dict:
        if not (self.base_url and self.username and self.password):
            return _missing("Wazuh not configured. Provide base_url, username, and password.")
        checks = []
        try:
            with httpx.Client(timeout=30.0, verify=self.verify) as client:
                token = self._token(client)
                if not token:
                    return _missing("Failed to authenticate to the Wazuh API. Check base_url and credentials.")
                headers = {"Authorization": f"Bearer {token}"}

                # 1. Sensor coverage - every enrolled agent (excluding manager 000) is active.
                ag = client.get(f"{self.base_url}/agents", headers=headers,
                                params={"select": "status,id,name", "limit": 500})
                if ag.status_code == 200:
                    items = ag.json().get("data", {}).get("affected_items", [])
                    agents = [a for a in items if str(a.get("id")) != "000"]
                    down = [a.get("name") for a in agents if a.get("status") != "active"]
                    checks.append(("Endpoint sensor coverage", len(agents) > 0 and not down,
                                   "" if (agents and not down) else
                                   ("no agents enrolled" if not agents
                                    else f"{len(down)} of {len(agents)} agents not active: {', '.join([n for n in down if n][:5])}")))
                else:
                    checks.append(("Endpoint sensor coverage", False, f"agents call failed {ag.status_code}"))

                # 2. No outdated agents.
                od = client.get(f"{self.base_url}/agents/outdated", headers=headers, params={"limit": 500})
                if od.status_code == 200:
                    outdated = od.json().get("data", {}).get("affected_items", [])
                    checks.append(("No outdated agents", not outdated,
                                   "" if not outdated else f"{len(outdated)} agents on a stale sensor version"))
                else:
                    checks.append(("No outdated agents", False, f"outdated call failed {od.status_code}"))

                # 3. Manager daemons all running.
                ms = client.get(f"{self.base_url}/manager/status", headers=headers)
                if ms.status_code == 200:
                    daemons = ms.json().get("data", {}).get("affected_items", [{}])
                    daemon_map = daemons[0] if daemons else {}
                    stopped = [k for k, v in daemon_map.items() if v not in ("running", "N/A")]
                    checks.append(("Security manager healthy", not stopped,
                                   "" if not stopped else f"{len(stopped)} daemons not running: {', '.join(stopped[:5])}"))
                else:
                    checks.append(("Security manager healthy", False, f"manager status call failed {ms.status_code}"))
        except Exception as e:
            return _missing(f"Wazuh audit failed: {str(e)}")

        return _summarize_posture("Wazuh EDR", checks)


# ---------------------------------------------------------------------------
# Connect-form fields + sync dispatch
# ---------------------------------------------------------------------------
# CONNECTOR_FIELDS drives the frontend connect form (one input per field, no
# raw JSON blob). The submitted values arrive as a JSON object of {key: value},
# which each SYNC_HANDLERS entry consumes. Adding a connector = one catalog
# row, one client class, one fields list, one handler line.

CONNECTOR_FIELDS: Dict[str, List[Dict[str, Any]]] = {
    "gcp": [
        {"key": "service_account_json", "label": "Service account JSON", "secret": True, "multiline": True},
        {"key": "project_id", "label": "Project ID", "secret": False},
        {"key": "bucket_name", "label": "GCS bucket to also check", "secret": False, "required": False},
    ],
    "google_workspace": [
        {"key": "service_account_json", "label": "Service account JSON (domain-wide delegation)", "secret": True, "multiline": True},
        {"key": "admin_email", "label": "Admin email to impersonate", "secret": False},
    ],
    "fineract": [
        {"key": "base_url", "label": "Fineract base URL", "secret": False, "placeholder": "https://localhost:8443"},
        {"key": "username", "label": "API username", "secret": False, "placeholder": "mifos"},
        {"key": "password", "label": "API password", "secret": True},
        {"key": "tenant", "label": "Tenant identifier", "secret": False, "required": False, "placeholder": "default"},
    ],
    "wazuh": [
        {"key": "base_url", "label": "Wazuh API base URL", "secret": False, "placeholder": "https://localhost:55000"},
        {"key": "username", "label": "API username", "secret": False, "placeholder": "wazuh"},
        {"key": "password", "label": "API password", "secret": True},
    ],
}


def _first(creds: dict, *keys, part: int = None, default=None):
    """Credential lookup with legacy colon-separated 'parts' fallback."""
    for key in keys:
        if creds.get(key):
            return creds[key]
    parts = creds.get("parts", [])
    if part is not None and len(parts) > part:
        return parts[part]
    return default


SYNC_HANDLERS = {
    "gcp": lambda c: GCPClient(c.get("service_account_json"), c.get("project_id"))
        .audit_project_posture(c.get("bucket_name") or None),
    "google_workspace": lambda c: GoogleWorkspaceClient(c.get("service_account_json"), c.get("admin_email"),
                                                        c.get("customer", "my_customer")).audit_identity_posture(),
    "fineract": lambda c: FineractClient(c.get("base_url"), c.get("username"), c.get("password"),
                                         c.get("tenant") or "default").audit_banking_controls(),
    "wazuh": lambda c: WazuhClient(c.get("base_url"), c.get("username"),
                                   c.get("password")).audit_endpoint_posture(),
}
