"""
Basel III / CBEST Ground-Truth Benchmark Cases
Used by /api/evaluation/llm-benchmark to score LLM accuracy per paper Table 2.1.

Each case also carries `error_category`, mapping it onto the paper's Table 2.3
error taxonomy (Domain Understanding / Quantitative Reasoning / Temporal
Awareness / Cross-Border Reconciliation / Standard-Factual) so the benchmark
endpoint can report accuracy broken down the same way the paper does, instead
of a single blended number.
"""

# 12 Basel III + CBEST annotated test cases
BASEL_BENCHMARK = [
    {
        "id": "bb-001",
        "question": "Under Basel III, what is the minimum Common Equity Tier 1 (CET1) capital ratio requirement?",
        "ground_truth": "4.5%",
        "ground_truth_keywords": ["4.5", "4.5%"],
        "category": "Capital Adequacy",
        "perspective": "Standard",
        "error_category": "Quantitative Reasoning"
    },
    {
        "id": "bb-002",
        "question": "What is the Liquidity Coverage Ratio (LCR) minimum requirement under Basel III?",
        "ground_truth": "100%",
        "ground_truth_keywords": ["100", "100%"],
        "category": "Liquidity",
        "perspective": "Standard",
        "error_category": "Quantitative Reasoning"
    },
    {
        "id": "bb-003",
        "question": "Under CBEST, a SWIFT gateway impersonation attack — is this classified as Spoofing (attacker perspective) or Information Disclosure (user perspective)?",
        "ground_truth": "Information Disclosure from the user/victim perspective",
        "ground_truth_keywords": ["information disclosure", "user perspective", "victim"],
        "category": "CBEST Threat Classification",
        "perspective": "User",
        "error_category": "Domain Understanding"
    },
    {
        "id": "bb-004",
        "question": "What is the Basel III Tier 1 leverage ratio minimum requirement?",
        "ground_truth": "3%",
        "ground_truth_keywords": ["3%", "3 percent", "3 per cent"],
        "category": "Leverage Ratio",
        "perspective": "Standard",
        "error_category": "Quantitative Reasoning"
    },
    {
        "id": "bb-005",
        "question": "Under Basel III, what is the Net Stable Funding Ratio (NSFR) minimum requirement?",
        "ground_truth": "100%",
        "ground_truth_keywords": ["100", "100%"],
        "category": "Liquidity",
        "perspective": "Standard",
        "error_category": "Quantitative Reasoning"
    },
    {
        "id": "bb-006",
        "question": "What is the capital conservation buffer requirement under Basel III?",
        "ground_truth": "2.5%",
        "ground_truth_keywords": ["2.5", "2.5%"],
        "category": "Capital Buffers",
        "perspective": "Standard",
        "error_category": "Quantitative Reasoning"
    },
    {
        "id": "bb-007",
        "question": "Under GDPR, what is the maximum time limit for reporting a personal data breach to the supervisory authority?",
        "ground_truth": "72 hours",
        "ground_truth_keywords": ["72 hours", "72-hour", "72h"],
        "category": "GDPR Data Protection",
        "perspective": "Standard",
        "error_category": "Standard Factual"
    },
    {
        "id": "bb-008",
        "question": "Under Basel III, what does the countercyclical capital buffer range between?",
        "ground_truth": "0% and 2.5%",
        "ground_truth_keywords": ["0%", "2.5%", "countercyclical"],
        "category": "Capital Buffers",
        "perspective": "Standard",
        "error_category": "Quantitative Reasoning"
    },
    {
        "id": "bb-009",
        "question": "In the context of AML, what does KYC stand for and what is its primary purpose?",
        "ground_truth": "Know Your Customer; to verify the identity of clients and assess potential risks",
        "ground_truth_keywords": ["know your customer", "identity", "risk"],
        "category": "AML/KYC",
        "perspective": "Standard",
        "error_category": "Standard Factual"
    },
    {
        "id": "bb-010",
        "question": "Under SOC 2, which Trust Service Criterion covers logical and physical access controls?",
        "ground_truth": "CC6 — Logical and Physical Access Controls",
        "ground_truth_keywords": ["cc6", "cc 6", "access control", "logical"],
        "category": "SOC 2 Access Control",
        "perspective": "Standard",
        "error_category": "Standard Factual"
    },
    {
        "id": "bb-011",
        "question": "A US branch of an EU-headquartered bank is subject to both EU CRD/CRR and the US Basel III Final Rule for its local operations. As a general prudential-supervision principle, whose rules govern the branch's local capital/liquidity compliance?",
        "ground_truth": "The host jurisdiction's (US) rules govern local branch operations, alongside home-country consolidated supervision",
        "ground_truth_keywords": ["host", "local", "us basel iii final rule", "consolidated"],
        "category": "Cross-Jurisdictional Reconciliation",
        "perspective": "Standard",
        "error_category": "Cross-Border Reconciliation"
    },
    {
        "id": "bb-012",
        "question": "The Basel Committee's most recent comprehensive finalization of the Basel III framework (\"Basel III: Finalising post-crisis reforms\", covering the credit-risk and operational-risk standardized approaches) was published in which year?",
        "ground_truth": "2017",
        "ground_truth_keywords": ["2017"],
        "category": "Regulatory Temporal Awareness",
        "perspective": "Standard",
        "error_category": "Temporal Awareness"
    },
]

# Adversarial test cases — designed to probe semantic blind spots
ADVERSARIAL_CASES = [
    {
        "id": "adv-001",
        "input": "Customer initiated wire transfer for 'consulting services' to offshore account in jurisdiction with no tax treaty",
        "expected_flag": "AML_RISK",
        "adversarial_technique": "euphemism_substitution",
        "description": "Legitimate-sounding reason masking potential AML risk"
    },
    {
        "id": "adv-002",
        "input": "Routing ID 0000 applied to all overnight batch transactions for performance optimization",
        "expected_flag": "SWIFT_PRIVILEGE_ESCALATION",
        "adversarial_technique": "obfuscated_routing",
        "description": "False routing ID disguised as operational optimization"
    },
    {
        "id": "adv-003",
        "input": "User account temporarily elevated to administrator for quarterly system maintenance",
        "expected_flag": "PRIVILEGE_ESCALATION",
        "adversarial_technique": "temporal_justification",
        "description": "Privilege escalation disguised as maintenance activity"
    },
    {
        "id": "adv-004",
        "input": "CET1 ratio reported as 4.3% after applying transitional arrangements",
        "expected_flag": "CAPITAL_ADEQUACY_VIOLATION",
        "adversarial_technique": "transitional_loophole",
        "description": "Below 4.5% minimum disguised behind transitional language"
    },
]
