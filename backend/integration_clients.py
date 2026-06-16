import os
import httpx
from typing import Dict, Any, Optional, List

# ---------------------------------------------------------------------------
# Connector catalog
# ---------------------------------------------------------------------------
# The catalog defines every data source the platform can connect to. Rows are
# provisioned per-organization (status "Disconnected") so operators can connect
# real systems. There is no demo data behind these - each connector talks to a
# live vendor API when credentials are supplied.
INTEGRATION_CATALOG: List[Dict[str, str]] = [
    {"id": "aws", "name": "Amazon Web Services", "category": "Cloud",
     "description": "Audits S3 bucket encryption and storage security configuration."},
    {"id": "gcp", "name": "Google Cloud Platform", "category": "Cloud",
     "description": "Audits GCS bucket encryption / public access and Cloud Storage posture."},
    {"id": "azure", "name": "Microsoft Azure", "category": "Cloud",
     "description": "Audits Storage Account secure-transfer and encryption settings."},
    {"id": "okta", "name": "Okta Identity Manager", "category": "Identity",
     "description": "Retrieves user rosters and verifies MFA factor enrollment."},
    {"id": "auth0", "name": "Auth0 Identity Platform", "category": "Identity",
     "description": "Audits directory users, MFA Guardian enrollment, login logs, and roles."},
    {"id": "entra", "name": "Microsoft Entra ID (M365)", "category": "Identity",
     "description": "Audits Entra ID users and per-user MFA / authentication methods via Graph."},
    {"id": "google_workspace", "name": "Google Workspace", "category": "Identity",
     "description": "Audits Workspace users and 2-Step Verification enrollment via Admin SDK."},
    {"id": "github", "name": "GitHub", "category": "Developer",
     "description": "Evaluates branch protection and pull request review rules."},
    {"id": "snyk", "name": "Snyk", "category": "Developer",
     "description": "Audits open vulnerability findings across monitored projects."},
    {"id": "crowdstrike", "name": "CrowdStrike Falcon", "category": "EDR",
     "description": "Audits endpoint sensor coverage and detection posture."},
    {"id": "jamf", "name": "Jamf Pro MDM", "category": "EDR",
     "description": "Validates managed workstation enrollment and FileVault encryption."},
    {"id": "workday", "name": "Workday HRIS", "category": "HRIS",
     "description": "Syncs active worker roster and onboarding/offboarding status."},
]

CATALOG_IDS = {entry["id"] for entry in INTEGRATION_CATALOG}


class AWSClient:
    """Real client for auditing AWS resources using boto3."""
    def __init__(self, access_key: Optional[str] = None, secret_key: Optional[str] = None, region: str = "us-east-1"):
        self.access_key = access_key or os.environ.get("AWS_ACCESS_KEY_ID")
        self.secret_key = secret_key or os.environ.get("AWS_SECRET_ACCESS_KEY")
        self.region = region

    def audit_s3_encryption(self, bucket_name: str) -> dict:
        """Query AWS S3 API to check bucket encryption status."""
        if not self.access_key or not self.secret_key:
            return {
                "compliant": False,
                "reason": "AWS credentials not configured. Please supply keys in Settings.",
                "details": {}
            }
            
        try:
            import boto3
            from botocore.exceptions import ClientError
            
            s3_client = boto3.client(
                's3',
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region
            )
            
            # Check encryption
            try:
                enc = s3_client.get_bucket_encryption(Bucket=bucket_name)
                rules = enc.get('ServerSideEncryptionConfiguration', {}).get('Rules', [])
                return {
                    "compliant": len(rules) > 0,
                    "reason": "Server-side encryption is enabled." if len(rules) > 0 else "No encryption rules configured.",
                    "details": rules
                }
            except ClientError as e:
                if e.response['Error']['Code'] == 'ServerSideEncryptionConfigurationNotFoundError':
                    return {
                        "compliant": False,
                        "reason": "Server-side encryption is disabled (SSEConfig not found).",
                        "details": {}
                    }
                raise e
        except Exception as e:
            return {
                "compliant": False,
                "reason": f"AWS connection failed: {str(e)}",
                "details": {}
            }

class GitHubClient:
    """Real client for auditing repositories using GitHub's REST API."""
    def __init__(self, token: Optional[str] = None):
        self.token = token or os.environ.get("GITHUB_TOKEN")

    def list_repos(self, limit: int = 100) -> list:
        """List repositories the token can access (for repo selection)."""
        if not self.token:
            return []
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        try:
            with httpx.Client(timeout=20.0) as client:
                res = client.get(
                    "https://api.github.com/user/repos",
                    headers=headers,
                    params={"per_page": min(limit, 100), "sort": "updated",
                            "affiliation": "owner,organization_member"},
                )
                if res.status_code != 200:
                    return []
                return [
                    {
                        "owner": r.get("owner", {}).get("login"),
                        "repo": r.get("name"),
                        "default_branch": r.get("default_branch", "main"),
                        "private": r.get("private", False),
                    }
                    for r in res.json()
                ]
        except Exception:
            return []

    def audit_branch_protection(self, owner: str, repo: str, branch: str = "main") -> dict:
        """Query GitHub API to verify branch protection rules are active."""
        if not self.token:
            return {
                "compliant": False,
                "reason": "GitHub API token not configured. Please supply GITHUB_TOKEN in Settings.",
                "details": {}
            }
            
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
        protection_url = f"https://api.github.com/repos/{owner}/{repo}/branches/{branch}/protection"
        rules_url = f"https://api.github.com/repos/{owner}/{repo}/rules/branches/{branch}"
        PROTECTIVE = {"pull_request", "required_status_checks", "required_signatures",
                      "non_fast_forward", "required_linear_history", "deletion", "update"}

        try:
            with httpx.Client(timeout=15.0) as client:
                # 1. Modern rules API — covers Rulesets AND classic rules, and is
                #    readable without repo-admin (works for org members).
                rr = client.get(rules_url, headers=headers)
                if rr.status_code == 200:
                    rules = rr.json() or []
                    types = {r.get("type") for r in rules if r.get("type")}
                    protective = types & PROTECTIVE
                    if protective:
                        has_pr = "pull_request" in types
                        return {
                            "compliant": True,
                            "reason": (
                                f"Branch '{branch}' is protected by {len(rules)} rule(s)"
                                + (" including required pull-request reviews" if has_pr else "")
                                + f" ({', '.join(sorted(protective))})."
                            ),
                            "details": {"rule_types": sorted(types)},
                        }

                # 2. Classic branch-protection endpoint (admin-only) for full detail.
                response = client.get(protection_url, headers=headers)
                if response.status_code == 200:
                    data = response.json()
                    min_approvals = data.get("required_pull_request_reviews", {}).get("required_approving_review_count", 0)
                    return {
                        "compliant": True,
                        "reason": f"Classic branch protection active on '{branch}' (min reviews: {min_approvals}).",
                        "details": data,
                    }
                if response.status_code == 404:
                    return {
                        "compliant": False,
                        "reason": f"No branch protection rule or ruleset on '{branch}' (or the branch does not exist). Add a rule under Settings → Rules/Branches.",
                        "details": {},
                    }
                if response.status_code == 403:
                    return {
                        "compliant": False,
                        "reason": f"Access denied reading classic branch protection for {owner}/{repo}. Use a Ruleset (readable to members) or pick a repo you administer.",
                        "details": {},
                    }
                return {
                    "compliant": False,
                    "reason": f"GitHub returned status code: {response.status_code} for {owner}/{repo}.",
                    "details": {},
                }
        except Exception as e:
            return {
                "compliant": False,
                "reason": f"GitHub API request failed: {str(e)}",
                "details": {},
            }

class OktaClient:
    """Real client for auditing users and MFA configurations using Okta's Users API."""
    def __init__(self, org_url: Optional[str] = None, token: Optional[str] = None):
        self.org_url = org_url or os.environ.get("OKTA_ORG_URL")
        self.token = token or os.environ.get("OKTA_API_TOKEN")

    def audit_mfa_enrollment(self) -> dict:
        """Fetch users and check their MFA enrollment factors."""
        if not self.org_url or not self.token:
            return {
                "compliant": False,
                "reason": "Okta org URL or API token not configured. Please configure Okta details in Settings.",
                "details": {}
            }
            
        # Standard Okta URL path
        url = f"{self.org_url.rstrip('/')}/api/v1/users"
        headers = {
            "Authorization": f"SSWS {self.token}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(url, headers=headers)
                if response.status_code == 200:
                    users = response.json()
                    unprotected_users = []
                    
                    for user in users:
                        user_id = user["id"]
                        user_email = user.get("profile", {}).get("email", "Unknown")
                        
                        # Query factor details for each user
                        factor_url = f"{url}/{user_id}/factors"
                        factor_res = client.get(factor_url, headers=headers)
                        
                        if factor_res.status_code == 200:
                            factors = factor_res.json()
                            active_factors = [f for f in factors if f.get("status") == "ACTIVE"]
                            if len(active_factors) == 0:
                                unprotected_users.append(user_email)
                                
                    if len(unprotected_users) > 0:
                        return {
                            "compliant": False,
                            "reason": f"MFA compliance breach: {len(unprotected_users)} users have no active MFA factors enrolled.",
                            "details": {"unprotected_users": unprotected_users}
                        }
                    return {
                        "compliant": True,
                        "reason": f"All {len(users)} users have active MFA factors enrolled in Okta.",
                        "details": {"total_users": len(users)}
                    }
                else:
                    return {
                        "compliant": False,
                        "reason": f"Okta API returned status code: {response.status_code}",
                        "details": {}
                    }
        except Exception as e:
            return {
                "compliant": False,
                "reason": f"Okta API request failed: {str(e)}",
                "details": {}
            }

class Auth0Client:
    """Real client for auditing users, MFA, and access via Auth0 Management API."""
    def __init__(self, domain: Optional[str] = None, client_id: Optional[str] = None, client_secret: Optional[str] = None):
        self.domain = domain or os.environ.get("AUTH0_DOMAIN")
        self.client_id = client_id or os.environ.get("AUTH0_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("AUTH0_CLIENT_SECRET")
        self._access_token = None

    def _get_access_token(self) -> Optional[str]:
        """Obtain a Management API access token using client_credentials grant."""
        if self._access_token:
            return self._access_token
        if not self.domain or not self.client_id or not self.client_secret:
            return None

        url = f"https://{self.domain}/oauth/token"
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "audience": f"https://{self.domain}/api/v2/",
            "grant_type": "client_credentials"
        }
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.post(url, json=payload)
                if response.status_code == 200:
                    self._access_token = response.json().get("access_token")
                    return self._access_token
        except Exception:
            pass
        return None

    def _get_headers(self) -> dict:
        token = self._get_access_token()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def audit_users(self) -> dict:
        """Fetch all users from the configured Auth0 directory."""
        if not self.domain or not self.client_id or not self.client_secret:
            return {
                "compliant": False,
                "reason": "Auth0 credentials not configured. Please supply AUTH0_DOMAIN, AUTH0_CLIENT_ID, and AUTH0_CLIENT_SECRET.",
                "details": {}
            }

        token = self._get_access_token()
        if not token:
            return {
                "compliant": False,
                "reason": "Failed to obtain Auth0 Management API access token. Check client credentials and API permissions.",
                "details": {}
            }

        url = f"https://{self.domain}/api/v2/users"
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(url, headers=self._get_headers(), params={"per_page": 100})
                if response.status_code == 200:
                    users = response.json()
                    return {
                        "compliant": True,
                        "reason": f"Successfully fetched {len(users)} users from Auth0 directory.",
                        "details": {
                            "total_users": len(users),
                            "users": [
                                {
                                    "user_id": u.get("user_id"),
                                    "email": u.get("email"),
                                    "name": u.get("name"),
                                    "last_login": u.get("last_login"),
                                    "logins_count": u.get("logins_count"),
                                    "email_verified": u.get("email_verified"),
                                    "blocked": u.get("blocked", False)
                                }
                                for u in users
                            ]
                        }
                    }
                elif response.status_code == 401:
                    return {
                        "compliant": False,
                        "reason": "Auth0 access denied (401). Ensure the M2M app has 'read:users' scope granted on the Management API.",
                        "details": {}
                    }
                elif response.status_code == 403:
                    return {
                        "compliant": False,
                        "reason": "Auth0 forbidden (403). Grant 'read:users' permission to the GRC application in Auth0 dashboard → APIs → Machine to Machine Applications.",
                        "details": {}
                    }
                else:
                    return {
                        "compliant": False,
                        "reason": f"Auth0 Management API returned status {response.status_code}: {response.text[:200]}",
                        "details": {}
                    }
        except Exception as e:
            return {
                "compliant": False,
                "reason": f"Auth0 API request failed: {str(e)}",
                "details": {}
            }

    def audit_mfa_enrollment(self) -> dict:
        """Check MFA (Guardian) enrollment status for all users."""
        if not self.domain or not self.client_id or not self.client_secret:
            return {
                "compliant": False,
                "reason": "Auth0 credentials not configured.",
                "details": {}
            }

        token = self._get_access_token()
        if not token:
            return {
                "compliant": False,
                "reason": "Failed to obtain Auth0 Management API access token.",
                "details": {}
            }

        try:
            with httpx.Client(timeout=30.0) as client:
                # First get all users
                users_res = client.get(
                    f"https://{self.domain}/api/v2/users",
                    headers=self._get_headers(),
                    params={"per_page": 100, "fields": "user_id,email,name"}
                )
                if users_res.status_code != 200:
                    return {
                        "compliant": False,
                        "reason": f"Failed to fetch users: {users_res.status_code}. Grant 'read:users' scope.",
                        "details": {}
                    }

                users = users_res.json()
                unenrolled_users = []
                enrolled_count = 0

                for user in users:
                    user_id = user.get("user_id")
                    email = user.get("email", "Unknown")

                    # Check MFA enrollments for each user
                    enrollments_res = client.get(
                        f"https://{self.domain}/api/v2/users/{user_id}/enrollments",
                        headers=self._get_headers()
                    )

                    if enrollments_res.status_code == 200:
                        enrollments = enrollments_res.json()
                        active_enrollments = [e for e in enrollments if e.get("status") == "confirmed"]
                        if len(active_enrollments) > 0:
                            enrolled_count += 1
                        else:
                            unenrolled_users.append(email)
                    else:
                        # If we can't check enrollments, flag the user
                        unenrolled_users.append(f"{email} (enrollment check failed)")

                if len(unenrolled_users) > 0:
                    return {
                        "compliant": False,
                        "reason": f"MFA compliance breach: {len(unenrolled_users)} of {len(users)} users have no active MFA enrollment.",
                        "details": {
                            "total_users": len(users),
                            "mfa_enrolled": enrolled_count,
                            "unenrolled_users": unenrolled_users
                        }
                    }
                return {
                    "compliant": True,
                    "reason": f"All {len(users)} users have active MFA enrollment in Auth0.",
                    "details": {
                        "total_users": len(users),
                        "mfa_enrolled": enrolled_count
                    }
                }
        except Exception as e:
            return {
                "compliant": False,
                "reason": f"Auth0 MFA audit failed: {str(e)}",
                "details": {}
            }

    def get_login_logs(self, limit: int = 50) -> dict:
        """Fetch recent login activity logs from Auth0."""
        if not self.domain or not self.client_id or not self.client_secret:
            return {"logs": [], "error": "Auth0 credentials not configured."}

        token = self._get_access_token()
        if not token:
            return {"logs": [], "error": "Failed to obtain access token."}

        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(
                    f"https://{self.domain}/api/v2/logs",
                    headers=self._get_headers(),
                    params={"per_page": limit, "sort": "date:-1"}
                )
                if response.status_code == 200:
                    logs = response.json()
                    return {
                        "logs": [
                            {
                                "date": log.get("date"),
                                "type": log.get("type"),
                                "description": log.get("description"),
                                "ip": log.get("ip"),
                                "user_name": log.get("user_name"),
                                "connection": log.get("connection")
                            }
                            for log in logs
                        ],
                        "error": None
                    }
                else:
                    return {"logs": [], "error": f"Auth0 logs API returned {response.status_code}. Grant 'read:logs' scope."}
        except Exception as e:
            return {"logs": [], "error": f"Auth0 logs request failed: {str(e)}"}

    def get_roles(self) -> dict:
        """Fetch all roles defined in Auth0."""
        if not self.domain or not self.client_id or not self.client_secret:
            return {"roles": [], "error": "Auth0 credentials not configured."}

        token = self._get_access_token()
        if not token:
            return {"roles": [], "error": "Failed to obtain access token."}

        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(
                    f"https://{self.domain}/api/v2/roles",
                    headers=self._get_headers(),
                    params={"per_page": 50}
                )
                if response.status_code == 200:
                    roles = response.json()
                    return {
                        "roles": [
                            {"id": r.get("id"), "name": r.get("name"), "description": r.get("description")}
                            for r in roles
                        ],
                        "error": None
                    }
                else:
                    return {"roles": [], "error": f"Auth0 roles API returned {response.status_code}. Grant 'read:roles' scope."}
        except Exception as e:
            return {"roles": [], "error": f"Auth0 roles request failed: {str(e)}"}


def _missing(reason: str) -> dict:
    return {"compliant": False, "reason": reason, "details": {}}


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
            creds = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/devstorage.read_only"]
            )
            creds.refresh(Request())
            return creds.token
        except Exception:
            return None

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


class AzureClient:
    """Audits an Azure Storage Account for secure transfer + encryption.

    Credentials: tenant_id, client_id, client_secret (service principal),
    subscription_id, resource_group, account_name.
    """
    def __init__(self, tenant_id=None, client_id=None, client_secret=None,
                 subscription_id=None, resource_group=None, account_name=None):
        self.tenant_id = tenant_id or os.environ.get("AZURE_TENANT_ID")
        self.client_id = client_id or os.environ.get("AZURE_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("AZURE_CLIENT_SECRET")
        self.subscription_id = subscription_id or os.environ.get("AZURE_SUBSCRIPTION_ID")
        self.resource_group = resource_group or os.environ.get("AZURE_RESOURCE_GROUP")
        self.account_name = account_name or os.environ.get("AZURE_STORAGE_ACCOUNT")

    def _token(self) -> Optional[str]:
        if not (self.tenant_id and self.client_id and self.client_secret):
            return None
        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.post(
                    f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token",
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "grant_type": "client_credentials",
                        "scope": "https://management.azure.com/.default",
                    },
                )
                if res.status_code == 200:
                    return res.json().get("access_token")
        except Exception:
            pass
        return None

    def audit_storage_account(self) -> dict:
        if not (self.tenant_id and self.client_id and self.client_secret):
            return _missing("Azure credentials not configured. Provide tenant_id, client_id, client_secret.")
        if not (self.subscription_id and self.resource_group and self.account_name):
            return _missing("Azure target not configured. Provide subscription_id, resource_group, account_name.")
        token = self._token()
        if not token:
            return _missing("Failed to obtain Azure management token. Check the service principal.")
        url = (
            f"https://management.azure.com/subscriptions/{self.subscription_id}"
            f"/resourceGroups/{self.resource_group}/providers/Microsoft.Storage"
            f"/storageAccounts/{self.account_name}?api-version=2023-01-01"
        )
        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.get(url, headers={"Authorization": f"Bearer {token}"})
                if res.status_code != 200:
                    return _missing(f"Azure API returned {res.status_code}: {res.text[:200]}")
                props = res.json().get("properties", {})
                https_only = props.get("supportsHttpsTrafficOnly", False)
                encrypted = bool(props.get("encryption", {}).get("services"))
                compliant = https_only and encrypted
                return {
                    "compliant": compliant,
                    "reason": (
                        f"Azure storage '{self.account_name}' enforces HTTPS-only transfer with encryption at rest."
                        if compliant else
                        f"Azure storage '{self.account_name}' is missing HTTPS-only or encryption settings."
                    ),
                    "details": {"supportsHttpsTrafficOnly": https_only, "encryptionEnabled": encrypted},
                }
        except Exception as e:
            return _missing(f"Azure audit failed: {str(e)}")


class EntraClient:
    """Audits Microsoft Entra ID (Azure AD) users and MFA via Microsoft Graph.

    Credentials: tenant_id, client_id, client_secret with Graph application
    permissions (User.Read.All, UserAuthenticationMethod.Read.All).
    """
    def __init__(self, tenant_id=None, client_id=None, client_secret=None, access_token=None):
        self.tenant_id = tenant_id or os.environ.get("AZURE_TENANT_ID")
        self.client_id = client_id or os.environ.get("AZURE_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("AZURE_CLIENT_SECRET")
        # A user-delegated OAuth access token (preferred when present).
        self.access_token = access_token

    def _token(self) -> Optional[str]:
        if self.access_token:
            return self.access_token
        if not (self.tenant_id and self.client_id and self.client_secret):
            return None
        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.post(
                    f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token",
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "grant_type": "client_credentials",
                        "scope": "https://graph.microsoft.com/.default",
                    },
                )
                if res.status_code == 200:
                    return res.json().get("access_token")
        except Exception:
            pass
        return None

    def audit_mfa_enrollment(self) -> dict:
        if not self.access_token and not (self.tenant_id and self.client_id and self.client_secret):
            return _missing("Entra credentials not configured. Connect via OAuth or provide tenant_id, client_id, client_secret.")
        token = self._token()
        if not token:
            return _missing("Failed to obtain Microsoft Graph token. Check the app registration and permissions.")
        headers = {"Authorization": f"Bearer {token}"}
        try:
            with httpx.Client(timeout=30.0) as client:
                users, url = [], "https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,accountEnabled&$top=100"
                while url:
                    res = client.get(url, headers=headers)
                    if res.status_code != 200:
                        return _missing(f"Graph users call returned {res.status_code}: {res.text[:200]}")
                    body = res.json()
                    users.extend(body.get("value", []))
                    url = body.get("@odata.nextLink")
                unprotected = []
                for u in users:
                    if not u.get("accountEnabled", True):
                        continue
                    m = client.get(
                        f"https://graph.microsoft.com/v1.0/users/{u['id']}/authentication/methods",
                        headers=headers,
                    )
                    if m.status_code == 200:
                        methods = m.json().get("value", [])
                        strong = [x for x in methods if x.get("@odata.type") not in
                                  ("#microsoft.graph.passwordAuthenticationMethod",)]
                        if not strong:
                            unprotected.append(u.get("userPrincipalName"))
                compliant = len(unprotected) == 0
                return {
                    "compliant": compliant,
                    "reason": (
                        f"All {len(users)} Entra users have a strong authentication method registered."
                        if compliant else
                        f"MFA gap: {len(unprotected)} Entra users have only password authentication."
                    ),
                    "details": {"total_users": len(users), "unprotected_users": unprotected[:50]},
                }
        except Exception as e:
            return _missing(f"Entra MFA audit failed: {str(e)}")


class GoogleWorkspaceClient:
    """Audits Google Workspace users and 2-Step Verification via the Admin SDK.

    Credentials: a service-account JSON key with domain-wide delegation and the
    subject (an admin email) to impersonate, plus the customer id (default
    "my_customer").
    """
    def __init__(self, service_account_json=None, admin_email=None, customer="my_customer", access_token=None):
        self.service_account_json = service_account_json or os.environ.get("GOOGLE_WORKSPACE_SA_JSON")
        self.admin_email = admin_email or os.environ.get("GOOGLE_WORKSPACE_ADMIN")
        self.customer = customer or os.environ.get("GOOGLE_WORKSPACE_CUSTOMER", "my_customer")
        # A user-delegated OAuth access token (preferred when present).
        self.access_token = access_token

    def _token(self) -> Optional[str]:
        if self.access_token:
            return self.access_token
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

    def audit_2sv_enrollment(self) -> dict:
        if not self.access_token and not (self.service_account_json and self.admin_email):
            return _missing("Google Workspace not configured. Connect via OAuth or provide service_account_json and admin_email.")
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
                compliant = len(not_enrolled) == 0
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


class CrowdStrikeClient:
    """Audits CrowdStrike Falcon endpoint sensor coverage.

    Credentials: client_id, client_secret, and optional base_url (defaults to the
    US-1 cloud). Uses the OAuth2 client-credentials flow.
    """
    def __init__(self, client_id=None, client_secret=None, base_url=None):
        self.client_id = client_id or os.environ.get("CROWDSTRIKE_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("CROWDSTRIKE_CLIENT_SECRET")
        self.base_url = (base_url or os.environ.get("CROWDSTRIKE_BASE_URL", "https://api.crowdstrike.com")).rstrip("/")

    def _token(self) -> Optional[str]:
        if not (self.client_id and self.client_secret):
            return None
        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.post(
                    f"{self.base_url}/oauth2/token",
                    data={"client_id": self.client_id, "client_secret": self.client_secret},
                )
                if res.status_code in (200, 201):
                    return res.json().get("access_token")
        except Exception:
            pass
        return None

    def audit_sensor_coverage(self) -> dict:
        if not (self.client_id and self.client_secret):
            return _missing("CrowdStrike not configured. Provide client_id and client_secret.")
        token = self._token()
        if not token:
            return _missing("Failed to obtain CrowdStrike token. Check the API client and scopes.")
        headers = {"Authorization": f"Bearer {token}"}
        try:
            with httpx.Client(timeout=20.0) as client:
                total = client.get(f"{self.base_url}/devices/queries/devices/v1",
                                   headers=headers, params={"limit": 1})
                normal = client.get(f"{self.base_url}/devices/queries/devices/v1",
                                    headers=headers,
                                    params={"limit": 1, "filter": "reduced_functionality_mode:'no'"})
                if total.status_code != 200:
                    return _missing(f"CrowdStrike devices call returned {total.status_code}: {total.text[:200]}")
                total_hosts = total.json().get("meta", {}).get("pagination", {}).get("total", 0)
                healthy = normal.json().get("meta", {}).get("pagination", {}).get("total", 0) if normal.status_code == 200 else 0
                compliant = total_hosts > 0 and healthy == total_hosts
                return {
                    "compliant": compliant,
                    "reason": (
                        f"All {total_hosts} Falcon sensors report full functionality."
                        if compliant else
                        f"{total_hosts - healthy} of {total_hosts} Falcon sensors are degraded or in reduced-functionality mode."
                    ),
                    "details": {"total_hosts": total_hosts, "healthy_hosts": healthy},
                }
        except Exception as e:
            return _missing(f"CrowdStrike audit failed: {str(e)}")


class SnykClient:
    """Audits open vulnerability findings across a Snyk organization.

    Credentials: token (API/service-account) and org_id.
    """
    def __init__(self, token=None, org_id=None):
        self.token = token or os.environ.get("SNYK_TOKEN")
        self.org_id = org_id or os.environ.get("SNYK_ORG_ID")

    def audit_vulnerabilities(self) -> dict:
        if not (self.token and self.org_id):
            return _missing("Snyk not configured. Provide token and org_id.")
        headers = {"Authorization": f"token {self.token}", "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.post(
                    f"https://api.snyk.io/v1/org/{self.org_id}/issues",
                    headers=headers,
                    json={"filters": {"severities": ["critical", "high"], "types": ["vuln"], "ignored": False}},
                )
                if res.status_code != 200:
                    return _missing(f"Snyk issues call returned {res.status_code}: {res.text[:200]}")
                issues = res.json().get("issues", {})
                vulns = issues.get("vulnerabilities", issues) if isinstance(issues, dict) else issues
                count = len(vulns) if isinstance(vulns, list) else 0
                compliant = count == 0
                return {
                    "compliant": compliant,
                    "reason": (
                        "No open critical/high vulnerabilities across monitored Snyk projects."
                        if compliant else
                        f"{count} open critical/high vulnerabilities found across monitored Snyk projects."
                    ),
                    "details": {"open_critical_high": count},
                }
        except Exception as e:
            return _missing(f"Snyk audit failed: {str(e)}")


class JamfClient:
    """Audits Jamf Pro managed computers and FileVault disk encryption.

    Credentials: base_url (e.g. https://yourorg.jamfcloud.com), client_id and
    client_secret for an API role/client (OAuth2), or username/password.
    """
    def __init__(self, base_url=None, client_id=None, client_secret=None, username=None, password=None):
        self.base_url = (base_url or os.environ.get("JAMF_BASE_URL", "")).rstrip("/")
        self.client_id = client_id or os.environ.get("JAMF_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("JAMF_CLIENT_SECRET")
        self.username = username or os.environ.get("JAMF_USERNAME")
        self.password = password or os.environ.get("JAMF_PASSWORD")

    def _token(self, client: httpx.Client) -> Optional[str]:
        try:
            if self.client_id and self.client_secret:
                res = client.post(
                    f"{self.base_url}/api/oauth/token",
                    data={"client_id": self.client_id, "client_secret": self.client_secret,
                          "grant_type": "client_credentials"},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                if res.status_code == 200:
                    return res.json().get("access_token")
            if self.username and self.password:
                res = client.post(f"{self.base_url}/api/v1/auth/token",
                                  auth=(self.username, self.password))
                if res.status_code == 200:
                    return res.json().get("token")
        except Exception:
            pass
        return None

    def audit_disk_encryption(self) -> dict:
        if not self.base_url or not ((self.client_id and self.client_secret) or (self.username and self.password)):
            return _missing("Jamf not configured. Provide base_url plus client_id/client_secret (or username/password).")
        try:
            with httpx.Client(timeout=20.0) as client:
                token = self._token(client)
                if not token:
                    return _missing("Failed to obtain Jamf token. Check the API client/role or credentials.")
                headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
                res = client.get(f"{self.base_url}/api/v1/computers-inventory",
                                 headers=headers,
                                 params={"section": "DISK_ENCRYPTION", "page-size": 200})
                if res.status_code != 200:
                    return _missing(f"Jamf inventory call returned {res.status_code}: {res.text[:200]}")
                results = res.json().get("results", [])
                unencrypted = []
                for c in results:
                    de = c.get("diskEncryption", {})
                    state = (de.get("bootPartitionEncryptionDetails", {}) or {}).get("partitionFileVault2State")
                    if state and state != "ENCRYPTED":
                        unencrypted.append(c.get("general", {}).get("name", c.get("id")))
                compliant = len(unencrypted) == 0 and len(results) > 0
                return {
                    "compliant": compliant,
                    "reason": (
                        f"All {len(results)} managed Macs report FileVault disk encryption."
                        if compliant else
                        f"{len(unencrypted)} of {len(results)} managed Macs are missing FileVault encryption."
                    ),
                    "details": {"total": len(results), "unencrypted": unencrypted[:50]},
                }
        except Exception as e:
            return _missing(f"Jamf audit failed: {str(e)}")


class WorkdayClient:
    """Fetches the active worker roster from Workday via a RaaS report URL.

    Credentials: report_url (a JSON RaaS endpoint) plus username/password
    (Integration System User with basic auth).
    """
    def __init__(self, report_url=None, username=None, password=None):
        self.report_url = report_url or os.environ.get("WORKDAY_REPORT_URL")
        self.username = username or os.environ.get("WORKDAY_USERNAME")
        self.password = password or os.environ.get("WORKDAY_PASSWORD")

    def audit_worker_roster(self) -> dict:
        if not (self.report_url and self.username and self.password):
            return _missing("Workday not configured. Provide report_url, username, password.")
        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.get(self.report_url, auth=(self.username, self.password),
                                 params={"format": "json"})
                if res.status_code != 200:
                    return _missing(f"Workday report returned {res.status_code}: {res.text[:200]}")
                data = res.json()
                rows = data.get("Report_Entry", data if isinstance(data, list) else [])
                count = len(rows) if isinstance(rows, list) else 0
                return {
                    "compliant": count > 0,
                    "reason": f"Workday roster synced: {count} worker records retrieved.",
                    "details": {"worker_count": count},
                }
        except Exception as e:
            return _missing(f"Workday audit failed: {str(e)}")
