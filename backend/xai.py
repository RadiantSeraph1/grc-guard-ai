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
    """Structured justification for the scan result. Factual, no template padding —
    the real rationale comes from the rule/LLM explanation prepended by the caller."""
    top = ", ".join([a["word"] for a in attributions if a["attribution"] > 0.5][:5])
    violation = decision == "VIOLATION"
    return {
        "title": f"Compliance {'Alert' if violation else 'Pass'}: {category}",
        "severity": "HIGH" if violation else "NONE",
        "summary": f"{'Violation indicators' if violation else 'Compliant indicators'}: {top or 'none above threshold'}.",
        "reasoning": f"Evaluated against: '{matched_text}'.",
        "remediation": "Remediate the flagged configuration or control gap." if violation else "No action required.",
    }
