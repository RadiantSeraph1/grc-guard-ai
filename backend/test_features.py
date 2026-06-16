"""Coverage for the newer GRC features: frameworks, drift detection,
remediation tasks, the AI gateway's embedding layer, and AI fallback safety.

Uses the same mock-auth TestClient pattern as test_api.py. Tests clean up the
data they create so the org stays empty-by-default.
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("CLERK_MOCK_AUTH", "true")
os.environ.setdefault("BYOK_SECRET_KEY", "local-test-vault-key")

from fastapi.testclient import TestClient

from main import app
import database
import models
import framework_library
import ai_gateway
import ai_agents
import rag

client = TestClient(app)
AUTH = {"Authorization": "Bearer mock-admin-token"}
ORG = "bank_enterprise"


# ---------------------------------------------------------------------------
# Frameworks
# ---------------------------------------------------------------------------

def test_framework_import_list_and_remove():
    # Library lists the catalog
    lib = client.get("/api/frameworks/library", headers=AUTH)
    assert lib.status_code == 200
    ids = {f["id"] for f in lib.json()}
    assert {"soc-2", "iso-27001", "gdpr"}.issubset(ids)

    # Import SOC 2 -> controls materialise
    imp = client.post("/api/frameworks/import", json={"framework_id": "soc-2"}, headers=AUTH)
    assert imp.status_code == 200
    assert imp.json()["controls_created"] > 0

    # It now shows as imported with controls
    frameworks = client.get("/api/frameworks", headers=AUTH).json()
    soc2 = next((f for f in frameworks if f["id"] == "soc-2"), None)
    assert soc2 is not None
    assert soc2["controls_count"] > 0

    lib2 = {f["id"]: f for f in client.get("/api/frameworks/library", headers=AUTH).json()}
    assert lib2["soc-2"]["imported"] is True

    # Re-import is idempotent (no duplicate controls created)
    imp2 = client.post("/api/frameworks/import", json={"framework_id": "soc-2"}, headers=AUTH)
    assert imp2.status_code == 200
    assert imp2.json()["controls_created"] == 0

    # Unknown framework -> 400
    bad = client.post("/api/frameworks/import", json={"framework_id": "nope"}, headers=AUTH)
    assert bad.status_code == 400

    # Cleanup
    rm = client.delete("/api/frameworks/soc-2", headers=AUTH)
    assert rm.status_code == 200
    print("SUCCESS: framework import/list/remove verified.")


def test_shared_control_reuse_across_frameworks():
    """A control shared by two frameworks is created once and tagged with both."""
    client.post("/api/frameworks/import", json={"framework_id": "soc-2"}, headers=AUTH)
    client.post("/api/frameworks/import", json={"framework_id": "iso-27001"}, headers=AUTH)
    db = database.SessionLocal()
    try:
        mfa = db.query(models.Control).filter_by(org_id=ORG, control_code="SOC2-MFA-01").all()
        assert len(mfa) == 1, "Shared MFA control should exist exactly once."
        tags = mfa[0].frameworks
        assert "soc-2" in tags and "iso-27001" in tags
    finally:
        db.close()
    # Cleanup
    client.delete("/api/frameworks/soc-2", headers=AUTH)
    client.delete("/api/frameworks/iso-27001", headers=AUTH)
    print("SUCCESS: shared control reuse verified.")


# ---------------------------------------------------------------------------
# Drift detection (connector -> control bridge)
# ---------------------------------------------------------------------------

def test_drift_detection_records_regression():
    client.post("/api/frameworks/import", json={"framework_id": "gdpr"}, headers=AUTH)
    db = database.SessionLocal()
    try:
        ctrl = db.query(models.Control).filter_by(org_id=ORG, control_code="GDPR-PII-01").first()
        assert ctrl is not None
        ctrl.status = "Passing"
        db.commit()
        # A failing AWS sync result should flip the control and log drift.
        updated = framework_library.apply_connector_result(db, ORG, "aws", compliant=False, source="sync")
        assert "GDPR-PII-01" in updated
    finally:
        db.close()

    drift = client.get("/api/drift?only_drift=true", headers=AUTH)
    assert drift.status_code == 200
    events = drift.json()
    match = next((e for e in events if e["control_code"] == "GDPR-PII-01"), None)
    assert match is not None
    assert match["old_status"] == "Passing" and match["new_status"] == "Failing"
    assert match["is_drift"] is True

    # Acknowledge it
    ack = client.post(f"/api/drift/{match['id']}/acknowledge", headers=AUTH)
    assert ack.status_code == 200

    # Cleanup events + framework
    db = database.SessionLocal()
    try:
        db.query(models.ControlStatusEvent).filter_by(org_id=ORG).delete()
        db.commit()
    finally:
        db.close()
    client.delete("/api/frameworks/gdpr", headers=AUTH)
    print("SUCCESS: drift detection verified.")


# ---------------------------------------------------------------------------
# Remediation tasks
# ---------------------------------------------------------------------------

def test_remediation_task_lifecycle():
    # Create directly
    created = client.post("/api/tasks", json={"title": "Test task", "priority": "High"}, headers=AUTH)
    assert created.status_code == 200
    tid = created.json()["id"]
    assert created.json()["status"] == "Open"

    # List shows it
    listed = client.get("/api/tasks", headers=AUTH).json()
    assert any(t["id"] == tid for t in listed)

    # Update status
    upd = client.patch(f"/api/tasks/{tid}", json={"status": "Done"}, headers=AUTH)
    assert upd.status_code == 200
    assert upd.json()["status"] == "Done"

    # Delete
    dele = client.delete(f"/api/tasks/{tid}", headers=AUTH)
    assert dele.status_code == 200
    assert all(t["id"] != tid for t in client.get("/api/tasks", headers=AUTH).json())
    print("SUCCESS: remediation task lifecycle verified.")


def test_task_from_control():
    client.post("/api/frameworks/import", json={"framework_id": "soc-2"}, headers=AUTH)
    res = client.post("/api/tasks/from-control/SOC2-MFA-01", headers=AUTH)
    assert res.status_code == 200
    task = res.json()
    assert task["control_code"] == "SOC2-MFA-01"
    assert "Remediate" in task["title"]
    # Unknown control -> 404
    assert client.post("/api/tasks/from-control/NOPE-99", headers=AUTH).status_code == 404
    # Cleanup
    client.delete(f"/api/tasks/{task['id']}", headers=AUTH)
    client.delete("/api/frameworks/soc-2", headers=AUTH)
    print("SUCCESS: task-from-control verified.")


# ---------------------------------------------------------------------------
# AI gateway: embeddings + vector math + provider env-key handling
# ---------------------------------------------------------------------------

def test_embedding_vector_math():
    # Pack/unpack roundtrip preserves values (float32 tolerance)
    vec = [0.1, -0.5, 0.9, 0.0, 1.0]
    blob = rag._pack_embedding(vec)
    out = rag._unpack_embedding(blob)
    assert out is not None and len(out) == len(vec)
    assert all(abs(a - b) < 1e-6 for a, b in zip(vec, out))

    # Cosine: identical -> 1, orthogonal -> 0, empty -> 0
    assert abs(rag._cosine([1, 0], [1, 0]) - 1.0) < 1e-6
    assert abs(rag._cosine([1, 0], [0, 1]) - 0.0) < 1e-6
    assert rag._cosine([], [1, 2]) == 0.0
    print("SUCCESS: embedding vector math verified.")


def test_embed_texts_failsafe():
    # Empty input returns empty list, never raises
    assert ai_gateway.embed_texts([]) == []
    # With no embedding provider configured, returns None (caller falls back)
    if ai_gateway.get_embedding_config() is None:
        assert ai_gateway.embed_texts(["hello"]) is None
    print("SUCCESS: embed_texts fail-safe verified.")


def test_ai_providers_reports_keys():
    res = client.get("/api/settings/ai-providers", headers=AUTH)
    assert res.status_code == 200
    providers = {p["id"]: p for p in res.json()}
    # local engines never need a key -> always usable
    assert providers["local_evidence"]["has_key"] is True
    # has_key reflects env OR db; mirrors gateway resolution for groq
    groq_env = bool(ai_gateway.get_env_provider_key("groq"))
    if groq_env:
        assert providers["groq"]["has_key"] is True
    print("SUCCESS: provider key reporting verified.")


# ---------------------------------------------------------------------------
# AI agents: fallback never raises and never returns a tool-error string
# ---------------------------------------------------------------------------

def test_agent_detailed_is_resilient():
    out = ai_agents.run_agent_detailed("compliance-agent", "Say OK.", ORG)
    assert isinstance(out, dict)
    assert "content" in out and "steps" in out
    assert out["content"]  # non-empty
    # Must not surface a raw tool-calling failure as the answer
    assert not ai_agents._is_failure_content(out["content"])
    print("SUCCESS: agent detailed run is resilient.")


def test_failure_content_detection():
    assert ai_agents._is_failure_content("") is True
    assert ai_agents._is_failure_content("Failed to call a function. See failed_generation.") is True
    assert ai_agents._is_failure_content("MFA requires two factors.") is False
    print("SUCCESS: failure-content detection verified.")


if __name__ == "__main__":
    test_framework_import_list_and_remove()
    test_shared_control_reuse_across_frameworks()
    test_drift_detection_records_regression()
    test_remediation_task_lifecycle()
    test_task_from_control()
    test_embedding_vector_math()
    test_embed_texts_failsafe()
    test_ai_providers_reports_keys()
    test_agent_detailed_is_resilient()
    test_failure_content_detection()
    print("ALL FEATURE TESTS PASSED")
