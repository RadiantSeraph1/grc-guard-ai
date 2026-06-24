"""Build the NIST SP 800-53 Rev 5 control dataset from the official OSCAL catalog.

Source: https://github.com/usnistgov/oscal-content  (US gov, public domain).
Pure `requests` — no ML deps. Emits canonical JSONL where each row is one control
(its statement + guidance), forming:
  * the label-space anchors for the control-mapping model (Task 1), and
  * a clean regulatory corpus for RAG.

Run:
    python backend/training/scripts/build_oscal_controls.py
"""

from __future__ import annotations

import os
import sys
import json

import requests

# Make `common` importable whether run as a module or a script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import record, write_jsonl, PROCESSED_DIR, RAW_DIR  # noqa: E402

CATALOG_URL = (
    "https://raw.githubusercontent.com/usnistgov/oscal-content/main/"
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json"
)


def _collect_prose(parts, want_name):
    """Recursively gather prose from OSCAL `parts` whose name == want_name."""
    out = []
    for p in parts or []:
        if p.get("name") == want_name:
            if p.get("prose"):
                out.append(p["prose"])
            # statements nest sub-parts (item a, b, c ...)
            out.extend(_collect_prose(p.get("parts"), want_name))
    return out


def _label(control) -> str:
    for prop in control.get("props", []) or []:
        if prop.get("name") == "label":
            return prop.get("value", "")
    return control.get("id", "").upper()


def _walk_controls(node, family, rows):
    """Walk groups/controls recursively (controls can nest enhancements)."""
    for ctrl in node.get("controls", []) or []:
        label = _label(ctrl)
        title = ctrl.get("title", "")
        statement = " ".join(_collect_prose(ctrl.get("parts"), "statement")).strip()
        guidance = " ".join(_collect_prose(ctrl.get("parts"), "guidance")).strip()
        text = f"{label} {title}".strip()
        if statement:
            text = f"{text}. {statement}"
        rows.append(
            record(
                text=text,
                source="oscal",
                framework="nist-800-53",
                control_id=label,
                rationale=guidance,
                extra={"family": family, "title": title},
            )
        )
        # recurse into control enhancements
        _walk_controls(ctrl, family, rows)


def main():
    print(f"Downloading OSCAL catalog...\n  {CATALOG_URL}")
    resp = requests.get(CATALOG_URL, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    # cache the raw file for reproducibility
    raw_path = os.path.join(RAW_DIR, "nist_800_53_rev5_catalog.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"  cached raw -> {raw_path}")

    catalog = data.get("catalog", {})
    rows = []
    for group in catalog.get("groups", []) or []:
        family = group.get("title", group.get("id", "")).strip()
        _walk_controls(group, family, rows)
        # some groups hold controls directly + nested groups
        for sub in group.get("groups", []) or []:
            _walk_controls(sub, sub.get("title", family), rows)

    out_path = os.path.join(PROCESSED_DIR, "nist_800_53_controls.jsonl")
    n = write_jsonl(out_path, rows)
    families = sorted({r["family"] for r in rows})
    print(f"\nWrote {n} controls -> {out_path}")
    print(f"Families ({len(families)}): {', '.join(families[:8])}{' ...' if len(families) > 8 else ''}")
    if rows:
        print("\nExample record:")
        ex = dict(rows[0])
        ex["text"] = ex["text"][:160] + "..." if len(ex["text"]) > 160 else ex["text"]
        ex["rationale"] = (ex["rationale"][:80] + "...") if ex.get("rationale") else None
        print(json.dumps(ex, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
