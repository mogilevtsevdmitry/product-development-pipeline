"""Token encryption/decryption using Fernet (AES-128-CBC + HMAC-SHA256).

Fernet derives a 256-bit key from the provided key material using URL-safe
base64 encoding. We accept a 32-byte hex-encoded ENCRYPTION_KEY from env,
convert it to 32 bytes, then base64-encode for Fernet.
"""
import base64

from cryptography.fernet import Fernet, InvalidToken


class EncryptionService:
    """Encrypt and decrypt integration tokens.

    Accepts a hex-encoded key (64 hex chars = 32 bytes).
    Uses Fernet which provides AES-128-CBC encryption with HMAC-SHA256 auth.
    Each encrypt() call uses a random IV, so ciphertexts differ for same input.
    """

    def __init__(self, hex_key: str) -> None:
        if not hex_key or len(hex_key) < 32:
            raise ValueError(
                "ENCRYPTION_KEY must be at least 32 hex characters (16 bytes). "
                "Got empty or too short key."
            )
        # Take first 32 bytes (64 hex chars) and convert to Fernet key
        raw_bytes = bytes.fromhex(hex_key[:64].ljust(64, "0"))
        # Fernet requires exactly 32 bytes, url-safe base64 encoded
        self._fernet = Fernet(base64.urlsafe_b64encode(raw_bytes[:32]))

    def encrypt(self, plaintext: str) -> bytes:
        """Encrypt a plaintext string. Returns encrypted bytes."""
        return self._fernet.encrypt(plaintext.encode("utf-8"))

    def decrypt(self, ciphertext: bytes) -> str:
        """Decrypt ciphertext bytes. Returns plaintext string.

        Raises cryptography.fernet.InvalidToken on wrong key or corrupted data.
        """
        return self._fernet.decrypt(ciphertext).decode("utf-8")
