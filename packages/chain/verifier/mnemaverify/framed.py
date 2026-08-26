"""Section 2 - framed, domain-separated hashing.

    digest = SHA-256( frame(domain) || frame(field1) || frame(field2) || ... )
    frame(bytes) = uint32_be(len(bytes)) || bytes

The frame is what makes the field boundaries unambiguous. Without it "a" + "bc" and
"ab" + "c" are the same byte stream, so two different field tuples collide without any
SHA-256 collision. Section 2 says exactly that, and `selftest` builds the pair.

A field given as `str` is its UTF-8; a field given as `None` is an empty field, which is
four zero bytes and nothing after them - that is what section 3's field 4 needs.
"""

from __future__ import annotations

import hashlib
import struct

Field = bytes | str | None


def frame(field: Field) -> bytes:
    raw = b"" if field is None else field.encode("utf-8") if isinstance(field, str) else field
    return struct.pack(">I", len(raw)) + raw


def digest(domain: str, *fields: Field) -> str:
    """Hex, lower-case - which is what `hexdigest` gives and what section 5 asks for."""
    h = hashlib.sha256()
    h.update(frame(domain))
    for field in fields:
        h.update(frame(field))
    return h.hexdigest()


def digest_raw(domain: str, *fields: Field) -> bytes:
    return bytes.fromhex(digest(domain, *fields))
