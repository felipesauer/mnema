"""Section 5 - the content root.

    acc0     = SHA-256( frame("mnema.root.v1") || frame("empty") )
    acc(i+1) = SHA-256( frame("mnema.root.v1") || frame(acc_i) || frame(bytes(event_i)) )
    root     = acc_n                       (hex, lower-case)

GAP G02. The document does not say whether the accumulator inside frame(acc_i) travels as
the lower-case hex it is finally reported as, or as the raw 32 bytes it is a digest of.
Both readings are grammatical and they produce different roots, so an implementer working
only from the document has a coin flip and no clue which way it landed. Both are computed
here, `which_reading_closes` says which one the published digests pick, and the record
walker names it in its output.

The load-bearing invariant of the whole format is this section: the root is folded over
the event CONTENT, never over stored entry hashes. An adversary who edits an event and
then repairs every hash in the chain leaves the signed head unchanged - and the root
still moves. `mutations` in the suite is that claim, run.
"""

from __future__ import annotations

from typing import Iterable, Literal

from .framed import digest

ROOT_DOMAIN = "mnema.root.v1"

Reading = Literal["raw", "hex"]
READINGS: tuple[Reading, ...] = ("raw", "hex")


def empty_root() -> str:
    return digest(ROOT_DOMAIN, "empty")


def content_root(event_bytes: Iterable[bytes], reading: Reading = "raw") -> str:
    acc = empty_root()
    for payload in event_bytes:
        carried = bytes.fromhex(acc) if reading == "raw" else acc
        acc = digest(ROOT_DOMAIN, carried, payload)
    return acc


def which_reading_closes(event_bytes: list[bytes], expected: str) -> Reading | None:
    """Let the published digest decide, rather than deciding for it."""
    for reading in READINGS:
        if content_root(event_bytes, reading) == expected:
            return reading
    return None
