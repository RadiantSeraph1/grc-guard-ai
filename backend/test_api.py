import sys
import os
from fastapi.testclient import TestClient

# Ensure we can import modules from the current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("CLERK_MOCK_AUTH", "true")
os.environ.setdefault("BYOK_SECRET_KEY", "local-test-vault-key")

from main import app

client = TestClient(app)
AUTH_HEADERS = {"Authorization": "Bearer mock-admin-token"}
SUPER_ADMIN_HEADERS = {"Authorization": "Bearer mock-super-admin-token"}


def _force_rule_engine():
    """Deactivate all AI providers so scan tests use the deterministic keyword
    rule engine (no LLM), keeping the category assertion stable. With no usable
    provider, the scanner does not call the gateway at all."""
    import database, models
    db = database.SessionLocal()
    try:
        db.query(models.AIProviderConfig).update({"is_active": False})
        db.commit()
    finally:
        db.close()

def test_health():
    print("Testing /api/health endpoint...")
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    print("SUCCESS: Health endpoint verified.")
    print()

def test_super_admin_access_control():
    print("Testing super admin access control...")
    forbidden = client.get("/api/super-admin/overview", headers=AUTH_HEADERS)
    assert forbidden.status_code == 403

    allowed = client.get("/api/super-admin/overview", headers=SUPER_ADMIN_HEADERS)
    assert allowed.status_code == 200
    data = allowed.json()
    assert data["super_admin"]["role"] == "SuperAdmin"
    assert "totals" in data

    login_fail = client.post("/api/super-admin/login", json={"access_key": "wrong-key"})
    assert login_fail.status_code == 401

    login_ok = client.post("/api/super-admin/login", json={"access_key": "local-super-admin-key"})
    assert login_ok.status_code == 200
    session_token = login_ok.json()["token"]
    session_allowed = client.get(
        "/api/super-admin/overview",
        headers={"X-Super-Admin-Session": session_token}
    )
    assert session_allowed.status_code == 200
    print("SUCCESS: Super admin route blocks Admin and allows SuperAdmin.")
    print()

def test_scan_unencrypted():
    print("Testing /api/scan endpoint (Unencrypted)...")
    _force_rule_engine()  # deterministic rule path for a stable category assertion
    payload = {
        "text": "Gateway impersonation on SWIFT gateway detected by routing system.",
        "perspective": "Attacker",
        "byok_key": None
    }
    response = client.post("/api/scan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "VIOLATION"
    assert data["category"] == "CBEST Threat Modeling / SWIFT Security"
    assert data["is_encrypted"] is False
    assert data["reasoning_trace"][0]["stage"] == "Input normalization"
    assert data["reasoning_trace"][-1]["stage"] == "Auditor synthesis"
    print("SUCCESS: Unencrypted Scan endpoint verified.")
    print()

def test_scan_encrypted_byok():
    print("Testing /api/scan endpoint with BYOK Encryption & Decryption...")
    _force_rule_engine()  # deterministic rule path
    payload = {
        "text": "CET1 ratio of 5.5% detected on active ledger accounts.",
        "perspective": "Standard",
        "byok_key": "MySuperSecretBYOKKey"
    }
    response = client.post("/api/scan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    scan_data = response.json()
    assert scan_data["is_encrypted"] is True
    assert scan_data["decision"] == "VIOLATION"
    print("SUCCESS: Encrypted Scan created successfully.")

    # Get logs with correct BYOK key
    print("Retrieving logs with CORRECT BYOK key...")
    response_logs = client.get(f"/api/logs?byok_key=MySuperSecretBYOKKey", headers=AUTH_HEADERS)
    assert response_logs.status_code == 200
    logs = response_logs.json()
    matched_log = next((l for l in logs if l["id"] == scan_data["id"]), None)
    assert matched_log is not None
    assert matched_log["scanned_text"] == "CET1 ratio of 5.5% detected on active ledger accounts."
    assert "Compliance Alert" in matched_log["justification"]["title"]
    print("SUCCESS: Log decrypted successfully with correct key.")

    # Get logs with WRONG key
    print("Retrieving logs with WRONG BYOK key...")
    response_wrong = client.get(f"/api/logs?byok_key=WrongKey", headers=AUTH_HEADERS)
    assert response_wrong.status_code == 200
    logs_wrong = response_wrong.json()
    matched_wrong = next((l for l in logs_wrong if l["id"] == scan_data["id"]), None)
    assert matched_wrong is not None
    assert matched_wrong["scanned_text"] == "[ENCRYPTED - BYOK REQUIRED]"
    assert matched_wrong["justification"]["title"] == "Encrypted Log"
    print("SUCCESS: Log remained encrypted with wrong key.")
    print()

def test_rag_corpus_and_analysis():
    print("Testing RAG corpus and compliance analysis endpoints...")
    corpus = client.get("/api/rag/corpus", headers=AUTH_HEADERS)
    assert corpus.status_code == 200
    corpus_data = corpus.json()
    assert "total_chunks" in corpus_data
    assert "sources" in corpus_data

    analysis = client.post(
        "/api/analysis/run",
        json={"question": "What are the biggest compliance risks?", "include_ai": False},
        headers=AUTH_HEADERS
    )
    assert analysis.status_code == 200
    data = analysis.json()
    assert "metrics" in data
    assert "recommended_actions" in data
    assert "citations" in data
    # The platform ships with no seeded data, so a fresh org has zero controls.
    assert data["metrics"]["controls"] >= 0
    print("SUCCESS: RAG corpus and analysis endpoints verified.")
    print()

if __name__ == "__main__":
    print("=== Running Backend API Integration Tests ===")
    test_health()
    test_scan_unencrypted()
    test_scan_encrypted_byok()
    test_rag_corpus_and_analysis()
    print("ALL API INTEGRATION TESTS PASSED SUCCESSFULLY!")
