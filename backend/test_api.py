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
    print("SUCCESS: Unencrypted Scan endpoint verified.")
    print()

def test_scan_encrypted_byok():
    print("Testing /api/scan endpoint with BYOK Encryption & Decryption...")
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
    assert data["metrics"]["controls"] >= 1
    print("SUCCESS: RAG corpus and analysis endpoints verified.")
    print()

def test_tpm_attestation_flow():
    print("Testing TPM Challenge-Response flow...")
    # Get challenge
    response_challenge = client.get("/api/attest/challenge")
    assert response_challenge.status_code == 200
    challenge = response_challenge.json()
    nonce = challenge["nonce"]
    print(f"Retrieved Challenge Nonce: {nonce}")

    # Generate a quote (simulated)
    # Using SHA256 simulation matching our security.py logic
    import hashlib
    pcr_concat = "a8f3b2c1d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2" + \
                 "b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4" + \
                 "f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6"
    
    pcr_digest_input = pcr_concat + nonce
    expected_digest = hashlib.sha256(pcr_digest_input.encode('utf-8')).hexdigest()
    
    signature_input = expected_digest + "attestation_key_secret"
    expected_sig = hashlib.sha256(signature_input.encode('utf-8')).hexdigest()

    tpm_quote = {
        "quote_format": "TPM2_QUOTE",
        "timestamp": 1234567,
        "nonce": nonce,
        "pcrs": {
            "PCR0": "a8f3b2c1d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2",
            "PCR4": "b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4",
            "PCR8": "f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6"
        },
        "pcr_digest": expected_digest,
        "attestation_key_pub": "MIIBIjANBgkqhkiG9w0BAQEFA...",
        "signature": expected_sig
    }

    # Verify quote
    verify_payload = {
        "nonce": nonce,
        "quote": tpm_quote
    }
    response_verify = client.post("/api/attest/verify", json=verify_payload)
    assert response_verify.status_code == 200
    verify_data = response_verify.json()
    assert verify_data["verified"] is True
    print("SUCCESS: TPM Challenge-Response verification verified.")
    print()

if __name__ == "__main__":
    print("=== Running Backend API Integration Tests ===")
    test_health()
    test_scan_unencrypted()
    test_scan_encrypted_byok()
    test_rag_corpus_and_analysis()
    test_tpm_attestation_flow()
    print("ALL API INTEGRATION TESTS PASSED SUCCESSFULLY!")
