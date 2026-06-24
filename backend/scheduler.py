"""Scheduled continuous monitoring.

Periodically re-runs every connected integration so compliance evidence stays
fresh without manual clicks. Each run flows through the same ``run_sync_task``
path as a manual sync, so control statuses update and drift events are recorded
automatically.

The scheduler is optional: if APScheduler is not installed it degrades to a
no-op and the app still runs (manual sync remains available).
"""

import os
import time

import database
import models

# Default cadence: every 6 hours. Override with SYNC_INTERVAL_MINUTES.
SYNC_INTERVAL_MINUTES = int(os.environ.get("SYNC_INTERVAL_MINUTES", "360"))
SCHEDULER_ENABLED = os.environ.get("SCHEDULER_ENABLED", "true").lower() == "true"

_scheduler = None


def run_all_syncs(source: str = "scheduler") -> dict:
    """Run a sync for every Connected integration across all organizations.

    Returns a summary dict. Safe to call manually (e.g. from an endpoint).
    """
    # Imported lazily to avoid a circular import at module load.
    import main

    db = database.SessionLocal()
    try:
        integrations = (
            db.query(models.Integration)
            .filter(models.Integration.status == "Connected")
            .all()
        )
        targets = [(i.id, i.org_id) for i in integrations]
    finally:
        db.close()

    ran = 0
    for integration_id, org_id in targets:
        try:
            main.run_sync_task(integration_id, org_id, source=source)
            ran += 1
        except Exception as e:
            print(f"[scheduler] sync failed for {integration_id}/{org_id}: {e}")

    summary = {"ran": ran, "total_connected": len(targets), "at": int(time.time())}
    if targets:
        print(f"[scheduler] continuous monitoring: synced {ran}/{len(targets)} connectors")
    return summary


def start():
    """Start the background scheduler (idempotent)."""
    global _scheduler
    if not SCHEDULER_ENABLED:
        print("[scheduler] disabled via SCHEDULER_ENABLED=false")
        return
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except Exception as e:
        print(f"[scheduler] APScheduler not available ({e}); continuous monitoring off.")
        return

    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        run_all_syncs,
        "interval",
        minutes=SYNC_INTERVAL_MINUTES,
        id="continuous_monitoring",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    print(f"[scheduler] continuous monitoring every {SYNC_INTERVAL_MINUTES} min")
