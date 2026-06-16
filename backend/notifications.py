"""In-app notification helpers.

Notifications are generated from platform events:
  * drift  - a control regressed (written from the connector->control bridge)
  * overdue_task - a remediation task passed its due date (generated on read)

``create_notification`` dedups on (type, related_id) against existing unread
rows so repeated syncs / list calls don't spam the feed.
"""

import time
import uuid

from sqlalchemy.orm import Session

import models


def create_notification(db: Session, org_id: str, *, type: str, title: str,
                        severity: str = "info", message: str = None,
                        link: str = None, related_id: str = None,
                        commit: bool = True) -> models.Notification | None:
    """Create a notification, skipping if an unread one already exists for the
    same (type, related_id)."""
    if related_id:
        existing = (
            db.query(models.Notification)
            .filter_by(org_id=org_id, type=type, related_id=related_id, read=False)
            .first()
        )
        if existing:
            return None
    note = models.Notification(
        id=f"ntf_{uuid.uuid4().hex[:12]}",
        org_id=org_id,
        type=type,
        severity=severity,
        title=title,
        message=message,
        link=link,
        related_id=related_id,
        read=False,
        created_at=int(time.time()),
    )
    db.add(note)
    if commit:
        db.commit()
    return note


def notify_drift(db: Session, org_id: str, control_code: str, control_title: str,
                 old_status: str, new_status: str, event_id: int):
    """Emit a drift notification (called from the connector->control bridge)."""
    create_notification(
        db, org_id,
        type="drift",
        severity="critical" if new_status == "Failing" else "warning",
        title=f"Control drift: {control_title}",
        message=f"{control_code} regressed {old_status} -> {new_status}.",
        link="/",
        related_id=f"drift:{event_id}",
        commit=False,  # caller commits with the event
    )


def generate_overdue_task_notifications(db: Session, org_id: str) -> int:
    """Create notifications for remediation tasks that are overdue and not done.
    Idempotent via dedup on the task id."""
    now = int(time.time())
    overdue = (
        db.query(models.RemediationTask)
        .filter(
            models.RemediationTask.org_id == org_id,
            models.RemediationTask.status != "Done",
            models.RemediationTask.due_date.isnot(None),
            models.RemediationTask.due_date < now,
        )
        .all()
    )
    made = 0
    for t in overdue:
        note = create_notification(
            db, org_id,
            type="overdue_task",
            severity="warning",
            title=f"Overdue task: {t.title}",
            message=f"Remediation task is past its due date ({t.priority} priority).",
            link="/tasks",
            related_id=f"task:{t.id}",
            commit=False,
        )
        if note:
            made += 1
    if made:
        db.commit()
    return made
