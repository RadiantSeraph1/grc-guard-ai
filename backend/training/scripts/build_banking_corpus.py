"""Assemble the banking-domain corpus for Phase 1 fine-tuning (LoRA/QLoRA).

Targets the paper's central claim directly: LLMs misclassify CBEST threats
because they confuse the ATTACKER's perspective (what the adversary did -
Spoofing, Tampering) with the USER/VICTIM's perspective (what the adversary
caused - Information Disclosure, data exposure). Every perspective-pair example
below is the SAME scenario, labeled once from each viewpoint, so a model trained
on this corpus sees the distinction explicitly rather than inferring it.

Four honestly-provenanced sources, each tagged in `source`:

  perspective_cbest      hand-authored, viewpoint-encoded CBEST scenarios
                         (real examples, written for this thesis)
  regulatory_paraphrase  original paraphrased restatements of public Basel III /
                         GDPR / SOC 2 thresholds (NOT verbatim BCBS/EU text -
                         avoids reproducing copyrighted regulatory documents)
  nist_800_53            reused from build_oscal_controls.py's already-committed
                         data/processed/nist_800_53_controls.jsonl (real, public domain)
  asokore                reused from the user's own ASOKORE network-scan export
                         (authorized, see below) - two sub-sources:
                           - asokore_vuln: the real rows with vulnerability_description
                             + vulnerability_solution columns (label=FAIL, real remediation text)
                           - asokore_asset_weak: weak-supervision from the OTHER 33 CSVs,
                             which are runzero "asset query" exports - each CSV's FILENAME
                             is itself a named security condition (e.g. "Services with
                             Expired TLS Certificates"), so every row in it is a real,
                             filename-labeled instance of that condition. Same technique
                             gen_compliance_labels.py already uses for Checkov findings:
                             the label comes from what generated the row, not a guess.
                             These are one-sided (FAIL-only) weak labels - documented as
                             such, never treated as gold.

Run:
  python backend/training/scripts/build_banking_corpus.py
  python backend/training/scripts/build_banking_corpus.py --asokore-dir "C:/path/to/ASOKORE"
  python backend/training/scripts/build_banking_corpus.py --no-asokore   # portable / CI-safe

Output: backend/training/data/processed/banking_corpus.jsonl
"""
from __future__ import annotations

import argparse
import csv
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import record, write_jsonl, PROCESSED_DIR  # noqa: E402

# No hardcoded personal path: this is local, user-specific data. Set
# ASOKORE_DATA_DIRS (comma-separated) or pass --asokore-dir explicitly.
DEFAULT_ASOKORE_DIRS = [d for d in os.environ.get("ASOKORE_DATA_DIRS", "").split(",") if d.strip()]


# ---------------------------------------------------------------------------
# Source 1: perspective-labeled CBEST scenarios (hand-authored, real)
# ---------------------------------------------------------------------------
# Each tuple: (scenario, attacker_label, attacker_rationale, user_label, user_rationale)
PERSPECTIVE_SCENARIOS = [
    (
        "A message purporting to originate from the core banking system's SWIFT "
        "gateway is actually sent by an unauthorized host that has copied the "
        "gateway's identity and routing headers.",
        "Spoofing",
        "From the ATTACKER's perspective, this is Spoofing: the adversary's action is "
        "impersonating a trusted system identity to have their message accepted as genuine.",
        "Information Disclosure",
        "From the USER/VICTIM's perspective, this is Information Disclosure: what the bank "
        "experiences is that its internal routing and gateway identity details were exposed "
        "and used against it, regardless of the attacker's technique.",
    ),
    (
        "A batch settlement file's routing ID field is silently overwritten in "
        "transit so overnight transfers are redirected to a different clearing account.",
        "Tampering",
        "From the ATTACKER's perspective, this is Tampering: the adversary's action is "
        "unauthorized modification of data (the routing ID) in transit.",
        "Information Disclosure",
        "From the USER/VICTIM's perspective, this is Information Disclosure combined with "
        "financial loss exposure: the bank's operational routing logic and settlement flow "
        "were exposed and exploited, which is what the victim organization actually experiences.",
    ),
    (
        "An operator account is granted temporary administrator rights for "
        "'quarterly maintenance' and those rights are never revoked afterward.",
        "Elevation of Privilege",
        "From the ATTACKER's (or malicious-insider's) perspective, this is Elevation of "
        "Privilege: the action taken is acquiring capabilities beyond the account's normal scope.",
        "Repudiation",
        "From the USER/VICTIM's (auditor's) perspective, this is a Repudiation risk: without "
        "a time-boxed grant and revocation log, the organization cannot later prove who held "
        "privileged access when, undermining accountability.",
    ),
    (
        "A denial-of-service condition on the payment gateway causes legitimate "
        "SWIFT messages to be dropped during a high-volume settlement window.",
        "Denial of Service",
        "From the ATTACKER's perspective (if intentional), this is Denial of Service: the "
        "action is degrading availability of the messaging channel.",
        "Denial of Service",
        "From the USER/VICTIM's perspective, this remains Denial of Service too - one of the "
        "few CBEST categories where attacker-action and victim-impact coincide, since the harm "
        "IS the unavailability itself, not a secondary consequence.",
    ),
    (
        "A teller's credentials are reused to authorize a wire transfer outside "
        "their normal branch and business hours, with no step-up authentication challenge.",
        "Spoofing",
        "From the ATTACKER's perspective, this is Spoofing: the adversary's action is using "
        "stolen credentials to impersonate the legitimate teller's identity.",
        "Elevation of Privilege",
        "From the USER/VICTIM's (bank's) perspective, this manifests as Elevation of Privilege "
        "risk: the control gap that let it happen is insufficient step-up authentication for "
        "anomalous-context transactions, which is the control the bank must remediate.",
    ),
    (
        "A vendor integration writes unmasked customer account numbers to a shared "
        "log file that is retained beyond the documented retention period.",
        "Information Disclosure",
        "From the ATTACKER's perspective there is no attacker action here - this is a "
        "configuration/process failure, not an adversarial technique, so CBEST's "
        "attacker-action framing does not apply cleanly.",
        "Information Disclosure",
        "From the USER/VICTIM's perspective this is squarely Information Disclosure and a "
        "GDPR Art. 5(1)(e) storage-limitation violation: customer PII was exposed beyond its "
        "authorized retention window.",
    ),
]


def build_perspective_examples():
    rows = []
    for scenario, atk_label, atk_rationale, usr_label, usr_rationale in PERSPECTIVE_SCENARIOS:
        rows.append(record(
            text=f"Perspective: Attacker\nScenario: {scenario}",
            source="perspective_cbest",
            framework="basel-iii",
            control_id=f"CBEST-{atk_label.upper().replace(' ', '-')}",
            label=None,
            rationale=atk_rationale,
            extra={"perspective": "Attacker", "cbest_category": atk_label, "scenario": scenario},
        ))
        rows.append(record(
            text=f"Perspective: User\nScenario: {scenario}",
            source="perspective_cbest",
            framework="basel-iii",
            control_id=f"CBEST-{usr_label.upper().replace(' ', '-')}",
            label=None,
            rationale=usr_rationale,
            extra={"perspective": "User", "cbest_category": usr_label, "scenario": scenario},
        ))
    return rows


# ---------------------------------------------------------------------------
# Source 2: regulatory threshold paraphrases (original text, COMPLIANT/VIOLATION
# pairs). Figures are public, well-known Basel III / GDPR / SOC 2 minimums -
# these sentences are our own restatement, not reproduced regulator text.
# ---------------------------------------------------------------------------
REGULATORY_RULES = [
    ("Basel III", "CET1 capital ratio", 4.5, "%", "at least", "BASEL-CET1-01"),
    ("Basel III", "Tier 1 capital ratio (incl. conservation buffer)", 7.0, "%", "at least", "BASEL-CET1-01"),
    ("Basel III", "Liquidity Coverage Ratio (LCR)", 100.0, "%", "at least", "BASEL-LCR-01"),
    ("Basel III", "Net Stable Funding Ratio (NSFR)", 100.0, "%", "at least", "BASEL-NSFR-01"),
    ("Basel III", "Tier 1 leverage ratio", 3.0, "%", "at least", "BASEL-LEV-01"),
    ("Basel III", "capital conservation buffer", 2.5, "%", "at least", "BASEL-CCB-01"),
]
BOUNDARY_OFFSETS = [-0.5, 0.0, 0.5]  # below, at, above the threshold


def build_regulatory_examples():
    rows = []
    for framework, metric, threshold, unit, rel, control_id in REGULATORY_RULES:
        for offset in BOUNDARY_OFFSETS:
            value = round(threshold + offset, 2)
            compliant = value >= threshold
            text = f"Reported {metric} is {value}{unit}."
            rationale = (
                f"{metric} of {value}{unit} {'meets' if compliant else 'falls below'} the "
                f"{framework} minimum requirement of {rel} {threshold}{unit}."
            )
            rows.append(record(
                text=text,
                source="regulatory_paraphrase",
                framework=framework.lower().replace(" ", "-"),
                control_id=control_id,
                label="PASS" if compliant else "FAIL",
                rationale=rationale,
                extra={"metric": metric, "value": value, "threshold": threshold},
            ))
    # A few original-text GDPR / SOC 2 process rules (non-numeric), paired PASS/FAIL.
    process_rules = [
        ("A personal-data breach was reported to the supervisory authority 40 hours after discovery.",
         "PASS", "gdpr", "GDPR-BREACH-01",
         "40 hours is within the GDPR Art. 33 72-hour breach-notification deadline."),
        ("A personal-data breach was reported to the supervisory authority 96 hours after discovery.",
         "FAIL", "gdpr", "GDPR-BREACH-01",
         "96 hours exceeds the GDPR Art. 33 72-hour breach-notification deadline."),
        ("All privileged administrator accounts require a second authentication factor to sign in.",
         "PASS", "soc-2", "SOC2-MFA-01",
         "Universal MFA enforcement on privileged accounts satisfies SOC 2 logical access control expectations."),
        ("Multi-factor authentication is optional and disabled by default for administrator accounts.",
         "FAIL", "soc-2", "SOC2-MFA-01",
         "Optional/disabled MFA on privileged accounts is a SOC 2 logical access control gap."),
    ]
    for text, label, framework, control_id, rationale in process_rules:
        rows.append(record(text=text, source="regulatory_paraphrase", framework=framework,
                            control_id=control_id, label=label, rationale=rationale))
    return rows


# ---------------------------------------------------------------------------
# Source 3: reuse the already-committed NIST 800-53 catalog (real, public domain)
# ---------------------------------------------------------------------------
def load_nist_800_53():
    import json
    path = os.path.join(PROCESSED_DIR, "nist_800_53_controls.jsonl")
    if not os.path.exists(path):
        print(f"  (skip) {path} not found - run build_oscal_controls.py first.")
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


# ---------------------------------------------------------------------------
# Source 4: ASOKORE - the user's own network-scan export (authorized).
# ---------------------------------------------------------------------------
def _condition_from_filename(path: str) -> str:
    name = os.path.splitext(os.path.basename(path))[0]
    return name.strip()


def build_asokore_examples(asokore_dirs):
    vuln_rows, weak_rows = [], []
    for d in asokore_dirs:
        if not os.path.isdir(d):
            print(f"  (skip) ASOKORE dir not found: {d}")
            continue
        for path in glob.glob(os.path.join(d, "*.csv")):
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    reader = csv.DictReader(f)
                    fieldnames = [ (fn or "").lstrip("﻿") for fn in (reader.fieldnames or []) ]
                    has_vuln_cols = "vulnerability_description" in fieldnames and "vulnerability_solution" in fieldnames
                    condition = _condition_from_filename(path)
                    for row in reader:
                        row = {(k or "").lstrip("﻿"): v for k, v in row.items()}
                        if has_vuln_cols:
                            desc = (row.get("vulnerability_description") or "").strip()
                            sol = (row.get("vulnerability_solution") or "").strip()
                            vname = (row.get("vulnerability_name") or "").strip()
                            if desc and sol:
                                vuln_rows.append(record(
                                    text=f"Vulnerability: {vname}\n\nDescription: {desc}",
                                    source="asokore_vuln",
                                    framework=None,
                                    control_id=row.get("vulnerability_vuln_id") or row.get("vulnerability_category"),
                                    label="FAIL",
                                    rationale=sol,
                                    extra={"cve": row.get("vulnerability_cve"),
                                           "severity": row.get("vulnerability_severity")},
                                ))
                        else:
                            addr = row.get("service_address") or row.get("address") or ""
                            proto = row.get("service_protocol") or ""
                            port = row.get("service_port") or ""
                            if not addr:
                                continue
                            weak_rows.append(record(
                                text=f"Asset {addr} runs {proto} service on port {port}, "
                                     f"matching runzero condition: {condition}.",
                                source="asokore_asset_weak",
                                framework=None,
                                control_id=None,
                                label="FAIL",  # one-sided weak label - see module docstring
                                rationale=f"Filename-derived label (weak supervision): {condition}.",
                                extra={"weak_label_source": condition, "org": row.get("organization")},
                            ))
            except Exception as e:
                print(f"  (error reading {path}: {e})")
    return vuln_rows, weak_rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asokore-dir", action="append", default=None,
                    help="ASOKORE CSV directory (repeatable). Defaults to ASOKORE_DATA_DIRS "
                         "(comma-separated env var); pass --no-asokore to skip entirely.")
    ap.add_argument("--no-asokore", action="store_true", help="Skip the ASOKORE source (portable/CI-safe).")
    ap.add_argument("--out", default=os.path.join(PROCESSED_DIR, "banking_corpus.jsonl"))
    args = ap.parse_args()

    print("1. Perspective-labeled CBEST scenarios (hand-authored)...")
    perspective_rows = build_perspective_examples()
    print(f"   -> {len(perspective_rows)} rows")

    print("2. Regulatory threshold paraphrases (Basel III / GDPR / SOC 2)...")
    regulatory_rows = build_regulatory_examples()
    print(f"   -> {len(regulatory_rows)} rows")

    print("3. NIST 800-53 catalog (reused, already committed)...")
    nist_rows = load_nist_800_53()
    print(f"   -> {len(nist_rows)} rows")

    vuln_rows, weak_rows = [], []
    if not args.no_asokore:
        print("4. ASOKORE (authorized user data)...")
        asokore_dirs = args.asokore_dir or DEFAULT_ASOKORE_DIRS
        vuln_rows, weak_rows = build_asokore_examples(asokore_dirs)
        print(f"   -> {len(vuln_rows)} real vulnerability rows, {len(weak_rows)} filename-weak-labeled asset rows")
    else:
        print("4. ASOKORE skipped (--no-asokore).")

    all_rows = perspective_rows + regulatory_rows + nist_rows + vuln_rows + weak_rows
    n = write_jsonl(args.out, all_rows)
    print(f"\nWrote {n} total rows -> {args.out}")
    print("By source:")
    from collections import Counter
    counts = Counter(r["source"] for r in all_rows)
    for src, cnt in counts.most_common():
        print(f"  {src}: {cnt}")


if __name__ == "__main__":
    main()
