"""The public keys, and the fingerprint - GAP G03, the biggest one in the document.

Section 6 says `signerFp` is "the full fingerprint of the signing key, bound into the
signed bytes so a signature cannot be re-pointed at another key". FORMAT.md never says
where the public key lives, in what encoding, or - the part that matters -  HOW THE
FINGERPRINT IS DERIVED FROM THE KEY. Without the last one a verifier loads the key by its
FILENAME, and then section 6's promise is assumed rather than checked: whoever renames the
file re-points the signature, which is the exact thing the clause says cannot happen.

Resolved by experiment against the two fingerprints published in the frozen records. Four
derivations were tried:

    sha256(DER SubjectPublicKeyInfo)   closes on both      <- this one
    sha256(the raw 32-byte key)        closes on neither
    sha256(the PEM text)               closes on neither
    sha256(the base64 body)            closes on neither

So this module recomputes the fingerprint from the key material and refuses a key file
whose contents do not match its name. That turns "trust the filename" into a check.
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
from typing import NamedTuple

from .verdict import Refusal

# The DER prefix of a SubjectPublicKeyInfo carrying an Ed25519 key: SEQUENCE, the
# AlgorithmIdentifier for OID 1.3.101.112 (id-Ed25519), then a 33-byte BIT STRING whose
# leading zero says there are no unused bits. RFC 8410 section 4.
_SPKI_ED25519_PREFIX = bytes.fromhex("302a300506032b6570032100")
_PEM = re.compile(
    r"-----BEGIN PUBLIC KEY-----(?P<body>.*?)-----END PUBLIC KEY-----", re.DOTALL
)
# The whitespace a PEM body may be wrapped with, and the strict alphabet and padding of what is
# left. Both are spelled out, rather than left to `str.split()` and `b64decode`, so the product
# can apply the very same rule and the two readers hold the same bytes to be a key or not.
_PEM_WRAP = re.compile(r"[\t\n\v\f\r ]")
_BASE64 = re.compile(r"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?")

# The words a file under `keys/` that holds no key is refused by, in this reader and in the
# product, followed by the reason.
HOLDS_NO_KEY = "holds no Ed25519 public key"
NOT_A_FILE = "it is not a file"


class PublicKey(NamedTuple):
    fingerprint: str
    raw: bytes
    der: bytes
    filename: str
    name_matches_material: bool


def parse_pem(text: str, filename: str = "") -> PublicKey:
    """The key a committed key file holds, or a refusal under section 6 that says why it holds none.

    The refusal carries the reason alone, with no path: the caller names the file.
    """
    match = _PEM.search(text)
    if match is None:
        raise Refusal("6", "no PEM public key in it")
    body = _PEM_WRAP.sub("", match.group("body"))
    if _BASE64.fullmatch(body) is None:
        raise Refusal("6", "the PEM body is not base64")
    der = base64.b64decode(body, validate=True)
    if not der.startswith(_SPKI_ED25519_PREFIX) or len(der) != len(_SPKI_ED25519_PREFIX) + 32:
        raise Refusal("6", "not an Ed25519 SubjectPublicKeyInfo")
    fingerprint = hashlib.sha256(der).hexdigest()
    stated = os.path.basename(filename)[:-4] if filename.endswith(".pub") else ""
    return PublicKey(
        fingerprint=fingerprint,
        raw=der[len(_SPKI_ED25519_PREFIX) :],
        der=der,
        filename=filename,
        name_matches_material=(stated == fingerprint) if stated else True,
    )


def load_keyring(
    record_root: str,
) -> tuple[dict[str, PublicKey], list[str], list[tuple[str, str]]]:
    """Every `keys/*.pub` under the record root, indexed by recomputed fingerprint.

    Gap G03: that `keys/` is where they live is inferred from the frozen records, not from
    the document. Returns the ring, the list of files whose name disagrees with their
    contents, and the files that hold no key, each with the reason - all of them refusals the
    caller reports, not ones this function raises, so one bad key does not hide a good record.

    A FILE THAT HOLDS NO KEY IS REFUSED, NEVER RAISED. A `.pub` that is a directory, whose
    bytes are not UTF-8, or that holds no PEM-wrapped Ed25519 `SubjectPublicKeyInfo` used to
    stop this reader with a traceback (the directory, the text that is no key) or be refused
    here while the product read on (the bytes that are not UTF-8). Section 6 has a reader
    recompute each name from the material, and a file with no material has a name that stands
    for no key, which is what the misnamed file is refused for. Neither is put in the ring.
    """
    from .canonical import utf8_text

    directory = os.path.join(record_root, "keys")
    ring: dict[str, PublicKey] = {}
    misnamed: list[str] = []
    no_key: list[tuple[str, str]] = []
    if not os.path.isdir(directory):
        return ring, misnamed, no_key
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".pub"):
            continue
        path = os.path.join(directory, name)
        if not os.path.isfile(path):
            no_key.append((name, NOT_A_FILE))
            continue
        with open(path, "rb") as handle:
            raw = handle.read()
        try:
            key = parse_pem(utf8_text(raw), path)
        except Refusal as refusal:
            no_key.append((name, refusal.what))
            continue
        if not key.name_matches_material:
            misnamed.append(name)
        ring[key.fingerprint] = key
    return ring, misnamed, no_key
