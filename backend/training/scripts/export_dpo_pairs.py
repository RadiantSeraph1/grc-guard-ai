"""Export DPO preference pairs from real auditor feedback (the `feedback` table).

Per paper Ch.3 "reinforcement learning based on human feedback with domain
experts": this is the data-collection half. A row only becomes a usable
(prompt, chosen, rejected) pair when the SAME (or near-identical) input has
BOTH an up-rated and a down-rated response on record — otherwise there is no
real contrast to learn from, so it's skipped rather than fabricated.

Run (against the live app database):
  python backend/training/scripts/export_dpo_pairs.py
  python backend/training/scripts/export_dpo_pairs.py --db-url sqlite:///../grc_database.db

Output: backend/training/data/processed/dpo_pairs.jsonl (gitignored, like
banking_corpus.jsonl — feedback text may contain org-specific content).
"""
import argparse
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import PROCESSED_DIR, write_jsonl  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BACKEND_DIR)


def _normalize(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def build_pairs(rows: list) -> list:
    """rows: list of dicts with source, input_text, output_decision,
    output_explanation, rating. Groups by (source, normalized input_text);
    within each group, pairs every 'up' response against every 'down'
    response as (chosen, rejected)."""
    groups = defaultdict(lambda: {"up": [], "down": []})
    for r in rows:
        key = (r["source"], _normalize(r["input_text"]))
        groups[key][r["rating"]].append(r)

    pairs = []
    for (source, _norm_input), bucket in groups.items():
        if not bucket["up"] or not bucket["down"]:
            continue  # no contrast to learn from - skip, don't fabricate
        original_input = bucket["up"][0]["input_text"]
        for chosen in bucket["up"]:
            for rejected in bucket["down"]:
                pairs.append({
                    "source": source,
                    "prompt": original_input,
                    "chosen": _format_output(chosen),
                    "rejected": _format_output(rejected),
                })
    return pairs


def _format_output(row: dict) -> str:
    decision = row.get("output_decision") or ""
    explanation = row.get("output_explanation") or ""
    return f"Decision: {decision}\nExplanation: {explanation}".strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-url", default=None, help="Override DATABASE_URL (defaults to the app's configured DB).")
    ap.add_argument("--out", default=os.path.join(PROCESSED_DIR, "dpo_pairs.jsonl"))
    args = ap.parse_args()

    if args.db_url:
        os.environ["DATABASE_URL"] = args.db_url

    import database
    import models

    db = database.SessionLocal()
    try:
        feedback_rows = db.query(models.Feedback).all()
        print(f"Loaded {len(feedback_rows)} feedback rows.")
        rows = [{
            "source": f.source,
            "input_text": f.input_text,
            "output_decision": f.output_decision,
            "output_explanation": f.output_explanation,
            "rating": f.rating,
        } for f in feedback_rows]
    finally:
        db.close()

    pairs = build_pairs(rows)
    n = write_jsonl(args.out, pairs)
    print(f"Wrote {n} DPO preference pairs -> {args.out}")
    if n == 0:
        print(
            "No pairs yet: DPO needs at least one 'up' AND one 'down' rating on the "
            "SAME input. Collect more feedback via the Scanner/Brain thumbs-up/down "
            "controls, then re-run this script."
        )


if __name__ == "__main__":
    main()
