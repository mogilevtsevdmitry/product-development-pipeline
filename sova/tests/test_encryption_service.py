import pytest
from src.services.encryption_service import EncryptionService


@pytest.fixture
def encryption():
    # 32-byte hex key for testing
    test_key = "a" * 64  # 32 bytes in hex
    return EncryptionService(test_key)


def test_encrypt_decrypt_roundtrip(encryption):
    plaintext = "my-secret-token-12345"
    encrypted = encryption.encrypt(plaintext)
    assert isinstance(encrypted, bytes)
    assert encrypted != plaintext.encode()
    decrypted = encryption.decrypt(encrypted)
    assert decrypted == plaintext


def test_encrypt_produces_different_ciphertexts(encryption):
    """Each encryption should produce different ciphertext (random IV)."""
    plaintext = "same-token"
    enc1 = encryption.encrypt(plaintext)
    enc2 = encryption.encrypt(plaintext)
    assert enc1 != enc2


def test_decrypt_wrong_key():
    key1 = "a" * 64
    key2 = "b" * 64
    svc1 = EncryptionService(key1)
    svc2 = EncryptionService(key2)

    encrypted = svc1.encrypt("secret")
    with pytest.raises(Exception):
        svc2.decrypt(encrypted)


def test_encrypt_empty_string(encryption):
    encrypted = encryption.encrypt("")
    decrypted = encryption.decrypt(encrypted)
    assert decrypted == ""


def test_encrypt_unicode(encryption):
    plaintext = "Тестовый-токен-🦉"
    encrypted = encryption.encrypt(plaintext)
    decrypted = encryption.decrypt(encrypted)
    assert decrypted == plaintext


def test_invalid_key_raises():
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        EncryptionService("")


def test_short_key_raises():
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        EncryptionService("tooshort")
