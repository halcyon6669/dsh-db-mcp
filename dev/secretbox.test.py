"""Regression tests for `server/secretbox.py`, the envelope reader.

The Host (`src/secretbox.js`) encrypts every password before it lands in
`secrets.json`; this module is the read side. The cases below pin the format
(`v1.<iv>.<tag>.<ciphertext>`), the key file, and the behaviour that matters when
something is wrong: an entry that cannot be opened must raise, not come back as
`None`, because `None` turns into a misleading authentication failure.

Run it through `dev/engines.test.mjs` (`npm run test:engines`), which picks the
right interpreter. The `cryptography` package is needed for the round-trip cases;
they are skipped when it is missing.
"""

from __future__ import annotations

import base64
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE / "server"))
SPEC = importlib.util.spec_from_file_location("db_mcp_secretbox", PACKAGE / "server" / "secretbox.py")
secretbox = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(secretbox)

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    HAVE_CRYPTO = True
except ImportError:  # pragma: no cover - environment problem
    HAVE_CRYPTO = False

KEY = bytes(range(32))


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def seal(plaintext: str, aad: str | None = None, key: bytes = KEY) -> str:
    """Build an envelope the way `src/secretbox.js` does."""
    iv = bytes(12)
    tag_and_data = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), (aad or "").encode("utf-8"))
    return "v1." + ".".join((b64(iv), b64(tag_and_data[-16:]), b64(tag_and_data[:-16])))


class KeyFile(unittest.TestCase):
    def test_a_missing_key_names_the_file_and_the_way_out(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(secretbox.SecretError) as caught:
                secretbox.load_key(Path(directory))
            self.assertIn("secret.key", str(caught.exception))
            self.assertIn("re-enter", str(caught.exception))

    def test_a_short_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / secretbox.KEY_FILE
            path.write_text(b64(b"short"), encoding="utf-8")
            with self.assertRaises(secretbox.SecretError) as caught:
                secretbox.load_key(Path(directory))
            self.assertIn("32-byte", str(caught.exception))

    def test_a_key_round_trips(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / secretbox.KEY_FILE
            path.write_text(b64(KEY), encoding="utf-8")
            self.assertEqual(secretbox.load_key(Path(directory)), KEY)


class Envelopes(unittest.TestCase):
    def test_is_envelope(self):
        self.assertTrue(secretbox.is_envelope("v1.a.b.c"))
        self.assertFalse(secretbox.is_envelope("hunter2"))
        self.assertFalse(secretbox.is_envelope(None))
        self.assertFalse(secretbox.is_envelope("v2.a.b.c"))

    def test_a_malformed_envelope_is_rejected(self):
        with self.assertRaises(secretbox.SecretError) as caught:
            secretbox.decrypt(KEY, "v1.only-one-part", "pg-test")
        self.assertIn("malformed", str(caught.exception))

    def test_a_non_base64_envelope_is_rejected(self):
        with self.assertRaises(secretbox.SecretError):
            secretbox.decrypt(KEY, "v1.!!.!!.!!", "pg-test")


@unittest.skipUnless(HAVE_CRYPTO, "cryptography is not installed")
class RoundTrip(unittest.TestCase):
    def test_a_sealed_password_opens(self):
        self.assertEqual(secretbox.decrypt(KEY, seal("p@ss", "pg-test"), "pg-test"), "p@ss")

    def test_another_source_id_does_not_open_it(self):
        # The source id is the AAD: a copied envelope must not hand back a password.
        with self.assertRaises(secretbox.SecretError) as caught:
            secretbox.decrypt(KEY, seal("p@ss", "pg-test"), "other-source")
        self.assertIn("cannot decrypt", str(caught.exception))

    def test_another_key_does_not_open_it(self):
        with self.assertRaises(secretbox.SecretError):
            secretbox.decrypt(bytes(32), seal("p@ss", "pg-test"), "pg-test")


@unittest.skipUnless(HAVE_CRYPTO, "cryptography is not installed")
class OpenPassword(unittest.TestCase):
    def test_a_sealed_entry_opens(self):
        entry = {"password": seal("p@ss", "pg-test")}
        self.assertEqual(secretbox.open_password(entry, KEY, "pg-test"), "p@ss")

    def test_a_plaintext_entry_still_opens(self):
        # An older build wrote plaintext; the Host migrates it on the next start.
        self.assertEqual(secretbox.open_password({"password": "p@ss"}, KEY, "pg-test"), "p@ss")

    def test_the_hash_key_is_read_too(self):
        self.assertEqual(secretbox.open_password({"#password": "p@ss"}, KEY, "pg-test"), "p@ss")

    def test_an_empty_entry_has_no_password(self):
        self.assertIsNone(secretbox.open_password({}, KEY, "pg-test"))
        self.assertIsNone(secretbox.open_password(None, KEY, "pg-test"))

    def test_a_sealed_entry_that_cannot_be_opened_raises(self):
        entry = {"password": seal("p@ss", "pg-test")}
        with self.assertRaises(secretbox.SecretError):
            secretbox.open_password(entry, KEY, "other-source")


if __name__ == "__main__":
    unittest.main(verbosity=2)
