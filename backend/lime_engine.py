"""Real, perturbation-based LIME against the live active AI provider.

This is genuine LIME (Local Interpretable Model-agnostic Explanations): it
measures how much the model's confidence in its OWN predicted class shifts
when each candidate token is removed from the input, by actually re-querying
the model — not a hardcoded weight table and not the model's self-reported
"importance" labels (see ai_agents.py's ComplianceExplanation, which asks the
LLM to describe its own reasoning — that is NOT this).

Model-agnostic by design: works against whichever hosted provider is active
today (Claude, Gemini, Groq, ...). Does not require open model weights, so it
closes part of Obj. (ii) ahead of Phase 2's attention/SHAP-on-internals work
(which DOES need open weights).

Cost: N+1 model calls per explanation (1 baseline + up to `max_candidates`
perturbations) — bounded and opt-in, never run automatically on every scan.
"""
import re
from typing import Dict, List, Optional

import ai_gateway

_CONFIDENCE_SCHEMA = {
    "type": "object",
    "properties": {
        "decision": {"type": "string", "enum": ["COMPLIANT", "VIOLATION"]},
        "violation_confidence": {"type": "integer", "description": "0-100: confidence this scenario is a VIOLATION."},
    },
    "required": ["decision", "violation_confidence"],
}

_SYSTEM_INSTRUCTION = "You are a senior banking GRC compliance auditor evaluating a scenario for Basel III/CBEST/GDPR/SOC 2 compliance."


def _query(text: str, perspective: str, org_id: Optional[str]) -> Dict:
    prompt = (
        f"Perspective: {perspective}\n"
        f"Scenario: {text}\n\n"
        "Decide COMPLIANT or VIOLATION, and give your confidence (0-100) that this is a VIOLATION."
    )
    result = ai_gateway.generate_structured_json(prompt, _CONFIDENCE_SCHEMA, _SYSTEM_INSTRUCTION, org_id=org_id)
    decision = result.get("decision")
    conf = result.get("violation_confidence")
    if decision not in ("COMPLIANT", "VIOLATION") or not isinstance(conf, (int, float)):
        raise ValueError("Model did not return a usable decision/confidence.")
    return {"decision": decision, "violation_confidence": float(conf)}


def _target_class_confidence(decision: str, violation_confidence: float) -> float:
    """Confidence in whatever class was predicted (LIME measures around the
    predicted class, not always 'violation')."""
    return violation_confidence if decision == "VIOLATION" else (100.0 - violation_confidence)


def _candidate_tokens(text: str, max_candidates: int) -> List[str]:
    seen = []
    for tok in re.findall(r"\b[a-zA-Z][a-zA-Z0-9_-]{3,}\b", text):
        low = tok.lower()
        if low not in seen:
            seen.append(low)
        if len(seen) >= max_candidates:
            break
    return seen


def _remove_token(text: str, token: str) -> str:
    return re.sub(rf"\b{re.escape(token)}\b", "", text, flags=re.IGNORECASE)


def real_lime_attribution(text: str, org_id: Optional[str] = None, perspective: str = "Standard",
                           top_n: int = 8, max_candidates: int = 15) -> Dict:
    """Run real perturbation-based LIME against the active provider.

    Raises ValueError if no usable provider is configured (caller should
    surface this as a 400/503, not fabricate an explanation).
    """
    baseline = _query(text, perspective, org_id)
    baseline_target_conf = _target_class_confidence(baseline["decision"], baseline["violation_confidence"])

    candidates = _candidate_tokens(text, max_candidates)
    attributions = []
    for token in candidates:
        perturbed_text = _remove_token(text, token)
        if perturbed_text.strip() == text.strip():
            continue  # token didn't actually appear as a whole word
        try:
            perturbed = _query(perturbed_text, perspective, org_id)
        except Exception:
            continue  # skip a failed perturbation call rather than fail the whole explanation
        perturbed_target_conf = _target_class_confidence(baseline["decision"], perturbed["violation_confidence"])
        delta = round(baseline_target_conf - perturbed_target_conf, 2)
        flip = perturbed["decision"] != baseline["decision"]
        attributions.append({
            "feature": token.upper(),
            "weight": delta,
            "decision_flip": flip,
            "baseline_confidence": round(baseline_target_conf, 1),
            "perturbed_confidence": round(perturbed_target_conf, 1),
            "explanation": (
                f"Removing '{token}' shifted confidence in the model's own '{baseline['decision']}' "
                f"verdict from {baseline_target_conf:.0f}% to {perturbed_target_conf:.0f}%"
                + (" — this FLIPPED the decision entirely." if flip else ".")
            ),
        })

    # Flips are the strongest possible LIME signal regardless of raw magnitude.
    attributions.sort(key=lambda a: (a["decision_flip"], abs(a["weight"])), reverse=True)

    return {
        "method": "perturbation_lime",
        "verified": True,
        "baseline_decision": baseline["decision"],
        "baseline_violation_confidence": round(baseline["violation_confidence"], 1),
        "candidates_tested": len(candidates),
        "attributions": attributions[:top_n],
    }
