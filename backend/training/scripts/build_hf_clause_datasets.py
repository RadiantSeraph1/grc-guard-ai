"""Build clause/provision datasets from Hugging Face into canonical JSONL.

Covers the labeled public datasets closest to GRC control mapping & compliance:
  * LEDGAR   (in coastalcph/lex_glue, config "ledgar") - provision -> category
  * UNFAIR-ToS (lex_glue config "unfair_tos")          - fair vs unfair clause
  * CUAD     (theatticusproject/cuad-qa)               - 41 contract clause types

Requires the ML extras:  pip install -r backend/training/requirements-train.txt

Run:
    python backend/training/scripts/build_hf_clause_datasets.py --datasets ledgar unfair_tos cuad
"""

from __future__ import annotations

import os
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import record, write_jsonl, PROCESSED_DIR  # noqa: E402


def _require_datasets():
    try:
        from datasets import load_dataset  # noqa: F401
        return load_dataset
    except ImportError:
        sys.exit(
            "The `datasets` library is required.\n"
            "Install with: pip install -r backend/training/requirements-train.txt"
        )


def build_ledgar(load_dataset):
    """LEDGAR: 100-way provision classification sourced from SEC contracts."""
    ds = load_dataset("coastalcph/lex_glue", "ledgar")
    names = ds["train"].features["label"].names  # category names
    rows = []
    for split in ("train", "validation", "test"):
        if split not in ds:
            continue
        split_name = "val" if split == "validation" else split
        for ex in ds[split]:
            rows.append(record(
                text=ex["text"],
                source="ledgar",
                control_id=names[ex["label"]],   # provision category
                extra={"split": split_name, "task": "control_mapping"},
            ))
    return rows


def build_unfair_tos(load_dataset):
    """UNFAIR-ToS: multi-label unfair-clause detection (label [] == fair)."""
    ds = load_dataset("coastalcph/lex_glue", "unfair_tos")
    rows = []
    for split in ("train", "validation", "test"):
        if split not in ds:
            continue
        split_name = "val" if split == "validation" else split
        for ex in ds[split]:
            labels = ex.get("labels") or ex.get("label") or []
            is_unfair = bool(labels) if isinstance(labels, list) else bool(labels)
            rows.append(record(
                text=ex["text"],
                source="unfair_tos",
                framework="gdpr",
                label="FAIL" if is_unfair else "PASS",  # unfair clause == violation
                extra={"split": split_name, "task": "compliance_decision"},
            ))
    return rows


def build_cuad(load_dataset):
    """CUAD: SQuAD-style clause extraction across 41 contract clause types."""
    ds = load_dataset("theatticusproject/cuad-qa")
    rows = []
    for split in ("train", "test"):
        if split not in ds:
            continue
        for ex in ds[split]:
            # question encodes the clause type; context is the contract text.
            clause_type = ex["question"].split("related to")[-1].strip(' "?.')
            has_answer = bool(ex.get("answers", {}).get("text"))
            rows.append(record(
                text=ex["context"][:2000],
                source="cuad",
                control_id=clause_type,
                label="PASS" if has_answer else None,
                rationale=(ex["answers"]["text"][0] if has_answer else None),
                extra={"split": split, "task": "control_mapping"},
            ))
    return rows


BUILDERS = {"ledgar": build_ledgar, "unfair_tos": build_unfair_tos, "cuad": build_cuad}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datasets", nargs="+", default=["ledgar", "unfair_tos"],
                    choices=list(BUILDERS), help="which datasets to build")
    args = ap.parse_args()

    load_dataset = _require_datasets()
    for name in args.datasets:
        print(f"Building {name} ...")
        rows = BUILDERS[name](load_dataset)
        out = os.path.join(PROCESSED_DIR, f"{name}.jsonl")
        n = write_jsonl(out, rows)
        print(f"  wrote {n} rows -> {out}")


if __name__ == "__main__":
    main()
