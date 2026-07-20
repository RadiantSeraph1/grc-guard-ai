"""Chapter 4 empirical-validation harvest.

Collects REAL measured results from the deployed system and prints a
markdown results document for the thesis' Chapter 4:

  1. Rule-baseline benchmark on the held-out labelled set (accuracy,
     precision, recall, F1, confusion matrix, per-case table).
  2. Live connector posture results (actual last-sync audit findings).
  3. Framework readiness (per-framework control pass/warn/fail).
  4. GRC Brain consistency trial: repeated identical queries measuring
     decision agreement, self-reported confidence, and latency.

Run inside the deployed backend pod (needs its DB + Vertex identity):
  kubectl -n grc-guard exec -i <pod> -c backend -- python3 - < chapter4_harvest.py

Nothing here fabricates numbers: every figure is computed live.
"""
import contextlib
import json
import sys
import time

import database
import models
from main import load_holdout_cases, _evaluate_case_set, DEFAULT_COMPANY_ID

ORG = DEFAULT_COMPANY_ID

# ponytail: 3 queries x 3 runs keeps the Vertex 429 exposure and wall-clock
# (~5 min) tolerable; raise runs for tighter confidence intervals if needed.
BRAIN_QUERIES = [
    "Do we meet Basel III CET1 capital adequacy requirements?",
    "Are all our endpoints covered by EDR sensors?",
    "Do we have a documented incident response plan?",
]
BRAIN_RUNS = 3


def section_benchmark(db):
    holdout = load_holdout_cases()
    results, metrics = _evaluate_case_set(holdout, ORG, db)
    cm = metrics["confusion_matrix"]
    print("## 4.1 Rule-Baseline Benchmark (held-out labelled set)\n")
    print(f"- Cases: {metrics['total_cases']} (held out; rules NOT authored for them)")
    print(f"- Decision accuracy: **{metrics['decision_accuracy']}%**")
    print(f"- Category accuracy: {metrics['category_accuracy']}%")
    print(f"- Precision: {metrics['precision']}  Recall: {metrics['recall']}  F1: {metrics['f1']}")
    print(f"- Confusion matrix: TP={cm['tp']} TN={cm['tn']} FP={cm['fp']} FN={cm['fn']}\n")
    print("| Case | Expected | Predicted | Correct |")
    print("|---|---|---|---|")
    for r in results:
        print(f"| {r['id']} | {r['expected_decision']} | {r['actual_decision']} | {'Y' if r['decision_match'] else 'N'} |")
    print()


def section_connectors(db):
    print("## 4.2 Live Connector Audit Results\n")
    print("| Connector | Status | Last live finding |")
    print("|---|---|---|")
    for i in db.query(models.Integration).filter_by(org_id=ORG).all():
        summary = (i.last_audit_summary or "never synced").replace("|", "/")
        print(f"| {i.name} | {i.status} | {summary} |")
    print()


def section_frameworks(db):
    print("## 4.3 Framework Readiness (live control status)\n")
    print("| Framework | Controls | Passing | Warning | Failing | Readiness |")
    print("|---|---|---|---|---|---|")
    controls = db.query(models.Control).filter_by(org_id=ORG).all()
    for fw in db.query(models.Framework).filter_by(org_id=ORG).all():
        linked = [c for c in controls if fw.id in (c.frameworks or "").split(",")]
        n = len(linked)
        p = sum(1 for c in linked if c.status == "Passing")
        w = sum(1 for c in linked if c.status == "Warning")
        f = n - p - w
        readiness = round(100 * p / n) if n else 0
        print(f"| {fw.name} | {n} | {p} | {w} | {f} | {readiness}% |")
    print()


def section_brain():
    import ai_agents
    print("## 4.4 GRC Brain Consistency Trial (multi-agent, live Vertex AI)\n")
    print(f"Each query run {BRAIN_RUNS}x fresh (no shared history).\n")
    print("| Query | Run | Decision | Confidence | Latency (s) |")
    print("|---|---|---|---|---|")
    agreement = []
    for q in BRAIN_QUERIES:
        decisions = []
        for run in range(1, BRAIN_RUNS + 1):
            start = time.time()
            try:
                # agno's rich console logs to stdout - shunt them to stderr so
                # they don't interleave with the markdown tables.
                with contextlib.redirect_stdout(sys.stderr):
                    brain = ai_agents.create_brain_agent(ORG)
                    resp = brain.run(q)
                d = resp.content
                if hasattr(d, "decision"):
                    decision, conf = d.decision, d.confidence_score
                else:
                    # Exhausted retries surface the provider error as a raw string.
                    decision, conf = "PROVIDER_QUOTA_EXHAUSTED (429)", "-"
            except Exception as e:
                decision, conf = f"ERROR: {e}"[:60], "-"
            latency = round(time.time() - start, 1)
            decisions.append(str(decision)[:40])
            print(f"| {q[:45]} | {run} | {str(decision)[:60]} | {conf} | {latency} |", flush=True)
            time.sleep(15)  # ease Vertex shared-pool contention between runs
        agreement.append((q, len(set(decisions)) == 1))
    print()
    agreed = sum(1 for _, a in agreement if a)
    print(f"Decision agreement: {agreed}/{len(agreement)} queries returned an identical "
          f"decision across all {BRAIN_RUNS} runs.\n")


def main():
    db = database.SessionLocal()
    try:
        print(f"# Chapter 4 — Empirical Validation Results\n")
        print(f"Harvested live from the deployed system on {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}. "
              f"All figures computed at run time; none are hand-entered.\n")
        section_benchmark(db)
        section_connectors(db)
        section_frameworks(db)
    finally:
        db.close()
    section_brain()


if __name__ == "__main__":
    main()
