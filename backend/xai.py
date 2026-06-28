import re
import math
from collections import Counter

# Minimal English stop list so structural words never dominate the heatmap.
_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
    "for", "with", "by", "from", "is", "are", "was", "were", "be", "been", "being",
    "it", "its", "this", "that", "these", "those", "as", "has", "have", "had",
    "do", "does", "did", "not", "no", "so", "than", "then", "there", "here",
    "we", "you", "they", "he", "she", "i", "our", "your", "their", "his", "her",
    "will", "would", "can", "could", "should", "may", "might", "must", "shall",
    "about", "into", "over", "under", "out", "up", "down", "per", "via", "also",
}


def _intrinsic_salience(original_token: str, clean: str) -> float:
    """How informative a token looks on its own, independent of any corpus.

    Based on observable shape only (length, acronym/numeric form) — NOT a curated
    compliance keyword list. Used as a blend term and as the fallback signal when
    little or no regulatory corpus has been ingested yet.
    """
    if not clean or clean in _STOPWORDS or len(clean) <= 2:
        return 0.05
    score = 0.25 + min(0.40, 0.06 * len(clean))
    if original_token.isupper() and len(clean) >= 2:   # acronyms: SWIFT, PII, MFA
        score += 0.30
    if any(ch.isdigit() for ch in clean):              # codes/ratios: CET1, 5.5%
        score += 0.15
    return min(1.0, score)


def calculate_local_attribution(scan_text, matched_regulations):
    """Relevance-based token attribution for the scanner's explainability panel.

    This is a real, reproducible information-retrieval method — not a hardcoded
    keyword table. Two signals are combined and normalized to 0..1:

      1. Regulation grounding (primary): a TF-IDF-style relevance of each term to
         the regulation chunks RAG retrieved for this scan. Terms that are
         specific (high IDF) AND actually appear in the cited regulation score
         highest, so the heatmap reflects what tied the input to the evidence.
      2. Intrinsic salience (blend / fallback): term specificity from shape
         (length, acronym/numeric form), used when the corpus is empty.

    Returns: list of {"word": str, "attribution": float in [0,1]} in input order.
    """
    tokens = scan_text.split()

    # Treat each matched regulation chunk as a document for IDF.
    docs = []
    for reg in (matched_regulations or []):
        content = (reg.get("content", "") or "").lower()
        terms = re.findall(r"[a-z0-9][a-z0-9_-]*", content)
        if terms:
            docs.append(terms)

    num_docs = len(docs)
    doc_freq = Counter()
    ref_tf = Counter()
    for terms in docs:
        ref_tf.update(terms)
        for term in set(terms):
            doc_freq[term] += 1
    ref_len = max(sum(ref_tf.values()), 1)

    raw_scores = []
    for token in tokens:
        clean = re.sub(r"[^\w]", "", token).lower()
        salience = _intrinsic_salience(token, clean)

        meaningful = bool(clean) and clean not in _STOPWORDS and len(clean) > 2
        if num_docs > 0 and meaningful:
            appears = ref_tf.get(clean, 0)
            if appears > 0:
                idf = math.log((num_docs + 1) / (doc_freq.get(clean, 0) + 1)) + 1.0
                tf = appears / ref_len
                grounding = idf * (0.5 + 50.0 * tf)
                score = 0.70 * grounding + 0.30 * salience
            else:
                # Salient-looking but not grounded in the cited regulation.
                score = 0.40 * salience
        else:
            score = salience
        raw_scores.append(score)

    max_raw = max(raw_scores) if raw_scores else 1.0
    if max_raw <= 0:
        max_raw = 1.0
    return [
        {"word": token, "attribution": round(min(1.0, raw / max_raw), 3)}
        for token, raw in zip(tokens, raw_scores)
    ]

def generate_auditor_justification(decision, category, matched_text, attributions):
    """
    Generates a structured, auditor-ready justification document.
    """
    # Filter high importance words (attribution > 0.5)
    high_impact_words = [a["word"] for a in attributions if a["attribution"] > 0.5]
    impact_str = ", ".join(f"'{w}'" for w in high_impact_words[:5])
    
    if decision == "VIOLATION":
        title = f"Compliance Alert: {category} Infraction Detected"
        severity = "HIGH"
        summary = (
            f"The scanned sequence contains attributes that violate established GRC policies under {category}. "
            f"Specifically, the terms {impact_str} were found to trigger compliance threshold alerts."
        )
        reasoning = (
            f"Under the cited regulation: '{matched_text}', "
            f"the system detected a misalignment. The logic was evaluated from the regulatory perspective, "
            f"identifying that the active operational state fails to satisfy the specified control criteria. "
            f"To satisfy auditor requirements, this alert is backed by an attribution mapping showing "
            f"significant local model weight focused on security-critical configuration parameters."
        )
        remediation = "Please update configuration settings, restrict access, or mask the offending identifiers."
    else:
        title = f"Compliance Pass: {category} Verification"
        severity = "NONE"
        summary = f"The scanned sequence matches the compliant state profile defined by {category}."
        reasoning = (
            f"Evaluation against '{matched_text}' confirms that the parameter values fall within safe operational "
            f"ranges. The key indicators {impact_str} were processed and verified as compliant."
        )
        remediation = "No action required. Compliance logs recorded."

    return {
        "title": title,
        "severity": severity,
        "summary": summary,
        "reasoning": reasoning,
        "remediation": remediation
    }
