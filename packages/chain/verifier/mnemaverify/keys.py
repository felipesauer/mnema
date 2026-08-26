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


class PublicKey(NamedTuple):
    fingerprint: str
    raw: bytes
    der: bytes
    filename: str
    name_matches_material: bool


def parse_pem(text: str, filename: str = "") -> PublicKey:
    match = _PEM.search(text)
    if match is None:
        raise Refusal("6", f"not a PEM public key: {filename or '<text>'}")
    try:
        der = base64.b64decode("".join(match.group("body").split()), validate=True)
    except (ValueError, TypeError) as exc:
        raise Refusal("6", f"the PEM body is not base64: {filename}") from exc
    if not der.startswith(_SPKI_ED25519_PREFIX) or len(der) != len(_SPKI_ED25519_PREFIX) + 32:
        raise Refusal("6", f"not an Ed25519 SubjectPublicKeyInfo: {filename}")
    fingerprint = hashlib.sha256(der).hexdigest()
    stated = os.path.basename(filename)[:-4] if filename.endswith(".pub") else ""
    return PublicKey(
        fingerprint=fingerprint,
        raw=der[len(_SPKI_ED25519_PREFIX) :],
        der=der,
        filename=filename,
        name_matches_material=(stated == fingerprint) if stated else True,
    )


def load_keyring(record_root: str) -> tuple[dict[str, PublicKey], list[str]]:
    """Every `keys/*.pub` under the record root, indexed by recomputed fingerprint.

    Gap G03: that `keys/` is where they live is inferred from the frozen records, not from
    the document. Returns the ring and the list of files whose name disagrees with their
    contents - which is a refusal the caller reports, not one this function raises, so one
    bad key does not hide a good record.
    """
    directory = os.path.join(record_root, "keys")
    ring: dict[str, PublicKey] = {}
    misnamed: list[str] = []
    if not os.path.isdir(directory):
        return ring, misnamed
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".pub"):
            continue
        path = os.path.join(directory, name)
        with open(path, encoding="utf-8") as handle:
            key = parse_pem(handle.read(), path)
        if not key.name_matches_material:
            misnamed.append(name)
        ring[key.fingerprint] = key
    return ring, misnamed
