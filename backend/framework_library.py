"""Framework library + control mappings.

The platform ships empty, but a GRC tool's value is mapping live evidence to a
recognised standard. This module is an *importable catalog* (not sample data):
the operator chooses which frameworks to bring into their organization, and on
import we materialise the controls that framework requires.

Two ideas tie it together:

  * A single master ``CONTROL_LIBRARY``. Each control belongs to one or more
    frameworks and, where applicable, names the connector check(s) that prove
    it. A control shared by SOC 2 and ISO 27001 is created once and tagged with
    both, so importing the second framework just adds the tag.

  * ``apply_connector_result`` — the bridge from connectors to controls. When an
    integration sync finishes, every control whose ``connectors`` list contains
    that integration is flipped Passing/Failing. This is what makes a synced AWS
    bucket-encryption check actually satisfy "encryption at rest" across every
    framework that requires it.
"""

import time
from typing import Optional
from sqlalchemy.orm import Session

import models


# ---------------------------------------------------------------------------
# Framework catalog
# ---------------------------------------------------------------------------

# Basel III leads the catalog: this is a banking-first GRC platform, so the core
# banking standard is the recommended first import. The org is still provisioned
# empty - nothing is auto-imported - but the library surfaces Basel III first.
FRAMEWORK_LIBRARY = {
    "basel-iii": {
        "name": "Basel III",
        "code": "BASEL-III",
        "description": "Banking capital adequacy, stress testing, and liquidity requirements.",
        "recommended": True,
    },
    "soc-2": {
        "name": "SOC 2 Type II",
        "code": "SOC2",
        "description": "AICPA Trust Services Criteria (Security, Availability, Confidentiality).",
    },
    "iso-27001": {
        "name": "ISO/IEC 27001:2022",
        "code": "ISO27001",
        "description": "Information Security Management System (ISMS) Annex A controls.",
    },
    "nist-csf": {
        "name": "NIST Cybersecurity Framework 2.0",
        "code": "NIST-CSF",
        "description": "Identify, Protect, Detect, Respond, Recover, Govern functions.",
    },
    "pci-dss": {
        "name": "PCI DSS v4.0",
        "code": "PCI-DSS",
        "description": "Payment Card Industry Data Security Standard for cardholder data.",
    },
    "gdpr": {
        "name": "GDPR",
        "code": "GDPR",
        "description": "EU General Data Protection Regulation for personal data processing.",
    },
}


# ---------------------------------------------------------------------------
# Master control catalog
# ---------------------------------------------------------------------------
# Each entry:
#   control_code : stable, unique within an org. Connector handlers target these.
#   title        : human label
#   description  : what the control asserts
#   frameworks   : list of framework ids this control satisfies
#   connectors   : integration ids that automatically test this control (may be
#                  empty -> control is evidenced manually / via documents)
# ---------------------------------------------------------------------------

CONTROL_LIBRARY = [
    {
        "control_code": "SOC2-MFA-01",
        "title": "Multi-Factor Authentication Enforced",
        "description": "All workforce identities require a second authentication factor.",
        "frameworks": ["soc-2", "iso-27001", "nist-csf", "pci-dss", "basel-iii"],
        "connectors": ["google_workspace"],
    },
    {
        "control_code": "GDPR-PII-01",
        "title": "Encryption of Data at Rest",
        "description": "Customer and personal data stores are encrypted at rest.",
        "frameworks": ["gdpr", "soc-2", "iso-27001", "pci-dss", "basel-iii"],
        "connectors": ["gcp"],
    },
    {
        "control_code": "BASEL-SOD-01",
        "title": "Segregation of Duties (Maker-Checker)",
        "description": "Privileged core-banking transactions require four-eyes maker-checker approval on the ledger.",
        "frameworks": ["basel-iii", "soc-2", "iso-27001"],
        "connectors": ["fineract"],
    },
    {
        "control_code": "PCI-LOG-01",
        "title": "Audit Logging & Monitoring",
        "description": "Privileged actions on core systems and cardholder data are logged and reviewed (PCI Req 10 / Basel operational risk).",
        "frameworks": ["pci-dss", "soc-2", "basel-iii"],
        "connectors": ["fineract"],
    },
    {
        "control_code": "EDR-01",
        "title": "Endpoint Detection & Response Coverage",
        "description": "Managed endpoints run an active EDR sensor.",
        "frameworks": ["soc-2", "iso-27001", "nist-csf", "basel-iii"],
        "connectors": ["wazuh"],
    },
    {
        "control_code": "VULN-01",
        "title": "Vulnerability Management",
        "description": "Open critical and high severity vulnerabilities are remediated in SLA.",
        "frameworks": ["soc-2", "iso-27001", "nist-csf", "pci-dss"],
        "connectors": [],
    },
    {
        "control_code": "HR-ACC-01",
        "title": "Personnel Access Governance",
        "description": "Joiner/mover/leaver access is governed against the authoritative HR roster.",
        "frameworks": ["soc-2", "iso-27001"],
        "connectors": [],
    },
    # --- Manually-evidenced controls (no automatic connector) ---
    {
        "control_code": "SEC-POL-01",
        "title": "Information Security Policy",
        "description": "A board-approved information security policy is published and reviewed annually.",
        "frameworks": ["soc-2", "iso-27001", "nist-csf"],
        "connectors": [],
    },
    {
        "control_code": "ISO-ASSET-01",
        "title": "Asset Inventory Maintained",
        "description": "An inventory of information assets and owners is maintained (ISO A.5.9 / NIST ID.AM).",
        "frameworks": ["iso-27001", "nist-csf"],
        "connectors": [],
    },
    {
        "control_code": "IR-PLAN-01",
        "title": "Incident Response Plan",
        "description": "A tested incident response plan defines roles, severities, and notification timelines.",
        "frameworks": ["soc-2", "iso-27001", "nist-csf"],
        "connectors": [],
    },
    {
        "control_code": "GDPR-ROPA-01",
        "title": "Records of Processing Activities",
        "description": "A register of personal-data processing activities is maintained (GDPR Art. 30).",
        "frameworks": ["gdpr"],
        "connectors": [],
    },
    {
        "control_code": "GDPR-BREACH-01",
        "title": "Breach Notification Procedure",
        "description": "Personal-data breaches are assessed and reported within 72 hours (GDPR Art. 33).",
        "frameworks": ["gdpr"],
        "connectors": [],
    },
    {
        "control_code": "BASEL-CET1-01",
        "title": "Common Equity Tier 1 Ratio",
        "description": "CET1 capital ratio is maintained above the Basel III regulatory minimum.",
        "frameworks": ["basel-iii"],
        "connectors": [],
    },
    {
        "control_code": "BASEL-LCR-01",
        "title": "Liquidity Coverage Ratio",
        "description": "High-quality liquid assets cover 30-day net cash outflows (LCR >= 100%).",
        "frameworks": ["basel-iii"],
        "connectors": [],
    },
]


# Index: connector id -> list of control codes it tests.
_CONNECTOR_TO_CODES: dict[str, list[str]] = {}
for _c in CONTROL_LIBRARY:
    for _conn in _c["connectors"]:
        _CONNECTOR_TO_CODES.setdefault(_conn, []).append(_c["control_code"])


def _control_def(control_code: str) -> Optional[dict]:
    for c in CONTROL_LIBRARY:
        if c["control_code"] == control_code:
            return c
    return None


# ---------------------------------------------------------------------------
# Library listing
# ---------------------------------------------------------------------------

def list_library(db: Session, org_id: str) -> list[dict]:
    """Return the catalog with per-framework import status + control counts."""
    imported_ids = {f.id for f in db.query(models.Framework).filter_by(org_id=org_id).all()}
    out = []
    for fid, meta in FRAMEWORK_LIBRARY.items():
        controls = [c for c in CONTROL_LIBRARY if fid in c["frameworks"]]
        automated = sum(1 for c in controls if c["connectors"])
        out.append({
            "id": fid,
            "name": meta["name"],
            "code": meta["code"],
            "description": meta["description"],
            "imported": fid in imported_ids,
            "controls_count": len(controls),
            "automated_controls": automated,
        })
    return out


# ---------------------------------------------------------------------------
# Import / remove
# ---------------------------------------------------------------------------

def _csv_set(value: Optional[str]) -> set[str]:
    return {p.strip() for p in (value or "").split(",") if p.strip()}


def import_framework(db: Session, org_id: str, framework_id: str) -> dict:
    """Materialise a framework and its controls into the organization.

    Idempotent: re-importing tops up any missing controls/tags without
    duplicating. Controls shared with already-imported frameworks are reused and
    simply gain the new framework tag.
    """
    meta = FRAMEWORK_LIBRARY.get(framework_id)
    if not meta:
        raise ValueError(f"Unknown framework '{framework_id}'.")

    fw = db.query(models.Framework).filter_by(org_id=org_id, id=framework_id).first()
    if not fw:
        fw = models.Framework(
            id=framework_id,
            org_id=org_id,
            name=meta["name"],
            code=meta["code"],
            description=meta["description"],
            readiness=0.0,
        )
        db.add(fw)

    created = 0
    linked = 0
    for cdef in CONTROL_LIBRARY:
        if framework_id not in cdef["frameworks"]:
            continue
        existing = db.query(models.Control).filter_by(
            org_id=org_id, control_code=cdef["control_code"]
        ).first()
        if existing:
            # Tag the control only with frameworks that are actually imported.
            # (Tagging with the full library set would orphan controls on
            # removal, since only imported frameworks ever get untagged.)
            tags = _csv_set(existing.frameworks)
            if framework_id not in tags:
                tags.add(framework_id)
                existing.frameworks = ",".join(sorted(tags))
                linked += 1
        else:
            db.add(models.Control(
                id=f"ctrl_{org_id}_{cdef['control_code'].lower()}",
                org_id=org_id,
                control_code=cdef["control_code"],
                title=cdef["title"],
                description=cdef["description"],
                frameworks=framework_id,
                status="Failing",
            ))
            created += 1

    db.commit()
    recompute_readiness(db, org_id, framework_id)
    return {
        "framework_id": framework_id,
        "name": meta["name"],
        "controls_created": created,
        "controls_linked": linked,
    }


def remove_framework(db: Session, org_id: str, framework_id: str) -> dict:
    """Remove a framework. Strips its tag from controls and deletes controls
    that are left untagged (i.e. belonged only to this framework)."""
    fw = db.query(models.Framework).filter_by(org_id=org_id, id=framework_id).first()
    if not fw:
        return {"framework_id": framework_id, "removed": False}

    deleted_controls = 0
    library_codes = {c["control_code"] for c in CONTROL_LIBRARY if framework_id in c["frameworks"]}
    for ctrl in db.query(models.Control).filter_by(org_id=org_id).all():
        tags = _csv_set(ctrl.frameworks)
        if framework_id not in tags:
            continue
        tags.discard(framework_id)
        if not tags and ctrl.control_code in library_codes:
            db.delete(ctrl)
            deleted_controls += 1
        else:
            ctrl.frameworks = ",".join(sorted(tags))

    db.delete(fw)
    db.commit()
    return {"framework_id": framework_id, "removed": True, "controls_deleted": deleted_controls}


# ---------------------------------------------------------------------------
# Connector -> control bridge
# ---------------------------------------------------------------------------

def apply_connector_result(db: Session, org_id: str, integration_id: str,
                           compliant: bool, warning: bool = False,
                           source: str = "sync") -> list[str]:
    """Flip every control mapped to ``integration_id`` based on a sync result.

    Records a ControlStatusEvent for each status change and flags drift when a
    previously-Passing control regresses. Returns the list of control codes that
    were updated. Controls that have not been imported are skipped silently.
    """
    codes = _CONNECTOR_TO_CODES.get(integration_id, [])
    if not codes:
        return []
    status = "Passing" if compliant else ("Warning" if warning else "Failing")
    now = int(time.time())
    updated = []
    for code in codes:
        ctrl = db.query(models.Control).filter_by(org_id=org_id, control_code=code).first()
        if not ctrl:
            continue
        old_status = ctrl.status
        if old_status != status:
            # Drift = a previously-passing control regressing to a worse state.
            is_drift = (old_status == "Passing" and status in ("Failing", "Warning"))
            event = models.ControlStatusEvent(
                org_id=org_id,
                control_id=ctrl.id,
                control_code=code,
                old_status=old_status,
                new_status=status,
                source=source,
                is_drift=is_drift,
                detected_at=now,
            )
            db.add(event)
            if is_drift:
                # Flush to get the event id, then raise a notification.
                db.flush()
                try:
                    import notifications
                    notifications.notify_drift(db, org_id, code, ctrl.title,
                                               old_status, status, event.id)
                except Exception as e:
                    print(f"Drift notification skipped for {code}: {e}")
        ctrl.status = status
        ctrl.last_tested = now
        updated.append(code)
    if updated:
        db.commit()
        # Refresh readiness for any imported framework touched by these controls.
        touched_frameworks = set()
        for code in updated:
            cdef = _control_def(code)
            if cdef:
                touched_frameworks.update(cdef["frameworks"])
        for fid in touched_frameworks:
            recompute_readiness(db, org_id, fid)
    return updated


# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------

def recompute_readiness(db: Session, org_id: str, framework_id: str) -> float:
    """Recompute and persist a framework's readiness from its mapped controls."""
    fw = db.query(models.Framework).filter_by(org_id=org_id, id=framework_id).first()
    if not fw:
        return 0.0
    mapped = db.query(models.Control).filter(
        models.Control.org_id == org_id,
        models.Control.frameworks.contains(framework_id),
    ).all()
    if not mapped:
        fw.readiness = 0.0
    else:
        passing = sum(1 for c in mapped if c.status == "Passing")
        fw.readiness = round((passing / len(mapped)) * 100, 1)
    db.commit()
    return fw.readiness
