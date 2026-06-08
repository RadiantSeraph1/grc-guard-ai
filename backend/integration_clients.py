import os
import httpx
from typing import Dict, Any, Optional

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

    def audit_branch_protection(self, owner: str, repo: str, branch: str = "main") -> dict:
        """Query GitHub API to verify branch protection rules are active."""
        if not self.token:
            return {
                "compliant": False,
                "reason": "GitHub API token not configured. Please supply GITHUB_TOKEN in Settings.",
                "details": {}
            }
            
        url = f"https://api.github.com/repos/{owner}/{repo}/branches/{branch}/protection"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
        
        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.get(url, headers=headers)
                if response.status_code == 200:
                    data = response.json()
                    required_reviews = data.get("required_pull_request_reviews", {})
                    min_approvals = required_reviews.get("required_approving_review_count", 0)
                    
                    return {
                        "compliant": True,
                        "reason": f"Branch protections active. Pull request reviews required (Min reviews: {min_approvals}).",
                        "details": data
                    }
                elif response.status_code == 404:
                    return {
                        "compliant": False,
                        "reason": f"Branch protection is disabled, or repository branch '{branch}' was not found.",
                        "details": {}
                    }
                else:
                    return {
                        "compliant": False,
                        "reason": f"GitHub returned status code: {response.status_code}",
                        "details": response.json()
                    }
        except Exception as e:
            return {
                "compliant": False,
                "reason": f"GitHub API request failed: {str(e)}",
                "details": {}
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
