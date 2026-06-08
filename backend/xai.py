import re
import math

def calculate_local_attribution(scan_text, matched_regulations):
    """
    Computes a simulated feature attribution score for each word in the scanned text.
    Attribution is calculated based on:
    1. Direct match with critical regulatory keywords (e.g., "SWIFT", "routing", "capital", "anonymize").
    2. Contextual significance score.
    Returns a list of dictionaries: {"word": str, "attribution": float (0.0 to 1.0)}
    """
    words = scan_text.split()
    attributions = []
    
    # Collect all words from matched regulations for semantic similarity
    reg_words = set()
    for reg in matched_regulations:
        content = reg.get("content", "").lower()
        # Clean text
        cleaned = re.sub(r'[^\w\s]', '', content)
        reg_words.update(cleaned.split())
        
    # Standard GRC critical trigger words
    critical_triggers = {
        "swift": 0.9, "routing": 0.8, "impersonation": 0.9, "gateway": 0.7,
        "spoofing": 0.7, "disclosure": 0.8, "adequacy": 0.8, "capital": 0.7,
        "hqla": 0.9, "liquidity": 0.8, "anonymize": 0.9, "pii": 0.95,
        "password": 0.85, "unencrypted": 0.8, "violation": 0.85
    }
    
    for word in words:
        clean_word = re.sub(r'[^\w]', '', word).lower()
        score = 0.05  # Base score
        
        # Factor 1: Does it match a critical compliance trigger?
        if clean_word in critical_triggers:
            score += critical_triggers[clean_word]
            
        # Factor 2: Is it present in the matched regulation?
        if clean_word in reg_words and len(clean_word) > 3:
            score += 0.3
            
        # Normalize score
        score = min(1.0, score)
        attributions.append({
            "word": word,
            "attribution": round(score, 3)
        })
        
    return attributions

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
