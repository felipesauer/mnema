"""Section 3 - the entry hash - and section 4 - the stored line.

Domain `mnema.entry.v1`, five fields in this order:

  1  the event's canonical bytes (section 1)      the bytes
  2  the tail id                                  UTF-8 of the string
  3  the sequence number                          UTF-8 of its DECIMAL spelling
  4  the predecessor's entry hash                 UTF-8, or an EMPTY FIELD when none
  5  a literal                                    `genesis` with no predecessor, else `linked`

Fields 4 and 5 exist together so that a genesis entry and an entry whose predecessor is
the empty string produce different digests - an empty field is not the same as an absent
one only because field 5 says which case it was.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from .canonical import canonical_bytes, is_canonical_line
from .framed import digest
from .verdict import Refusal

ENTRY_DOMAIN = "mnema.entry.v1"

# Gap G14: the envelope is specified nowhere in the document. These seven keys are the
# intersection of the top-level keys of all 23 published vectors, so the list is derived
# from published DATA rather than from the code - and `vectors` re-derives it on every run
# and refuses if the intersection moves, so this constant cannot drift silently.
ENVELOPE_KEYS = frozenset({"v", "kind", "at", "who", "signerFp", "subject", "payload"})

LINK_KEYS = frozenset({"hash", "prev", "seq", "tail"})
LINE_KEYS = frozenset({"event", "link"})


def entry_hash(event_bytes: bytes, tail: str, seq: int, prev: str | None) -> str:
    return digest(
        ENTRY_DOMAIN,
        event_bytes,
        tail,
        str(seq),
        prev,  # None becomes an empty field; a str becomes its UTF-8
        "genesis" if prev is None else "linked",
    )


class Entry(NamedTuple):
    event: dict[str, Any]
    event_bytes: bytes
    seq: int
    tail: str
    prev: str | None
    stored_hash: str
    line_is_canonical: bool
    source: str


def read_line(raw: bytes, source: str) -> Entry:
    """Parse one stored line, with section 4's byte identity as part of the parse.

    Section 4: the line carries the event as it was written, so the bytes on disk are the
    bytes the entry hash was taken over, and re-serializing an entry read back from a
    line reproduces that line byte for byte. The recomputed-equals-stored check is what
    refuses a forged extra field - a key no writer of this format would have put there
    moves the bytes even when every hash in the line is repaired.
    """
    canonical_ok, value = is_canonical_line(raw)
    if not isinstance(value, dict):
        raise Refusal("4", "a stored line that is not a JSON object")
    if set(value) != LINE_KEYS:
        raise Refusal("4", f"top-level keys are {sorted(value)}, not ['event', 'link']")
    event, link = value["event"], value["link"]
    if not isinstance(event, dict) or not isinstance(link, dict):
        raise Refusal("4", "event and link must both be objects")
    if set(link) != LINK_KEYS:
        raise Refusal("4", f"link keys are {sorted(link)}, not {sorted(LINK_KEYS)}")
    if not isinstance(link["seq"], int) or isinstance(link["seq"], bool):
        raise Refusal("4", f"link.seq is not an integer: {link['seq']!r}")
    if link["prev"] is not None and not isinstance(link["prev"], str):
        raise Refusal("4", f"link.prev is neither a string nor null: {link['prev']!r}")
    if link["prev"] == "":
        # Section 4 is explicit: a genesis link is a null prev, never an empty string.
        raise Refusal("4", "link.prev is the empty string, and a genesis link is null")
    if not isinstance(link["hash"], str) or not isinstance(link["tail"], str):
        raise Refusal("4", "link.hash and link.tail must be strings")
    return Entry(
        event=event,
        event_bytes=canonical_bytes(event),
        seq=link["seq"],
        tail=link["tail"],
        prev=link["prev"],
        stored_hash=link["hash"],
        line_is_canonical=canonical_ok,
        source=source,
    )
