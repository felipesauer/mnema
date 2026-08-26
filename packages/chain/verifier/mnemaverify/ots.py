"""Section 8's `.ots` file: OpenTimestamps' own format, unaltered.

This is the one part of the format where FORMAT.md being terse costs nothing, and it says
why: the `.ots` is "OpenTimestamps' own format, unaltered", so the specification a stranger
needs is the ecosystem's, not this product's. This parser was written from that format -
the header magic, the varuint and varbytes encodings, the operation tags, the fork byte and
the attestation tags - and from nothing in this repository.

What section 8 asks of a proof read offline, and where each one is:

  the proof's subject equals the checkpoint's digest    -> `subject`, compared by the caller
  the path folds to the merkle root the header carries  -> `Attestation.folded`
  the header's own hash meets the target it declares    -> bitcoin.py

THE THREE DECLARED LIMITS ARE REFUSALS, and each is refused BY NAME. Section 8 declares
them rather than leaving them to a stack, and gives the measurements: a real proof is eight
or nine steps per calendar, 3,586 bytes complete, and folds messages of about a hundred
bytes, so each limit has one to four orders of magnitude of room. A limit that can only
reject an exotic proof and never accept a hostile one is a limit worth having.
"""

from __future__ import annotations

import hashlib
from typing import Literal, NamedTuple

from .verdict import Refusal

MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"

MAX_PATH_STEPS = 1000
MAX_PROOF_BYTES = 1024 * 1024
MAX_FOLDED_BYTES = 4 * 1024

_OP_APPEND = 0xF0
_OP_PREPEND = 0xF1
_OP_REVERSE = 0xF2
_OP_HEXLIFY = 0xF3
_OP_SHA1 = 0x02
_OP_RIPEMD160 = 0x03
_OP_SHA256 = 0x08
_OP_KECCAK256 = 0x67

_DIGEST_LENGTHS = {_OP_SHA1: 20, _OP_RIPEMD160: 20, _OP_SHA256: 32, _OP_KECCAK256: 32}

_TAG_PENDING = bytes.fromhex("83dfe30d2ef90c8e")
_TAG_BITCOIN = bytes.fromhex("0588960d73d71901")
_TAG_LITECOIN = bytes.fromhex("06869a0d73d71b45")
_TAG_ETHEREUM = bytes.fromhex("30fe8087b5c7ead7")

Kind = Literal["bitcoin", "pending", "litecoin", "ethereum", "unknown"]


class Attestation(NamedTuple):
    """One leaf of the proof: what it claims, and the message the path folded to there."""

    kind: Kind
    folded: bytes
    depth: int
    height: int | None = None
    uri: str | None = None

    @property
    def label(self) -> str:
        if self.kind == "bitcoin":
            return f"bitcoin block {self.height}"
        if self.kind == "pending":
            return f"pending at {self.uri}"
        return self.kind


class Proof(NamedTuple):
    subject: str
    subject_op: str
    attestations: tuple[Attestation, ...]
    max_depth: int
    size: int

    @property
    def confirmed(self) -> tuple[Attestation, ...]:
        return tuple(a for a in self.attestations if a.kind == "bitcoin")

    @property
    def pending(self) -> tuple[Attestation, ...]:
        return tuple(a for a in self.attestations if a.kind == "pending")

    @property
    def unusable(self) -> tuple[Attestation, ...]:
        """Attestations this verifier holds but cannot turn into a date offline."""
        return tuple(a for a in self.attestations if a.kind in ("litecoin", "ethereum", "unknown"))


class _Reader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.at = 0

    def bytes(self, count: int) -> bytes:
        if self.at + count > len(self.data):
            raise Refusal("8", "a proof that ends in the middle of a field")
        out = self.data[self.at : self.at + count]
        self.at += count
        return out

    def byte(self) -> int:
        return self.bytes(1)[0]

    def varuint(self) -> int:
        value, shift = 0, 0
        while True:
            piece = self.byte()
            value |= (piece & 0x7F) << shift
            if not piece & 0x80:
                return value
            shift += 7
            if shift > 63:
                raise Refusal("8", "a varuint wider than 64 bits")

    def varbytes(self) -> bytes:
        return self.bytes(self.varuint())


def _apply(tag: int, message: bytes, reader: _Reader) -> bytes:
    if tag == _OP_APPEND:
        return message + reader.varbytes()
    if tag == _OP_PREPEND:
        return reader.varbytes() + message
    if tag == _OP_REVERSE:
        return message[::-1]
    if tag == _OP_HEXLIFY:
        return message.hex().encode("ascii")
    if tag == _OP_SHA256:
        return hashlib.sha256(message).digest()
    if tag == _OP_SHA1:
        return hashlib.sha1(message).digest()  # noqa: S324 - reading a format, not choosing one
    if tag == _OP_RIPEMD160:
        try:
            digest = hashlib.new("ripemd160")
        except ValueError as exc:
            # OpenSSL 3 moved ripemd160 to the legacy provider. This is an UNCHECKED, not
            # a pass: the caller sees the refusal and reports that it could not fold.
            raise Refusal("8", "a path that folds through ripemd160, which this build of "
                               "OpenSSL will not compute") from exc
        digest.update(message)
        return digest.digest()
    if tag == _OP_KECCAK256:
        raise Refusal("8", "a path that folds through keccak256, which the standard library "
                           "does not have")
    raise Refusal("8", f"an operation tag this reader does not know: {tag:#04x}")


def _attestation(reader: _Reader, message: bytes, depth: int) -> Attestation:
    tag = reader.bytes(8)
    payload = _Reader(reader.varbytes())
    if tag == _TAG_BITCOIN:
        return Attestation("bitcoin", message, depth, height=payload.varuint())
    if tag == _TAG_PENDING:
        return Attestation("pending", message, depth, uri=payload.varbytes().decode("utf-8", "replace"))
    if tag == _TAG_LITECOIN:
        return Attestation("litecoin", message, depth, height=payload.varuint())
    if tag == _TAG_ETHEREUM:
        return Attestation("ethereum", message, depth)
    return Attestation("unknown", message, depth)


def _walk(reader: _Reader, subject: bytes) -> tuple[list[Attestation], int]:
    """Walk the whole proof with an EXPLICIT stack, never the interpreter's.

    This was written recursively first, and the first thing the self-test found was that
    Python's own recursion limit fired at roughly five hundred operations - BEFORE the
    1000-step limit this parser is supposed to enforce by name. Which is the same defect
    section 8 says the product's reader had before its limits existed: "a 30 KB file of one
    repeated byte took the parse past V8's stack". A parser of untrusted input must not use
    the interpreter stack as its depth counter, because then the depth limit it declares is
    unreachable and the refusal it promises is a crash.

    The recursive shape this replaces, for anyone checking the two against each other:

        T(msg, d):  tag = read()
                    while tag == 0xff: { one(read(), msg, d); tag = read() }
                    one(tag, msg, d)
        one(tag, msg, d): attestation(msg, d) if tag == 0x00
                          else T(apply(tag, msg), d + 1)

    A fork pushes the point to come back to; a branch ends at the attestation it bottoms
    out in; the pop resumes the enclosing fork loop with the message and depth it had.
    Every iteration consumes at least one byte, so the walk cannot fail to terminate.
    """
    found: list[Attestation] = []
    resume: list[tuple[bytes, int]] = []
    message, depth, deepest = subject, 0, 0

    while True:
        if depth > MAX_PATH_STEPS:
            raise Refusal("8", f"a path deeper than {MAX_PATH_STEPS} steps")
        if len(message) > MAX_FOLDED_BYTES:
            raise Refusal("8", f"a message a path has folded past {MAX_FOLDED_BYTES} bytes")
        deepest = max(deepest, depth)

        tag = reader.byte()
        if tag == 0xFF:  # a fork: this message continues down more than one path
            resume.append((message, depth))
            continue
        if tag == 0x00:
            found.append(_attestation(reader, message, depth))
            if not resume:
                return found, deepest
            message, depth = resume.pop()
            continue
        message, depth = _apply(tag, message, reader), depth + 1


def parse(raw: bytes) -> Proof:
    if len(raw) > MAX_PROOF_BYTES:
        raise Refusal("8", f"a proof past {MAX_PROOF_BYTES} bytes")
    reader = _Reader(raw)
    if reader.bytes(len(MAGIC)) != MAGIC:
        raise Refusal("8", "not an OpenTimestamps detached proof")
    version = reader.varuint()
    if version != 1:
        raise Refusal("8", f"an OpenTimestamps major version this reader does not know: {version}")
    op = reader.byte()
    if op not in _DIGEST_LENGTHS:
        raise Refusal("8", f"a file-hash operation this reader does not know: {op:#04x}")
    subject = reader.bytes(_DIGEST_LENGTHS[op])
    found, depth = _walk(reader, subject)
    if reader.at != len(raw):
        raise Refusal("8", f"{len(raw) - reader.at} trailing bytes after the proof")
    names = {_OP_SHA256: "sha256", _OP_SHA1: "sha1", _OP_RIPEMD160: "ripemd160", _OP_KECCAK256: "keccak256"}
    return Proof(
        subject=subject.hex(),
        subject_op=names[op],
        attestations=tuple(found),
        max_depth=depth,
        size=len(raw),
    )
