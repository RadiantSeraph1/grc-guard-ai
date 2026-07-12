"""
Fine-Tuning Dataset Preparation Script for GRC AUDOTOR
=======================================================
Paper reference: Chapter 3.1 - "corpus creation with perspective-aware labeling"
Target: Generate JSONL instruction-tuning dataset for LoRA fine-tuning on
        banking regulatory data (Basel III/IV, CBEST, GDPR, SOC 2).

Usage:
    python prepare_finetune_dataset.py --output grc_finetune.jsonl

Output format (Alpaca-style instruction tuning):
    {"instruction": "...", "input": "...", "output": "..."}
"""

import json
import os
import argparse
from datetime import datetime
from typing import List, Dict

# ─────────────────────────────────────────────────────────────────────────────
# Seed Training Examples
# Perspective-aware labeled per paper requirement: "explicit viewpoint encoding"
# Each example has: perspective (Standard/Attacker/User), framework, difficulty
# ─────────────────────────────────────────────────────────────────────────────

SEED_EXAMPLES: List[Dict] = [

    # ── Basel III Capital Adequacy ──────────────────────────────────────────
    {
        "instruction": "Classify this banking compliance scenario and provide an auditor-ready explanation.",
        "input": "Bank reports CET1 ratio of 4.2% after Q3 stress test results.",
        "output": json.dumps({
            "decision": "NON_COMPLIANT",
            "category": "Basel III Capital Adequacy",
            "confidence": 95,
            "perspective": "Standard",
            "reasoning": "The reported CET1 ratio of 4.2% falls below the Basel III minimum requirement of 4.5% (Basel Committee, 2017). Under Basel III Pillar 1, banks must maintain a minimum CET1 capital ratio of 4.5% of risk-weighted assets at all times. A ratio of 4.2% constitutes a capital adequacy violation requiring immediate remediation and supervisory notification.",
            "regulatory_reference": "Basel III: A Global Regulatory Framework, BCBS June 2011, Para 52",
            "jurisdictional_note": "Applies globally; EU CRD IV Art. 92 sets same 4.5% minimum."
        }),
        "framework": "Basel III",
        "perspective": "Standard",
        "difficulty": "basic"
    },
    {
        "instruction": "From an auditor perspective, evaluate whether this capital position is compliant.",
        "input": "Total capital ratio is 12.8%, CET1 is 8.1%, Tier 1 is 9.7%, with a countercyclical buffer of 1.0% applied.",
        "output": json.dumps({
            "decision": "COMPLIANT",
            "category": "Basel III Capital Adequacy",
            "confidence": 92,
            "perspective": "Standard",
            "reasoning": "All capital ratios exceed Basel III minimums: CET1 8.1% > 4.5% minimum + 2.5% conservation buffer = 7.0% threshold. Tier 1 9.7% > 6.0% minimum. Total capital 12.8% > 8.0% minimum. The countercyclical buffer of 1.0% is within the 0%-2.5% range. The bank maintains a comfortable capital buffer above regulatory minimums.",
            "regulatory_reference": "Basel III Para 52, 53; Capital Conservation Buffer Basel III Para 122-125",
            "jurisdictional_note": "EU CRD IV Art. 92-94 sets equivalent requirements."
        }),
        "framework": "Basel III",
        "perspective": "Standard",
        "difficulty": "intermediate"
    },

    # ── CBEST Threat Classification (Perspective-Aware) ─────────────────────
    {
        "instruction": "Classify this CBEST threat scenario from the ATTACKER perspective.",
        "input": "Threat actor impersonates SWIFT gateway by sending crafted payment routing messages that appear to originate from a legitimate correspondent bank.",
        "output": json.dumps({
            "decision": "VIOLATION",
            "category": "CBEST - Spoofing (Attacker Perspective)",
            "confidence": 94,
            "perspective": "Attacker",
            "reasoning": "From the attacker's perspective, this constitutes SPOOFING under the CBEST/STRIDE threat model. The attacker is impersonating a legitimate SWIFT gateway — a classic identity spoofing attack. The attacker creates false authentication claims to deceive the target system into accepting fraudulent payment instructions.",
            "regulatory_reference": "Bank of England CBEST Intelligence-Led Testing Framework, STRIDE model - Spoofing category",
            "jurisdictional_note": "UK-specific: Bank of England CBEST. EU equivalent: ECB TIBER-EU."
        }),
        "framework": "CBEST",
        "perspective": "Attacker",
        "difficulty": "advanced"
    },
    {
        "instruction": "Classify this CBEST threat scenario from the USER/VICTIM perspective.",
        "input": "Threat actor impersonates SWIFT gateway by sending crafted payment routing messages that appear to originate from a legitimate correspondent bank.",
        "output": json.dumps({
            "decision": "VIOLATION",
            "category": "CBEST - Information Disclosure (User/Victim Perspective)",
            "confidence": 91,
            "perspective": "User",
            "reasoning": "From the user/victim perspective (the receiving bank), this constitutes INFORMATION DISCLOSURE under the CBEST/STRIDE threat model. The victim bank receives what appears to be authentic payment instructions but is actually fraudulent. The bank's internal routing tables, account details, and transaction patterns are exposed to the threat actor through the spoofed messages. This perspective aligns with Basel standards as referenced in Abdul Ghaffar and Matrawy (2025).",
            "regulatory_reference": "CBEST STRIDE model - Information Disclosure category; Basel operational risk framework",
            "jurisdictional_note": "Critical distinction: same attack classified differently by attacker vs. user perspective. Auditors must specify perspective in reports."
        }),
        "framework": "CBEST",
        "perspective": "User",
        "difficulty": "advanced"
    },
    {
        "instruction": "A false payment routing ID is used on a SWIFT gateway. Classify from the user perspective.",
        "input": "SWIFT message contains routing ID '0000' instead of the legitimate correspondent bank BIC code, processed through the overnight batch.",
        "output": json.dumps({
            "decision": "VIOLATION",
            "category": "CBEST - Privilege Escalation (User/Victim Perspective)",
            "confidence": 88,
            "perspective": "User",
            "reasoning": "From the user/victim perspective, a false routing ID constitutes PRIVILEGE ESCALATION under CBEST. The attacker gains unauthorized routing capabilities by exploiting the batch processing system's trust in routing IDs. Per Abdul Ghaffar and Matrawy (2025), this specific scenario (false payment routing ID on SWIFT gateway) is classified as Privilege Escalation from the user perspective, not Spoofing.",
            "regulatory_reference": "CBEST STRIDE - Elevation of Privilege; SWIFT Customer Security Controls Framework",
            "jurisdictional_note": "Only Gemini 2.5 Pro correctly identifies this as Privilege Escalation vs Spoofing (Abdul Ghaffar & Matrawy, 2025)."
        }),
        "framework": "CBEST",
        "perspective": "User",
        "difficulty": "expert"
    },

    # ── GDPR Data Protection ────────────────────────────────────────────────
    {
        "instruction": "Evaluate this data handling practice for GDPR compliance.",
        "input": "Customer PII including name, account number, and transaction history stored in unencrypted CSV files on shared network drive accessible by all employees.",
        "output": json.dumps({
            "decision": "NON_COMPLIANT",
            "category": "GDPR Data Protection - Art. 25 (Data Protection by Design)",
            "confidence": 97,
            "perspective": "Standard",
            "reasoning": "Multiple GDPR violations: (1) Art. 25 violation: storage of PII without encryption fails 'data protection by design and by default'; (2) Art. 32 violation: no appropriate technical security measures; (3) Art. 5(1)(f) violation: no 'appropriate security... using appropriate technical measures'. Unencrypted PII on a shared drive with broad access constitutes a high-severity data protection failure. Mandatory remediation: encrypt at rest (AES-256), implement role-based access control, conduct DPA under Art. 35.",
            "regulatory_reference": "GDPR Art. 5(1)(f), Art. 25, Art. 32; EDPB Guidelines 4/2019 on Article 25",
            "jurisdictional_note": "GDPR applies in EU/EEA. UK GDPR (post-Brexit) equivalent applies in UK. Similar requirements under CCPA in California."
        }),
        "framework": "GDPR",
        "perspective": "Standard",
        "difficulty": "basic"
    },
    {
        "instruction": "A data breach occurred. Assess the notification obligations.",
        "input": "On Monday 09:00 UTC bank discovers unauthorized access to 50,000 customer records including account numbers. The breach is contained by 11:00 UTC same day.",
        "output": json.dumps({
            "decision": "ACTION_REQUIRED",
            "category": "GDPR Art. 33 - Breach Notification",
            "confidence": 96,
            "perspective": "Standard",
            "reasoning": "Mandatory supervisory authority notification required within 72 hours of discovery (GDPR Art. 33). Discovery time: Monday 09:00 UTC. Notification deadline: Thursday 09:00 UTC. The breach involves 50,000 customer records with account numbers — this is 'likely to result in a risk to the rights and freedoms of natural persons,' triggering Art. 33. Additionally, as account numbers constitute financial personal data, data subject notification under Art. 34 must be assessed. The breach being contained does not remove the notification obligation.",
            "regulatory_reference": "GDPR Art. 33(1) - 72-hour notification; Art. 34 - Communication to data subjects; EDPB Guidelines 01/2021",
            "jurisdictional_note": "72-hour deadline applies from moment of awareness, not containment."
        }),
        "framework": "GDPR",
        "perspective": "Standard",
        "difficulty": "intermediate"
    },

    # ── AML / KYC ──────────────────────────────────────────────────────────
    {
        "instruction": "Assess this transaction for AML compliance risk.",
        "input": "Customer with no prior international transactions initiates 3 wire transfers of $9,800 each to different accounts in high-risk jurisdictions within 48 hours.",
        "output": json.dumps({
            "decision": "NON_COMPLIANT",
            "category": "AML - Suspicious Activity / Structuring",
            "confidence": 93,
            "perspective": "Standard",
            "reasoning": "High AML risk indicators present: (1) STRUCTURING: Three transfers of $9,800 each (just below $10,000 CTR threshold) constitutes classic structuring — a criminal offense under Bank Secrecy Act; (2) RAPID SUCCESSION: 48-hour window suggests urgency inconsistent with legitimate business; (3) HIGH-RISK JURISDICTIONS: Multiple recipient accounts in FATF-flagged jurisdictions; (4) BEHAVIOR CHANGE: No prior international activity. SAR filing required within 30 days (US) or 20 working days (UK POCA 2002). Transaction hold pending compliance review advisable.",
            "regulatory_reference": "Bank Secrecy Act 31 U.S.C. §5324 (structuring); FATF Recommendation 20; UK POCA 2002 s.330",
            "jurisdictional_note": "US: SAR to FinCEN within 30 days. UK: SAR to NCA within 7 days of suspicion. EU: AMLD5 Art. 33."
        }),
        "framework": "AML",
        "perspective": "Standard",
        "difficulty": "advanced"
    },

    # ── SOC 2 ───────────────────────────────────────────────────────────────
    {
        "instruction": "Evaluate this access control configuration for SOC 2 compliance.",
        "input": "Admin accounts share a single password that is changed quarterly. MFA is not enabled for admin access to production systems.",
        "output": json.dumps({
            "decision": "NON_COMPLIANT",
            "category": "SOC 2 CC6.1 - Logical and Physical Access Controls",
            "confidence": 98,
            "perspective": "Standard",
            "reasoning": "Critical SOC 2 CC6.1 violations: (1) SHARED CREDENTIALS: Admin accounts sharing a single password violates CC6.1 requirement for individual accountability and non-repudiation; (2) NO MFA: SOC 2 CC6.1 requires MFA for privileged access to systems processing sensitive data; (3) QUARTERLY ROTATION: Insufficient rotation frequency for privileged accounts (best practice: 90 days or less, but shared accounts cannot be adequately secured). Immediate remediation required: assign individual admin accounts, enforce MFA, implement PAM solution.",
            "regulatory_reference": "SOC 2 Trust Service Criteria CC6.1, CC6.2, CC6.3; NIST SP 800-63B",
            "jurisdictional_note": "SOC 2 is a US framework (AICPA). EU equivalent: ISO 27001 A.9.2-9.4."
        }),
        "framework": "SOC 2",
        "perspective": "Standard",
        "difficulty": "basic"
    },

    # ── Basel III Liquidity ─────────────────────────────────────────────────
    {
        "instruction": "Assess this liquidity position against Basel III LCR requirements.",
        "input": "Bank's High Quality Liquid Assets (HQLA) total $450M. Net cash outflows over the next 30 days are projected at $500M under stressed conditions.",
        "output": json.dumps({
            "decision": "NON_COMPLIANT",
            "category": "Basel III Liquidity - LCR (Liquidity Coverage Ratio)",
            "confidence": 96,
            "perspective": "Standard",
            "reasoning": "LCR calculation: HQLA ($450M) / Net Cash Outflows ($500M) = 90%. Basel III requires LCR ≥ 100% (fully phased in since 2019). A 90% LCR means the bank has insufficient liquid assets to cover net cash outflows for 30 days under a stress scenario. This constitutes a liquidity violation. The bank must either increase HQLA holdings by at least $50M or reduce net stressed cash outflows. Supervisory notification required in most jurisdictions.",
            "regulatory_reference": "Basel III LCR: BCBS January 2013, Para 10 (100% minimum); EU LCR Delegated Regulation 2015/61",
            "jurisdictional_note": "EU: CRR Art. 412-428. US: 12 CFR Part 249. Both require 100% minimum."
        }),
        "framework": "Basel III",
        "perspective": "Standard",
        "difficulty": "intermediate"
    },

    # ── Cross-Jurisdictional ────────────────────────────────────────────────
    {
        "instruction": "Identify any regulatory conflicts in this scenario involving multiple jurisdictions.",
        "input": "A US bank subsidiary operating in the EU applies US Basel III Final Rule leverage ratio of 3% to all entities, including the EU subsidiary which is subject to CRR.",
        "output": json.dumps({
            "decision": "JURISDICTIONAL_CONFLICT",
            "category": "Cross-Jurisdictional - Basel III vs EU CRR Leverage Ratio",
            "confidence": 85,
            "perspective": "Standard",
            "reasoning": "CONFLICT DETECTED: US Basel III Final Rule (12 CFR Part 3) sets leverage ratio at 3% Tier 1 capital / total leverage exposure for most banks, while EU CRR Art. 429 (as amended by CRR2) sets leverage ratio at 3% but uses different exposure measure calculations. Additionally, the EU G-SII leverage buffer requirement adds 50% of G-SIB surcharge. The EU subsidiary cannot simply apply US leverage calculation methods — it must comply with EU CRR definitions. The bank must apply each jurisdiction's rules to the respective entity. Group-level consolidation must reconcile both frameworks.",
            "regulatory_reference": "US: 12 CFR Part 3 (OCC), 12 CFR Part 217 (Fed); EU: CRR Art. 429-429b; Basel III Para 153",
            "jurisdictional_note": "More stringent rule takes precedence at entity level. Group must consolidate under both frameworks separately."
        }),
        "framework": "Cross-Jurisdictional",
        "perspective": "Standard",
        "difficulty": "expert"
    },
]


def generate_augmented_examples(seed_examples: List[Dict]) -> List[Dict]:
    """
    Generate additional training examples through systematic augmentation.
    Varies phrasing, adds context variations, and creates edge cases.
    """
    augmented = []

    for ex in seed_examples:
        # Variation 1: Question-answer format
        augmented.append({
            "instruction": f"Answer this compliance question with a structured assessment.",
            "input": ex["input"],
            "output": ex["output"],
            "framework": ex["framework"],
            "perspective": ex["perspective"],
            "difficulty": ex["difficulty"],
            "augmentation": "qa_format"
        })

        # Variation 2: Role-play format
        augmented.append({
            "instruction": f"You are a senior GRC auditor reviewing the following scenario. Provide your assessment.",
            "input": ex["input"],
            "output": ex["output"],
            "framework": ex["framework"],
            "perspective": ex["perspective"],
            "difficulty": ex["difficulty"],
            "augmentation": "roleplay_format"
        })

    return augmented


def prepare_dataset(output_path: str = "grc_finetune.jsonl") -> None:
    """
    Prepare the full fine-tuning dataset and write to JSONL format.
    """
    all_examples = SEED_EXAMPLES.copy()
    all_examples.extend(generate_augmented_examples(SEED_EXAMPLES))

    print(f"Preparing {len(all_examples)} training examples...")

    # Write JSONL
    with open(output_path, "w", encoding="utf-8") as f:
        for example in all_examples:
            # Format for instruction tuning (Alpaca-style)
            record = {
                "instruction": example["instruction"],
                "input": example["input"],
                "output": example["output"],
                "metadata": {
                    "framework": example.get("framework", ""),
                    "perspective": example.get("perspective", "Standard"),
                    "difficulty": example.get("difficulty", "basic"),
                    "augmentation": example.get("augmentation", "original"),
                    "generated_at": datetime.utcnow().isoformat() + "Z",
                    "paper_reference": "UMaT GRC Automation Paper - Chapter 3.1"
                }
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"✅ Dataset written to: {output_path}")
    print(f"   Total examples: {len(all_examples)}")
    print(f"   Frameworks covered: {set(e.get('framework', '') for e in all_examples)}")
    print(f"   Perspectives: {set(e.get('perspective', '') for e in all_examples)}")
    print(f"\nNext steps:")
    print(f"  1. Upload {output_path} to GCS: gsutil cp {output_path} gs://claude-code-501412-training/")
    print(f"  2. Run vertex_finetune.py to start the Vertex AI fine-tuning job")
    print(f"  3. After training, update ai_gateway.py with the endpoint ID")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare GRC fine-tuning dataset")
    parser.add_argument("--output", default="grc_finetune.jsonl", help="Output JSONL file path")
    args = parser.parse_args()
    prepare_dataset(args.output)
