import base64
import hashlib
import json
import os
import time
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ENCRYPTION_VERSION = "v2"
PBKDF2_ITERATIONS = 390000

def _derive_fernet_key(key: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return base64.urlsafe_b64encode(kdf.derive(key.encode("utf-8")))

def encrypt_log(data: str, key: str) -> str:
    """
    Encrypts sensitive data using the provided BYOK key.
    Uses authenticated Fernet encryption with a key derived from the BYOK secret.
    """
    if not key:
        raise ValueError("Encryption key is required.")

    salt = os.urandom(16)
    fernet = Fernet(_derive_fernet_key(key, salt))
    token = fernet.encrypt(data.encode("utf-8")).decode("utf-8")
    salt_b64 = base64.urlsafe_b64encode(salt).decode("utf-8")
    return f"{ENCRYPTION_VERSION}:{salt_b64}:{token}"

def decrypt_log(encrypted_data: str, key: str) -> str:
    """
    Decrypts sensitive data using the provided BYOK key.
    """
    if not key:
        return "[Error: Decryption failed. Missing key.]"

    try:
        if encrypted_data.startswith(f"{ENCRYPTION_VERSION}:"):
            _, salt_b64, token = encrypted_data.split(":", 2)
            salt = base64.urlsafe_b64decode(salt_b64.encode("utf-8"))
            fernet = Fernet(_derive_fernet_key(key, salt))
            return fernet.decrypt(token.encode("utf-8")).decode("utf-8")

        # Backward compatibility for old demo XOR rows already stored locally.
        encrypted_bytes = base64.b64decode(encrypted_data.encode("utf-8"))
        key_bytes = key.encode("utf-8")
        decrypted = bytearray()
        for i, byte in enumerate(encrypted_bytes):
            key_byte = key_bytes[i % len(key_bytes)]
            decrypted.append(byte ^ key_byte)
        return decrypted.decode("utf-8")
    except (InvalidToken, ValueError):
        return "[Error: Decryption failed. Invalid BYOK key.]"
    except Exception:
        return "[Error: Decryption failed. Invalid BYOK key.]"

# TPM Remote Attestation Simulation
# Gold Standard PCR values representing a secure system state
GOLDEN_PCRS = {
    "PCR0": "a8f3b2c1d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2", # Bios
    "PCR4": "b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4", # Bootloader
    "PCR8": "f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6"  # Compliance Kernel
}

def generate_simulated_tpm_quote(nonce: str) -> dict:
    """
    Generates a simulated TPM2_QUOTE structure.
    """
    # Simulate current system PCRs
    current_pcrs = GOLDEN_PCRS.copy()
    
    # Hash the PCRs and the nonce to create the digest
    pcr_digest_input = "".join(current_pcrs.values()) + nonce
    pcr_digest = hashlib.sha256(pcr_digest_input.encode('utf-8')).hexdigest()
    
    # Create public attestation key (AIK) representation
    aik_pub = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzq3Nf1... [SIMULATED TPM AIK PUBLIC KEY]"
    
    # Sign the digest (simulated signature)
    signature_input = pcr_digest + "attestation_key_secret"
    signature = hashlib.sha256(signature_input.encode('utf-8')).hexdigest()
    
    return {
        "quote_format": "TPM2_QUOTE",
        "timestamp": int(time.time()),
        "nonce": nonce,
        "pcrs": current_pcrs,
        "pcr_digest": pcr_digest,
        "attestation_key_pub": aik_pub,
        "signature": signature
    }

def verify_tpm_quote(quote: dict, expected_nonce: str) -> dict:
    """
    Verifies a TPM2_QUOTE attestation structure against the expected golden PCRs.
    """
    if quote.get("quote_format") != "TPM2_QUOTE":
        return {"verified": False, "reason": "Invalid quote format"}
        
    if quote.get("nonce") != expected_nonce:
        return {"verified": False, "reason": "Nonce mismatch / replay attack detected"}
        
    # Check PCR values against Golden PCR values
    provided_pcrs = quote.get("pcrs", {})
    pcr_failures = []
    
    for pcr_id, expected_val in GOLDEN_PCRS.items():
        if provided_pcrs.get(pcr_id) != expected_val:
            pcr_failures.append(pcr_id)
            
    if pcr_failures:
        return {
            "verified": False,
            "reason": f"PCR Integrity violation in: {', '.join(pcr_failures)}. Code modification detected."
        }
        
    # Re-verify the digest matching
    pcr_digest_input = "".join(provided_pcrs.values()) + expected_nonce
    expected_digest = hashlib.sha256(pcr_digest_input.encode('utf-8')).hexdigest()
    
    if quote.get("pcr_digest") != expected_digest:
        return {"verified": False, "reason": "PCR Digest verification failed"}
        
    # Signature verification (simulated signature check)
    signature_input = expected_digest + "attestation_key_secret"
    expected_sig = hashlib.sha256(signature_input.encode('utf-8')).hexdigest()
    
    if quote.get("signature") != expected_sig:
        return {"verified": False, "reason": "Attestation Key Signature is invalid"}
        
    return {
        "verified": True,
        "reason": "TPM 2.0 Remote Attestation quote verified. Code integrity and boot state are secured against Golden PCR standards."
    }
