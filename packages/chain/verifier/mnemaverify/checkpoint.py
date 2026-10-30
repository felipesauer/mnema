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

Section 6.10 adds a second scheme of each, read beside the first: mnema-checkpoint/2 signs the
seven keys and `record`, the name of the record the tail belongs to, and mnema-tail/2 signs
`{"record","scheme","signerFp","tail"}`. `prev` links across the two, each checkpoint hashed
under its own scheme.

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
import unicodedata
from typing import Any, NamedTuple

from .canonical import canonical_bytes, strict_loads, utf8_text
from .verdict import Refusal

CHECKPOINT_SCHEME = "mnema-checkpoint/1"
CHECKPOINT_KEYS = ("contentRoot", "fromSeq", "prev", "scheme", "signerFp", "tail", "toSeq")
CHECKPOINT_LINE_KEYS = frozenset({*CHECKPOINT_KEYS, "sig"})

NAMED_CHECKPOINT_SCHEME = "mnema-checkpoint/2"
NAMED_CHECKPOINT_KEYS = tuple(sorted((*CHECKPOINT_KEYS, "record")))

TAILPROOF_SCHEME = "mnema-tail/1"
TAILPROOF_KEYS = ("scheme", "signerFp", "tail")
TAILPROOF_LINE_KEYS = frozenset({*TAILPROOF_KEYS, "sig"})

NAMED_TAILPROOF_SCHEME = "mnema-tail/2"
NAMED_TAILPROOF_KEYS = ("record", "scheme", "signerFp", "tail")

# The keys each scheme signs, in the order a refusal of an unknown one names the schemes.
CHECKPOINT_SCHEMES = {CHECKPOINT_SCHEME: CHECKPOINT_KEYS, NAMED_CHECKPOINT_SCHEME: NAMED_CHECKPOINT_KEYS}
TAILPROOF_SCHEMES = {TAILPROOF_SCHEME: TAILPROOF_KEYS, NAMED_TAILPROOF_SCHEME: NAMED_TAILPROOF_KEYS}


def signed_message(stored: dict[str, Any], keys: tuple[str, ...]) -> bytes:
    return canonical_bytes({key: stored[key] for key in keys})


class Checkpoint(NamedTuple):
    stored: dict[str, Any]
    message: bytes
    message_hash: str
    line_is_canonical: bool
    # A field named like `tuple.index`, which mypy reads as an override. The field shadows the
    # method on every Python, and nothing here calls the method.
    index: int  # type: ignore[assignment]

    @property
    def from_seq(self) -> int:
        return int(self.stored["fromSeq"])

    @property
    def to_seq(self) -> int:
        return int(self.stored["toSeq"])

    @property
    def label(self) -> str:
        return f"cp[{self.from_seq}..{self.to_seq}]"

    @property
    def record(self) -> str | None:
        """The record a `/2` checkpoint names; None under `/1`."""
        return self.stored.get("record") if self.stored["scheme"] == NAMED_CHECKPOINT_SCHEME else None


# Section 6's set, written out because "trimmed" is not one rule across languages: this is
# what JavaScript's `String.prototype.trim` removes (WhiteSpace and LineTerminator), and it is
# NOT what Python's `str.strip()` removes - that one also takes U+001C to U+001F and U+0085,
# so `strip()` would call two identities the same that the product calls different.
IDENTITY_TRIM = (
    "\u0009\u000a\u000b\u000c\u000d   "
    "           "
    "    　﻿"
)


def canonical_identity(value: str) -> str:
    """The form `which` and `who` are compared in: NFC, then trimmed of IDENTITY_TRIM."""
    return unicodedata.normalize("NFC", value).strip(IDENTITY_TRIM)


def binding_break(events: list[dict[str, Any]], signer_fp: Any) -> tuple[int, str] | None:
    """Section 6's binding of a range's events to the checkpoint that signs it.

    Every event in the range names the checkpoint's `signerFp`, and its `which`, when present,
    is not its `who`. Returns the offset of the first event that breaks it, and which half.
    """
    for offset, event in enumerate(events):
        if event.get("signerFp") != signer_fp:
            return offset, "signer"
        which, who = event.get("which"), event.get("who")
        if isinstance(which, str) and isinstance(who, str):
            if canonical_identity(which) == canonical_identity(who):
                return offset, "which"
    return None


def _scheme_named(value: Any) -> str:
    """A scheme this reader does not know, as both readers name it in the refusal.

    A string by its `repr`, an absent or null one as `None`, and any other value by its JSON
    type alone (section 4), whose spelling a reader in another language need not share: `1.0`
    reads back as `1` in a reader whose numbers are all floats.
    """
    if isinstance(value, str) or value is None:
        return repr(value)
    if isinstance(value, bool):
        return "a boolean"
    if isinstance(value, (int, float)):
        return "a number"
    return "an array" if isinstance(value, list) else "an object"


def _scheme_not_read(what: str, scheme: Any, family: str, read: dict[str, Any]) -> str:
    """The refusal of a scheme this reader does not read, and, for one of the family, which
    schemes it does read: the product names the mnema that refuses, this reader its schemes."""
    said = f"a {what} scheme this reader does not know: {_scheme_named(scheme)}"
    if not isinstance(scheme, str) or not scheme.startswith(family):
        return said
    return f"{said}: this reader reads {' and '.join(read)}"


def _record_field(stored: dict[str, Any], section: str, what: str) -> None:
    record = stored.get("record")
    if not isinstance(record, str) or not record:
        raise Refusal(section, f"{what} missing string \"record\"")


def read_checkpoint(raw: bytes, index: int) -> Checkpoint:
    stored = strict_loads(utf8_text(raw))
    if not isinstance(stored, dict):
        raise Refusal("6", "a checkpoint line that is not a JSON object")
    scheme = stored.get("scheme")
    if not isinstance(scheme, str) or scheme not in CHECKPOINT_SCHEMES:
        # Section 6: a reader refuses a scheme it does not know rather than guessing at
        # the fields. Refusing BEFORE looking at the other keys is what makes that true.
        raise Refusal(
            "6", _scheme_not_read("checkpoint", scheme, "mnema-checkpoint/", CHECKPOINT_SCHEMES)
        )
    keys = CHECKPOINT_SCHEMES[scheme]
    missing = sorted((set(keys) | {"sig"}) - set(stored))
    extra = sorted(set(stored) - set(keys) - {"sig"})
    if missing or extra:
        raise Refusal("6", f"checkpoint keys: missing {missing}, unexpected {extra}")
    if scheme == NAMED_CHECKPOINT_SCHEME:
        _record_field(stored, "6.10", "checkpoint")
    for name in ("fromSeq", "toSeq"):
        if not isinstance(stored[name], int) or isinstance(stored[name], bool):
            raise Refusal("6", f"{name} is not an integer: {stored[name]!r}")
    if stored["fromSeq"] > stored["toSeq"]:
        raise Refusal("6", f"an inverted range: fromSeq {stored['fromSeq']} > toSeq {stored['toSeq']}")
    if stored["prev"] is not None and not isinstance(stored["prev"], str):
        raise Refusal("6", f"prev is neither a string nor null: {stored['prev']!r}")
    message = signed_message(stored, keys)
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

    @property
    def record(self) -> str | None:
        """The record a `/2` proof names; None under `/1`."""
        return self.stored.get("record") if self.stored["scheme"] == NAMED_TAILPROOF_SCHEME else None


def read_tailproof(raw: bytes) -> TailProof:
    stored = strict_loads(utf8_text(raw))
    if not isinstance(stored, dict):
        raise Refusal("-", "a tail proof that is not a JSON object")
    scheme = stored.get("scheme")
    if not isinstance(scheme, str) or scheme not in TAILPROOF_SCHEMES:
        raise Refusal("-", _scheme_not_read("tail-proof", scheme, "mnema-tail/", TAILPROOF_SCHEMES))
    keys = TAILPROOF_SCHEMES[scheme]
    line_keys = frozenset({*keys, "sig"})
    if set(stored) != line_keys:
        raise Refusal("-", f"tail-proof keys are {sorted(stored)}, not {sorted(line_keys)}")
    if scheme == NAMED_TAILPROOF_SCHEME:
        _record_field(stored, "6.10", "tail proof")
    return TailProof(
        stored=stored,
        message=signed_message(stored, keys),
        file_is_canonical=canonical_bytes(stored) == raw,
    )
