"""Shared helpers for the GRC auditor training-data pipeline.

Every dataset builder normalizes into the SAME canonical JSONL schema so the
downstream training scripts (control mapping / compliance decision /
justification) read one format regardless of source. See docs/MODEL_TRAINING_PLAN.md.
"""

from __future__ import annotations

import json
import os
import hashlib
from typing import Iterable, Optional

# Repo-relative data lake roots.
TRAINING_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(TRAINING_DIR, "data", "raw")
INTERIM_DIR = os.path.join(TRAINING_DIR, "data", "interim")
PROCESSED_DIR = os.path.join(TRAINING_DIR, "data", "processed")

for _d in (RAW_DIR, INTERIM_DIR, PROCESSED_DIR):
    os.makedirs(_d, exist_ok=True)


def stable_id(*parts: str) -> str:
    """Deterministic id from content so re-runs don't duplicate rows."""
    h = hashlib.sha1("|".join(p or "" for p in parts).encode("utf-8")).hexdigest()
    return h[:16]


def record(
    text: str,
    source: str,
    *,
    framework: Optional[str] = None,
    control_id: Optional[str] = None,
    label: Optional[str] = None,
    rationale: Optional[str] = None,
    extra: Optional[dict] = None,
) -> dict:
    """Build one canonical record. `text` and `source` are required."""
    rec = {
        "id": stable_id(source, control_id or "", text[:200]),
        "source": source,
        "text": (text or "").strip(),
        "framework": framework,
        "control_id": control_id,
        "label": label,          # PASS | FAIL | None
        "rationale": (rationale or "").strip() or None,
    }
    if extra:
        rec.update(extra)
    return rec


def write_jsonl(path: str, rows: Iterable[dict]) -> int:
    """Write rows to JSONL, return the count. Creates parent dirs."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            n += 1
    return n
