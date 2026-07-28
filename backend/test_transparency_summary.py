"""Self-check for the auditor transparency rating aggregation (Feedback.transparency_rating).

Runs against an isolated in-memory SQLite DB. Verifies: ratings-less feedback
doesn't skew the average, per-source breakdown is correct, and n=0 reports
honestly (no fabricated 0.0 or default score).
"""
import os
import time

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import database
import models

models.Base.metadata.create_all(bind=database.engine)


def summarize(db, org_id):
    """Mirrors main.py's get_transparency_summary logic."""
    rated = (
        db.query(models.Feedback)
        .filter(models.Feedback.org_id == org_id, models.Feedback.transparency_rating.isnot(None))
        .all()
    )
    n = len(rated)
    if n == 0:
        return {"average": None, "count": 0, "by_source": {}}
    by_source = {}
    for source in ("scan", "brain"):
        vals = [r.transparency_rating for r in rated if r.source == source]
        if vals:
            by_source[source] = {"average": round(sum(vals) / len(vals), 2), "count": len(vals)}
    return {
        "average": round(sum(r.transparency_rating for r in rated) / n, 2),
        "count": n,
        "by_source": by_source,
    }


def main():
    db = database.SessionLocal()
    org_id = "test-org"
    db.add(models.Organization(id=org_id, name="Test Org", created_at=int(time.time())))
    db.commit()

    # No ratings yet -> honest "not rated", not a fabricated 0.0.
    summary = summarize(db, org_id)
    assert summary == {"average": None, "count": 0, "by_source": {}}, summary

    # A correctness-only feedback entry (no transparency rating) must not
    # count toward the average.
    db.add(models.Feedback(id="f1", org_id=org_id, source="scan", input_text="x",
                            rating="up", transparency_rating=None, created_at=int(time.time())))
    db.commit()
    assert summarize(db, org_id)["count"] == 0

    # Real ratings: scan=[5,3], brain=[4] -> overall avg (5+3+4)/3 = 4.0
    db.add(models.Feedback(id="f2", org_id=org_id, source="scan", input_text="x",
                            rating="up", transparency_rating=5, created_at=int(time.time())))
    db.add(models.Feedback(id="f3", org_id=org_id, source="scan", input_text="x",
                            rating="down", transparency_rating=3, created_at=int(time.time())))
    db.add(models.Feedback(id="f4", org_id=org_id, source="brain", input_text="x",
                            rating="up", transparency_rating=4, created_at=int(time.time())))
    db.commit()

    summary = summarize(db, org_id)
    assert summary["count"] == 3, summary
    assert summary["average"] == 4.0, summary
    assert summary["by_source"]["scan"] == {"average": 4.0, "count": 2}, summary
    assert summary["by_source"]["brain"] == {"average": 4.0, "count": 1}, summary

    # A different org's ratings must never leak into this org's average.
    db.add(models.Organization(id="other-org", name="Other", created_at=int(time.time())))
    db.add(models.Feedback(id="f5", org_id="other-org", source="scan", input_text="x",
                            rating="up", transparency_rating=1, created_at=int(time.time())))
    db.commit()
    assert summarize(db, org_id)["average"] == 4.0

    print("test_transparency_summary.py self-check passed.")


if __name__ == "__main__":
    main()
