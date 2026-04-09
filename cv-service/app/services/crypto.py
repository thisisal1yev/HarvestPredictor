"""AES-256-GCM credential encryption per spec §7.3.

Ciphertext layout: version(1) | iv(12) | tag(16) | ciphertext(N), base64-encoded.
Master key loaded from ENCRYPTION_KEY env var, supports optional `base64:` prefix.
"""
import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = 0x01
_KEY: bytes | None = None


def _key() -> bytes:
    global _KEY
    if _KEY is None:
        raw = os.environ.get("ENCRYPTION_KEY", "")
        if not raw:
            raise RuntimeError("ENCRYPTION_KEY env var is not set")
        if raw.startswith("base64:"):
            raw = raw[len("base64:"):]
        _KEY = base64.b64decode(raw)
        if len(_KEY) != 32:
            raise RuntimeError("ENCRYPTION_KEY must decode to exactly 32 bytes")
    return _KEY


def encrypt(plaintext: str) -> str:
    """Encrypt a string. Returns base64(version | iv(12) | tag(16) | ct)."""
    iv = os.urandom(12)
    aesgcm = AESGCM(_key())
    ct_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    # cryptography returns ciphertext||tag concatenated. Split for layout.
    ct, tag = ct_with_tag[:-16], ct_with_tag[-16:]
    blob = bytes([VERSION]) + iv + tag + ct
    return base64.b64encode(blob).decode("ascii")


def decrypt(payload_b64: str) -> str:
    """Inverse of encrypt(). Raises on version mismatch or auth failure."""
    blob = base64.b64decode(payload_b64)
    if len(blob) < 1 + 12 + 16:
        raise RuntimeError("Ciphertext payload too short")
    version = blob[0]
    if version != VERSION:
        raise RuntimeError(f"Unsupported ciphertext version: {version}")
    iv = blob[1:13]
    tag = blob[13:29]
    ct = blob[29:]
    return AESGCM(_key()).decrypt(iv, ct + tag, None).decode("utf-8")
