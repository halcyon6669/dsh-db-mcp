"""Read the AES-256-GCM envelopes the Host writes into `secrets.json`.

The Host (`src/secretbox.js`) owns the key and does the encrypting; this module
only opens what it finds. Both sides keep the format in the same shape:

    v1.<iv b64url>.<tag b64url>.<ciphertext b64url>

The data-source id is the additional authenticated data, so an envelope copied
onto another source fails to decrypt instead of handing back the wrong password.
"""

from __future__ import annotations

import base64
from pathlib import Path

PREFIX = "v1"
KEY_FILE = "secret.key"
KEY_BYTES = 32


class SecretError(Exception):
    """Raised when an envelope cannot be opened; the caller turns it into JSON."""


def _b64url(text: str) -> bytes:
    padded = str(text) + "=" * (-len(str(text)) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def is_envelope(value) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX + ".")


def load_key(runtime: Path) -> bytes:
    path = runtime / KEY_FILE
    try:
        text = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        raise SecretError(
            f"{path} is missing: the stored passwords cannot be decrypted. "
            "Open the Database panel once to recreate it, then re-enter the passwords."
        )
    except OSError as error:
        raise SecretError(f"cannot read {path}: {error}")
    try:
        key = _b64url(text)
    except Exception as error:  # noqa: BLE001 - anything here means a corrupt key
        raise SecretError(f"{path} is not a valid key: {error}")
    if len(key) != KEY_BYTES:
        raise SecretError(f"{path} does not hold a 32-byte key")
    return key


def decrypt(key: bytes, envelope: str, aad: str | None) -> str:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as error:  # pragma: no cover - environment problem
        raise SecretError(
            f"the cryptography package is not installed ({error}); run the plugin's Python setup again"
        )
    parts = str(envelope).split(".")
    if len(parts) != 4 or parts[0] != PREFIX:
        raise SecretError("malformed secret envelope")
    try:
        iv = _b64url(parts[1])
        tag = _b64url(parts[2])
        data = _b64url(parts[3])
    except Exception as error:  # noqa: BLE001 - corrupt base64
        raise SecretError(f"malformed secret envelope: {error}")
    try:
        return AESGCM(key).decrypt(iv, data + tag, (aad or "").encode("utf-8")).decode("utf-8")
    except Exception as error:  # noqa: BLE001 - InvalidTag and friends
        raise SecretError(
            f"cannot decrypt the stored password ({type(error).__name__}); "
            "the key in secret.key does not match, or the entry belongs to another source"
        )


def open_password(entry, key: bytes, source_id: str | None) -> str | None:
    """The password inside one `secrets.json` entry, decrypting when needed.

    A plaintext value still works, so a registry written by an older build keeps
    opening until the Host rewrites it.
    """
    if not isinstance(entry, dict):
        return None
    for name in ("password", "#password"):
        value = entry.get(name)
        if not isinstance(value, str) or value == "":
            continue
        if is_envelope(value):
            return decrypt(key, value, source_id)
        return value
    return None
