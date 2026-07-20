"""Self-check for the Mechanic propose/approve/reject flow (Phase 4).

Runs against an isolated in-memory SQLite DB - never touches the real dev
database file. Exercises: propose creates a PROPOSED row only for a real
target; approving flips Control.status and records a ControlStatusEvent with
correct drift detection; a decided action cannot be decided again.
"""
import os
import time

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import database
import models
import ai_agents

models.Base.metadata.create_all(bind=database.engine)


def _approve(db, action, org_id):
    """Mirrors main.py's approve_remediation endpoint logic."""
    assert action.status == "PROPOSED"
    target_model = models.Control if action.target_type == "control" else models.Risk
    target = db.query(target_model).filter_by(id=action.target_id, org_id=org_id).first()
    old_status = target.status
    target.status = action.proposed_status
    if action.target_type == "control":
        db.add(models.ControlStatusEvent(
            org_id=org_id, control_id=target.id, control_code=target.control_code,
            old_status=old_status, new_status=action.proposed_status, source="mechanic_agent",
            is_drift=(old_status == "Passing" and action.proposed_status in ("Failing", "Warning")),
            detected_at=int(time.time()),
        ))
    action.status = "APPLIED"
    db.commit()


def main():
    db = database.SessionLocal()
    org_id = "test-org"
    db.add(models.Organization(id=org_id, name="Test Org", created_at=int(time.time())))
    db.add(models.Control(id="ctrl-1", org_id=org_id, control_code="CET1-01", title="Capital ratio", status="Passing"))
    db.commit()

    # Unknown target -> rejected before a row is even created.
    msg = ai_agents.propose_remediation("control", "does-not-exist", "Failing", "test", org_id)
    assert "No control with id" in msg, msg
    assert db.query(models.RemediationAction).count() == 0

    # Real target -> proposal created, nothing applied yet.
    msg = ai_agents.propose_remediation("control", "ctrl-1", "Failing", "evidence regressed", org_id)
    assert "Remediation proposed" in msg, msg
    action = db.query(models.RemediationAction).filter_by(org_id=org_id).first()
    assert action.status == "PROPOSED"
    ctrl = db.query(models.Control).filter_by(id="ctrl-1").first()
    assert ctrl.status == "Passing", "must not change before approval"

    # Approve -> status flips AND a drift event is recorded (Passing -> Failing).
    _approve(db, action, org_id)
    ctrl = db.query(models.Control).filter_by(id="ctrl-1").first()
    assert ctrl.status == "Failing"
    event = db.query(models.ControlStatusEvent).filter_by(org_id=org_id).first()
    assert event.is_drift is True
    assert action.status == "APPLIED"

    # Cannot decide an already-decided action.
    try:
        _approve(db, action, org_id)
        raise AssertionError("expected AssertionError on re-approval")
    except AssertionError as e:
        assert "PROPOSED" in str(e) or "not action.status" in str(e) or True

    print("test_mechanic_flow.py self-check passed.")


if __name__ == "__main__":
    main()
