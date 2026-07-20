"""
Remote Attestation Module — TPM2_QUOTE-equivalent workload attestation.

Verifies that the active LLM provider meets internal security policy
before any compliance data is sent to it.

Paper reference: Chapter 3 — "policy-compliant API uses the zero-trust
architecture... specified remote attestation protocols using TPM2_QUOTE
evidence structures."

Real leg (when running on GCP, e.g. this app's GKE deployment): the
workload's identity is attested via a Google-signed OIDC ID token pulled
from the metadata server (instance/service-accounts/default/identity) and
verified against Google's public keys (google.oauth2.id_token.verify_token).
This is genuine cryptographic proof the code is running on the expected
GCE/GKE workload under the expected service account, backed by Google's
own infrastructure root of trust — not a literal TPM2_QUOTE PCR quote
(that needs privileged /dev/tpm0 access this container doesn't have), but
real signed evidence rather than a simulation.

Fallback (no GCP metadata server reachable, e.g. local dev): a software
HMAC-based simulation of TPM2_QUOTE, clearly reported as such in
`quote_method` on every attestation report.

Either way, the provider's declared characteristics (data retention,
region, encryption) are self-declared metadata checked against policy in
_check_policy() below — no attestation mechanism, hardware or software,
can independently prove a third-party vendor's internal data handling.
"""
import hashlib
import hmac as hmac_lib
import json
import os
import time
from typing import Dict, Optional, Tuple

_METADATA_IDENTITY_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/identity"
)


def _fetch_and_verify_gcp_identity_token(audience: str) -> Optional[Dict]:
    """Fetch a Google-signed OIDC ID token for this workload from the GCE/GKE
    metadata server and verify its signature against Google's public keys.

    Returns the verified claims dict, or None if unavailable (not running on
    GCP, or verification failed) so the caller can fall back to the software
    simulation.
    """
    try:
        import requests
        resp = requests.get(
            _METADATA_IDENTITY_URL,
            params={"audience": audience, "format": "full"},
            headers={"Metadata-Flavor": "Google"},
            timeout=2,
        )
        resp.raise_for_status()
        token = resp.text

        from google.auth.transport.requests import Request as GoogleAuthRequest
        from google.oauth2 import id_token as google_id_token
        claims = google_id_token.verify_token(token, GoogleAuthRequest(), audience=audience)
        return claims
    except Exception:
        return None

# Internal attestation secret — loaded from env in production
# This simulates the TPM's endorsement key (EK)
ATTESTATION_SECRET = os.environ.get("ATTESTATION_SECRET", "grc-guard-tpm2-sim-key-change-in-prod")

# Security policy: what a compliant LLM provider must declare
# These thresholds mirror EU AI Act Art. 9 + Basel III operational risk requirements
SECURITY_POLICY = {
    "encryption_in_transit": True,       # TLS required for all API calls
    "data_retention_days": 0,            # Provider must not retain compliance input data
    "model_version_pinned": True,        # Model version must be declared (audit trail)
    "approved_regions": ["us-central1", "us-east1", "eu-west1"],  # Data residency
    "min_tls_version": "TLS1.2",
}

# Known-good provider attestation profiles
# In production these would come from provider trust anchors / certificates
PROVIDER_PROFILES = {
    "gemini": {
        "encryption_in_transit": True,
        "data_retention_days": 0,
        "model_version_pinned": True,
        "region": "us-central1",
        "min_tls_version": "TLS1.3",
        "attestation_level": "cloud_hsm",
    },
}


def _pcr_measurement(provider_type: str, model_name: str, base_url: str = "") -> str:
    """
    Simulate a TPM2 PCR (Platform Configuration Register) measurement.
    Produces a SHA-256 digest of the provider's declared configuration.
    In real TPM2: this would be a PCR_Extend operation.
    """
    canonical = json.dumps({
        "provider": provider_type,
        "model": model_name,
        "base_url": base_url,
    }, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


def tpm2_quote(provider_type: str, model_name: str, nonce: str, base_url: str = "") -> Tuple[str, str]:
    """
    Simulate TPM2_QUOTE command.
    Returns (pcr_digest, quote_signature).

    In production TPM2: tpm2_quote --key-context ek.ctx --pcr-list sha256:0,1,7
    The nonce prevents replay attacks (5-minute validity window).
    """
    pcr = _pcr_measurement(provider_type, model_name, base_url)
    time_window = int(time.time() // 300)  # 5-min rolling window
    message = f"{pcr}:{nonce}:{time_window}".encode()
    sig = hmac_lib.new(
        ATTESTATION_SECRET.encode(),
        message,
        hashlib.sha256
    ).hexdigest()
    return pcr, sig


def verify_attestation(provider_type: str, model_name: str, nonce: str,
                       pcr: str, sig: str, base_url: str = "") -> bool:
    """Verify a TPM2_QUOTE before sending compliance data to the provider."""
    expected_pcr, expected_sig = tpm2_quote(provider_type, model_name, nonce, base_url)
    pcr_ok = hmac_lib.compare_digest(pcr, expected_pcr)
    sig_ok = hmac_lib.compare_digest(sig, expected_sig)
    return pcr_ok and sig_ok


def _check_policy(provider_type: str) -> Dict:
    """
    Check provider profile against security policy.
    Returns {"passed": bool, "violations": [str], "warnings": [str]}
    """
    profile = PROVIDER_PROFILES.get(provider_type, {})
    violations = []
    warnings = []

    if not profile:
        return {
            "passed": False,
            "violations": [f"No attestation profile registered for provider '{provider_type}'"],
            "warnings": []
        }

    if not profile.get("encryption_in_transit"):
        violations.append("Provider does not guarantee TLS encryption in transit")

    if profile.get("data_retention_days", 1) > 0:
        violations.append(f"Provider retains data for {profile['data_retention_days']} days (policy: 0)")

    if not profile.get("model_version_pinned"):
        warnings.append("Model version is not pinned — silent model updates may affect audit trail consistency (EU AI Act Art. 13)")

    if profile.get("region") not in SECURITY_POLICY["approved_regions"]:
        violations.append(f"Provider region '{profile.get('region')}' not in approved regions {SECURITY_POLICY['approved_regions']}")

    return {
        "passed": len(violations) == 0,
        "violations": violations,
        "warnings": warnings
    }


def attest_provider(provider_type: str, model_name: str, base_url: str = "") -> Dict:
    """
    Full attestation flow:
    1. Generate TPM2_QUOTE
    2. Verify quote integrity
    3. Check provider against security policy
    4. Return attestation report for audit trail

    Per EU AI Act Art. 9 + Basel III operational risk requirements.
    """
    nonce = hashlib.sha256(os.urandom(32)).hexdigest()[:16]
    pcr = _pcr_measurement(provider_type, model_name, base_url)
    audience = f"grc-guard-attestation:{provider_type}:{pcr}"

    gcp_claims = _fetch_and_verify_gcp_identity_token(audience)
    if gcp_claims:
        quote_method = "gcp_signed_identity_token"
        quote_verified = True  # signature + audience + expiry already checked by verify_token
        sig = gcp_claims.get("email", "") or gcp_claims.get("sub", "")
        workload_identity = {
            "instance": gcp_claims.get("google", {}).get("compute_engine", {}).get("instance_name"),
            "project_id": gcp_claims.get("google", {}).get("compute_engine", {}).get("project_id"),
            "service_account": gcp_claims.get("email"),
            "issuer": gcp_claims.get("iss"),
        }
    else:
        quote_method = "software_simulated_hmac"
        _, sig = tpm2_quote(provider_type, model_name, nonce, base_url)
        quote_verified = verify_attestation(provider_type, model_name, nonce, pcr, sig, base_url)
        workload_identity = None

    policy_check = _check_policy(provider_type)
    attested = quote_verified and policy_check["passed"]

    return {
        "attested": attested,
        "provider": provider_type,
        "model": model_name,
        "nonce": nonce,
        "pcr_digest": pcr,
        "quote_signature": sig,
        "quote_verified": quote_verified,
        "quote_method": quote_method,
        "workload_identity": workload_identity,
        "policy_passed": policy_check["passed"],
        "policy_violations": policy_check["violations"],
        "policy_warnings": policy_check["warnings"],
        "attestation_level": PROVIDER_PROFILES.get(provider_type, {}).get("attestation_level", "unknown"),
        "timestamp": time.time(),
        "timestamp_human": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "eu_ai_act_article": "Art. 9 (Risk Management) + Art. 13 (Transparency)",
    }


if __name__ == "__main__":
    # Off-GCP (metadata server unreachable): must fall back to the software
    # simulation and still produce a self-consistent, verifiable quote.
    report = attest_provider("gemini", "gemini-2.5-flash")
    assert report["quote_method"] == "software_simulated_hmac", report["quote_method"]
    assert report["quote_verified"] is True
    assert report["workload_identity"] is None
    assert report["attested"] is True, report["policy_violations"]

    # Unknown provider: no profile registered -> policy fails regardless of quote.
    unknown = attest_provider("not-a-real-provider", "x")
    assert unknown["attested"] is False
    assert unknown["policy_passed"] is False

    print("attestation.py self-check passed (software-simulation fallback verified).")
