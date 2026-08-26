"""Section 6 - the signed checkpoint - and the tail proof the document does not mention.

The signed message is the canonical bytes (section 1) of these seven keys, and `sig` is
NOT part of it:

  {"contentRoot":...,"fromSeq":0,"prev":...|null,"scheme":"mnema-checkpoint/1",
   "signerFp":...,"tail":...,"toSeq":9}

  contentRoot   section 5 folded over the events of the range, in order
  prev          SHA-256 of the PREVIOUS checkpoint's signed message, or null for the first
  signerFp      the full fingerprint of the signing key, so a signature cannot be re-pointed
  sig           Ed25519 over those bytes, hex, stored alongside
  scheme        mnema-checkpoint/1; an unknown scheme is refused rather than guessed at

GAP G13: the file's name, that it is JSONL, that its line order is the chain order, and
that the stored line is itself canonical are all unwritten. Byte identity is required of
the checkpoint line here anyway, inferred from what section 4 requires of an entry line.

GAP G10: `tailproof.json` is a signed per-tail artifact with `scheme: "mnema-tail/1"` that
appears NOWHERE in FORMAT.md. Five candidate messages were tried against the published
signature; the one that verifies is the same shape as section 6 - canonical bytes of the
object with `sig` removed. Checked here so that an artifact the document forgot is not an
artifact nobody looks at.
"""

from __future__ import annotations

import hashlib
from typing import Any, NamedTuple

from .canonical import canonical_bytes, strict_loads
from .verdict import Refusal

CHECKPOINT_SCHEME = "mnema-checkpoint/1"
CHECKPOINT_KEYS = ("contentRoot", "fromSeq", "prev", "scheme", "signerFp", "tail", "toSeq")
CHECKPOINT_LINE_KEYS = frozenset({*CHECKPOINT_KEYS, "sig"})

TAILPROOF_SCHEME = "mnema-tail/1"
TAILPROOF_KEYS = ("scheme", "signerFp", "tail")
TAILPROOF_LINE_KEYS = frozenset({*TAILPROOF_KEYS, "sig"})


def signed_message(stored: dict[str, Any], keys: tuple[str, ...]) -> bytes:
    return canonical_bytes({key: stored[key] for key in keys})


class Checkpoint(NamedTuple):
    stored: dict[str, Any]
    message: bytes
    message_hash: str
    line_is_canonical: bool
    index: int

    @property
    def from_seq(self) -> int:
        return int(self.stored["fromSeq"])

    @property
    def to_seq(self) -> int:
        return int(self.stored["toSeq"])

    @property
    def label(self) -> str:
        return f"cp[{self.from_seq}..{self.to_seq}]"


def read_checkpoint(raw: bytes, index: int) -> Checkpoint:
    stored = strict_loads(raw.decode("utf-8"))
    if not isinstance(stored, dict):
        raise Refusal("6", "a checkpoint line that is not a JSON object")
    scheme = stored.get("scheme")
    if scheme != CHECKPOINT_SCHEME:
        # Section 6: a reader refuses a scheme it does not know rather than guessing at
        # the fields. Refusing BEFORE looking at the other keys is what makes that true.
        raise Refusal("6", f"a checkpoint scheme this reader does not know: {scheme!r}")
    missing = sorted(set(CHECKPOINT_LINE_KEYS) - set(stored))
    extra = sorted(set(stored) - CHECKPOINT_LINE_KEYS)
    if missing or extra:
        raise Refusal("6", f"checkpoint keys: missing {missing}, unexpected {extra}")
    for name in ("fromSeq", "toSeq"):
        if not isinstance(stored[name], int) or isinstance(stored[name], bool):
            raise Refusal("6", f"{name} is not an integer: {stored[name]!r}")
    if stored["fromSeq"] > stored["toSeq"]:
        raise Refusal("6", f"an inverted range: fromSeq {stored['fromSeq']} > toSeq {stored['toSeq']}")
    if stored["prev"] is not None and not isinstance(stored["prev"], str):
        raise Refusal("6", f"prev is neither a string nor null: {stored['prev']!r}")
    message = signed_message(stored, CHECKPOINT_KEYS)
    return Checkpoint(
        stored=stored,
        message=message,
        message_hash=hashlib.sha256(message).hexdigest(),
        line_is_canonical=canonical_bytes(stored) == raw,
        index=index,
    )


class TailProof(NamedTuple):
    stored: dict[str, Any]
    message: bytes
    file_is_canonical: bool


def read_tailproof(raw: bytes) -> TailProof:
    stored = strict_loads(raw.decode("utf-8"))
    if not isinstance(stored, dict):
        raise Refusal("-", "a tail proof that is not a JSON object")
    if stored.get("scheme") != TAILPROOF_SCHEME:
        raise Refusal("-", f"a tail-proof scheme this reader does not know: {stored.get('scheme')!r}")
    if set(stored) != TAILPROOF_LINE_KEYS:
        raise Refusal("-", f"tail-proof keys are {sorted(stored)}, not {sorted(TAILPROOF_LINE_KEYS)}")
    return TailProof(
        stored=stored,
        message=signed_message(stored, TAILPROOF_KEYS),
        file_is_canonical=canonical_bytes(stored) == raw,
    )
