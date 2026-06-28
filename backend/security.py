import base64
import os
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

        # Backward compatibility for legacy XOR rows already stored locally.
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
