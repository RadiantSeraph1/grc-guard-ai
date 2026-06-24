"""Weak-supervision labels for the compliance-decision model.

There is no large public "config -> PASS/FAIL" dataset, so we GENERATE one: run
Checkov (a static IaC scanner whose policies are already mapped to CIS / SOC2 /
PCI / NIST) over a corpus of Terraform/CloudFormation/Kubernetes files and turn
each finding into a labeled row.

These labels are NOISY (rule coverage is partial) - treat them as weak
supervision and keep a hand-labeled gold set for evaluation. See
docs/MODEL_TRAINING_PLAN.md, Task 2.

Prereqs:
    pip install checkov            # or: pipx install checkov
    # plus a directory of IaC to scan (e.g. cloned public Terraform repos)

Run:
    python backend/training/scripts/gen_compliance_labels.py --iac-dir /path/to/iac
"""

from __future__ import annotations

import os
import sys
import json
import argparse
import subprocess

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import record, write_jsonl, PROCESSED_DIR  # noqa: E402


def run_checkov(iac_dir: str) -> dict:
    """Run checkov and return its parsed JSON output."""
    try:
        proc = subprocess.run(
            ["checkov", "-d", iac_dir, "-o", "json", "--compact", "--quiet"],
            capture_output=True, text=True, timeout=1800,
        )
    except FileNotFoundError:
        sys.exit("checkov not found. Install with: pip install checkov")
    if not proc.stdout.strip():
        sys.exit(f"checkov produced no output.\n{proc.stderr[:500]}")
    return json.loads(proc.stdout)


def _iter_check_blocks(payload):
    """Checkov JSON can be a dict or a list of {check_type, results} blocks."""
    blocks = payload if isinstance(payload, list) else [payload]
    for b in blocks:
        results = b.get("results", {})
        for status in ("passed_checks", "failed_checks"):
            for c in results.get(status, []) or []:
                yield status, c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iac-dir", required=True, help="directory of Terraform/CFN/K8s files")
    ap.add_argument("--out", default=os.path.join(PROCESSED_DIR, "compliance_checkov.jsonl"))
    args = ap.parse_args()

    if not os.path.isdir(args.iac_dir):
        sys.exit(f"Not a directory: {args.iac_dir}")

    print(f"Scanning {args.iac_dir} with checkov ...")
    payload = run_checkov(args.iac_dir)

    rows = []
    for status, c in _iter_check_blocks(payload):
        snippet = "\n".join(line for _, line in (c.get("code_block") or [])) or c.get("resource", "")
        rows.append(record(
            text=snippet,
            source="checkov",
            control_id=c.get("check_id"),         # e.g. CKV_AWS_18 (maps to CIS/NIST)
            label="PASS" if status == "passed_checks" else "FAIL",
            rationale=c.get("check_name"),
            extra={
                "task": "compliance_decision",
                "resource": c.get("resource"),
                "guideline": c.get("guideline"),
            },
        ))

    n = write_jsonl(args.out, rows)
    n_fail = sum(1 for r in rows if r["label"] == "FAIL")
    print(f"Wrote {n} rows ({n_fail} FAIL / {n - n_fail} PASS) -> {args.out}")
    print("Reminder: weak labels - validate against a hand-labeled gold set before trusting metrics.")


if __name__ == "__main__":
    main()
