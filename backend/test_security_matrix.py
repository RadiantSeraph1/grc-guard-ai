"""RBAC matrix + connector client tests.

RBAC: proves each mock role can/can't reach representative endpoints — the
fail-closed behavior the security review demanded, as a regression test.
Connectors: every client refuses cleanly without credentials, and the
GitHub client (representative HTTP path) is exercised against mocked httpx.
"""
import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("CLERK_MOCK_AUTH", "true")
os.environ.setdefault("BYOK_SECRET_KEY", "local-test-vault-key")

from fastapi.testclient import TestClient
from main import app
import integration_clients as ic

client = TestClient(app)

def _h(token):
    return {"Authorization": f"Bearer {token}"}

ADMIN = _h("mock-admin-token")
EDITOR = _h("mock-editor-token")
AUDITOR = _h("mock-auditor-token")
EMPLOYEE = _h("mock-employee-token")


def test_rbac_matrix():
    # (headers, endpoint, method, allowed) — representative routes per privilege tier.
    scan = {"json": {"text": "MFA is disabled for administrator accounts.", "perspective": "Standard", "byok_key": None}}
    cases = [
        # Admin-only: AI provider settings
        (ADMIN,    "get",  "/api/settings/ai-providers", {},   True),
        (EDITOR,   "get",  "/api/settings/ai-providers", {},   False),
        (AUDITOR,  "get",  "/api/settings/ai-providers", {},   False),
        (EMPLOYEE, "get",  "/api/settings/ai-providers", {},   False),
        # Scan: Admin/Editor/Auditor yes, Employee no
        (EDITOR,   "post", "/api/scan",                  scan, True),
        (AUDITOR,  "post", "/api/scan",                  scan, True),
        (EMPLOYEE, "post", "/api/scan",                  scan, False),
        # Super-admin console: nobody below SuperAdmin
        (ADMIN,    "get",  "/api/super-admin/overview",  {},   False),
        (EDITOR,   "get",  "/api/super-admin/overview",  {},   False),
        # Read dashboards: Viewer-tier and up; Employee is NOT Viewer.
        (EMPLOYEE, "get",  "/api/dashboard/stats",       {},   False),
        (AUDITOR,  "get",  "/api/dashboard/stats",       {},   True),
    ]
    for headers, method, path, kwargs, allowed in cases:
        res = getattr(client, method)(path, headers=headers, **kwargs)
        if allowed:
            assert res.status_code == 200, f"{method} {path} expected 200, got {res.status_code}"
        else:
            assert res.status_code == 403, f"{method} {path} expected 403, got {res.status_code}"
    print("SUCCESS: RBAC matrix enforced.")


def test_unauthenticated_rejected():
    assert client.get("/api/dashboard/stats").status_code == 401
    assert client.get("/api/controls").status_code == 401
    print("SUCCESS: unauthenticated requests rejected.")


def test_connectors_refuse_without_credentials():
    # Every client must return a clean non-compliant result (not raise) when
    # unconfigured. Clear env so ambient credentials can't leak in.
    for var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN",
                "OKTA_ORG_URL", "OKTA_API_TOKEN", "AUTH0_DOMAIN", "AUTH0_CLIENT_ID",
                "AUTH0_CLIENT_SECRET", "GCP_SERVICE_ACCOUNT_JSON", "AZURE_TENANT_ID",
                "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "GOOGLE_WORKSPACE_SA_JSON",
                "GOOGLE_WORKSPACE_ADMIN", "CROWDSTRIKE_CLIENT_ID", "CROWDSTRIKE_CLIENT_SECRET",
                "SNYK_TOKEN", "SNYK_ORG_ID", "JAMF_BASE_URL", "WORKDAY_REPORT_URL"):
        os.environ.pop(var, None)
    audits = [
        ic.AWSClient(access_key=None, secret_key=None).audit_s3_encryption("bucket"),
        ic.GitHubClient(token=None).audit_branch_protection("o", "r"),
        ic.OktaClient(org_url=None, token=None).audit_mfa_enrollment(),
        ic.Auth0Client(domain=None).audit_users(),
        ic.GCPClient(service_account_json=None).audit_bucket_encryption("bucket"),
        ic.AzureClient().audit_storage_account(),
        ic.EntraClient().audit_mfa_enrollment(),
        ic.GoogleWorkspaceClient().audit_2sv_enrollment(),
        ic.CrowdStrikeClient().audit_sensor_coverage(),
        ic.SnykClient().audit_vulnerabilities(),
        ic.JamfClient().audit_disk_encryption(),
        ic.WorkdayClient().audit_worker_roster(),
    ]
    for result in audits:
        assert result["compliant"] is False
        assert "reason" in result and result["reason"]
    print(f"SUCCESS: all {len(audits)} connectors refuse cleanly without credentials.")


class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeHttpClient:
    """Minimal httpx.Client stand-in: returns a canned response per URL substring."""
    def __init__(self, routes):
        self.routes = routes

    def __enter__(self): return self
    def __exit__(self, *a): return False

    def get(self, url, **kw):
        for frag, resp in self.routes.items():
            if frag in url:
                return resp
        return _FakeResponse(404, {})

    def post(self, url, **kw):
        return self.get(url, **kw)


def test_github_branch_protection_paths(monkeypatch):
    protected = _FakeResponse(200, {"required_pull_request_reviews": {"required_approving_review_count": 2}})
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({"/protection": protected}))
    ok = ic.GitHubClient(token="t").audit_branch_protection("org", "repo")
    assert ok["compliant"] is True and "Min reviews: 2" in ok["reason"]

    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({}))  # everything 404s
    missing = ic.GitHubClient(token="t").audit_branch_protection("org", "repo")
    assert missing["compliant"] is False
    print("SUCCESS: GitHub connector compliant/non-compliant paths verified.")


def test_sync_registry_covers_catalog():
    """Every cataloged connector has a sync handler and a credential field spec."""
    ids = {e["id"] for e in ic.INTEGRATION_CATALOG}
    assert ids == set(ic.SYNC_HANDLERS), "catalog and SYNC_HANDLERS diverged"
    assert ids == set(ic.CONNECTOR_FIELDS), "catalog and CONNECTOR_FIELDS diverged"
    # Handlers refuse cleanly on empty credentials (no raise, no green check).
    for cid, handler in ic.SYNC_HANDLERS.items():
        result = handler({})
        assert result["compliant"] is False, f"{cid} handler passed with no creds"
    print(f"SUCCESS: {len(ids)} connectors registered with fields + refusing handlers.")


def test_github_posture_disambiguates_404(monkeypatch):
    """Repo-404 (not found / bad token) and protection-404 (protection off) must
    produce different verdicts and reasons."""
    repo_ok = _FakeResponse(200, {"private": False, "security_and_analysis": {"secret_scanning": {"status": "enabled"}}})
    prot_ok = _FakeResponse(200, {"required_pull_request_reviews": {"required_approving_review_count": 2}})
    alerts_on = _FakeResponse(204, {})

    # Fully hardened repo -> compliant
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({
        "/protection": prot_ok, "/vulnerability-alerts": alerts_on, "/repos/org/repo": repo_ok}))
    ok = ic.GitHubClient(token="t").audit_repo_posture("org", "repo")
    assert ok["compliant"] is True and ok["details"]["min_reviews"] == 2

    # Repo itself 404s -> explicit "not found or token lacks access"
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({}))
    gone = ic.GitHubClient(token="t").audit_repo_posture("org", "repo")
    assert gone["compliant"] is False and "not found or the token lacks access" in gone["reason"]

    # Repo reachable but protection/alerts off -> "OFF" wording, not "not found".
    # (Specific fragments first: the fake router matches substrings in order.)
    off_404 = _FakeResponse(404, {})
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({
        "/protection": off_404, "/vulnerability-alerts": off_404, "/repos/org/repo": repo_ok}))
    off = ic.GitHubClient(token="t").audit_repo_posture("org", "repo")
    assert off["compliant"] is False and "branch protection on 'main': OFF" in off["reason"]
    print("SUCCESS: GitHub posture audit disambiguates 404s and grades hardening.")


def test_posture_summary_is_all_or_nothing():
    """The shared posture aggregator (AWS account, GitHub repo) is compliant only
    when every check passes, and reports the count either way."""
    s = ic._summarize_posture
    ok = s("AWS account", [("mfa", True, ""), ("trail", True, "")])
    assert ok["compliant"] and ok["details"]["passed"] == 2 and "2/2" in ok["reason"]
    bad = s("AWS account", [("mfa", True, ""), ("sg", False, "port 22 open")])
    assert bad["compliant"] is False and "1/2" in bad["reason"] and "port 22 open" in bad["reason"]
    assert s("AWS account", [])["compliant"] is False  # nothing audited != compliant
    print("SUCCESS: posture aggregation is all-or-nothing.")


def test_oauth_registry_gates_on_configured_credentials(monkeypatch):
    """OAuth is offered only for providers whose client id+secret are set; the
    authorize URL and fields payload reflect that."""
    import main
    # No creds -> not offered, authorize 400s.
    monkeypatch.setenv("GITHUB_CLIENT_ID", "")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "")
    assert "github" not in main.oauth_supported_ids()
    spec = client.get("/api/integrations/fields", headers=ADMIN).json()
    assert "fields" in spec and "oauth" in spec and "github" not in spec["oauth"]
    assert client.get("/api/integrations/github/authorize", headers=ADMIN).status_code == 400

    # Both set -> offered, authorize returns a real vendor URL with our redirect.
    monkeypatch.setenv("GITHUB_CLIENT_ID", "Iv1.test")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "secret")
    assert "github" in main.oauth_supported_ids()
    res = client.get("/api/integrations/github/authorize", headers=ADMIN).json()
    assert res["authorize_url"].startswith("https://github.com/login/oauth/authorize?")
    assert "client_id=Iv1.test" in res["authorize_url"]
    assert "%2Fapi%2Fintegrations%2Fgithub%2Fcallback" in res["authorize_url"]
    print("SUCCESS: OAuth registry gates on configured credentials.")


def test_github_token_only_audits_accessible_repos(monkeypatch):
    """OAuth stores only a token; sync must audit the token's visible repos
    instead of erroring with 'owner/repo not configured'."""
    repos = _FakeResponse(200, [
        {"owner": {"login": "me"}, "name": "app", "default_branch": "main"},
    ])
    repo_ok = _FakeResponse(200, {"private": False, "security_and_analysis": {}})
    prot_ok = _FakeResponse(200, {"required_pull_request_reviews": {"required_approving_review_count": 1}})
    alerts_on = _FakeResponse(204, {})
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({
        "/user/repos": repos, "/protection": prot_ok,
        "/vulnerability-alerts": alerts_on, "/repos/me/app": repo_ok}))
    out = ic._sync_github({"token": "t"})
    assert out["compliant"] is True and out["details"]["audited"] == 1

    # Token that can see nothing -> non-compliant, not a green check.
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({
        "/user/repos": _FakeResponse(200, [])}))
    empty = ic._sync_github({"token": "t"})
    assert empty["compliant"] is False and "0 repositories" in empty["reason"]
    print("SUCCESS: token-only GitHub sync audits accessible repos.")


def test_empty_directory_is_not_compliant(monkeypatch):
    """Vacuous-truth guard: an identity provider returning 0 users must NOT
    produce a green MFA/2SV check (found via live Auth0 test on an empty tenant)."""
    empty_users = _FakeResponse(200, [])
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({"/api/v1/users": empty_users}))
    okta = ic.OktaClient(org_url="https://x.okta.com", token="t").audit_mfa_enrollment()
    assert okta["compliant"] is False and "0 users" in okta["reason"]

    monkeypatch.setattr(ic.Auth0Client, "_get_access_token", lambda self: "t")
    monkeypatch.setattr(ic.httpx, "Client", lambda **kw: _FakeHttpClient({"/api/v2/users": empty_users}))
    auth0 = ic.Auth0Client(domain="x.auth0.com", client_id="i", client_secret="s").audit_mfa_enrollment()
    assert auth0["compliant"] is False and "0 users" in auth0["reason"]
    print("SUCCESS: empty identity directories do not read as compliant.")


def test_sync_flips_mapped_controls():
    """The thesis mechanism: a connector result flips imported framework controls."""
    import database, models, framework_library
    db = database.SessionLocal()
    org = "bank_enterprise"
    try:
        framework_library.import_framework(db, org, "soc-2")
        # Use a connector that maps to at least one imported control.
        target = next((cid for cid, codes in framework_library._CONNECTOR_TO_CODES.items()
                       if db.query(models.Control).filter(
                           models.Control.org_id == org,
                           models.Control.control_code.in_(codes)).count() > 0), None)
        assert target, "no connector maps to any imported soc-2 control"

        failed = framework_library.apply_connector_result(db, org, target, compliant=False)
        assert failed, "sync result flipped no controls"
        code = failed[0]
        ctrl = db.query(models.Control).filter_by(org_id=org, control_code=code).first()
        assert ctrl.status == "Failing"

        passed = framework_library.apply_connector_result(db, org, target, compliant=True)
        assert code in passed
        db.refresh(ctrl)
        assert ctrl.status == "Passing"
        print(f"SUCCESS: connector '{target}' flips {len(failed)} mapped controls.")
    finally:
        try:
            framework_library.remove_framework(db, org, "soc-2")
        except Exception:
            db.rollback()
        db.close()


if __name__ == "__main__":
    test_rbac_matrix()
    test_unauthenticated_rejected()
    test_connectors_refuse_without_credentials()
    test_sync_flips_mapped_controls()
    print("ALL SECURITY MATRIX TESTS PASSED!")
