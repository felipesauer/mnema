"""Walk a record on disk and produce a verdict.

The layout is GAP G01. FORMAT.md opens section 4 with "a tail is a JSONL file", and a tail
is a DIRECTORY: segments, a checkpoints file, a tail proof, and a witness directory, with
the public keys one level up. Nothing in the document says any of that except one
incidental path in section 8. This is what the walker assumes, and it says so on every run:

    <record>/keys/<fingerprint>.pub            gap G03
    <record>/tails/<tailId>/NNNNNN.jsonl       gap G01, gap G15
    <record>/tails/<tailId>/checkpoints.jsonl  gap G13
    <record>/tails/<tailId>/tailproof.json     gap G10
    <record>/tails/<tailId>/witness/<checkpointHash>.ots and .blocks   section 8

The four checks, by the names the product's own document uses for them:

    T1  the hash chain: every entry's stored hash is the hash of its content and position
    T2  the content root: each checkpoint's root folds over the events of its range
    T4  the signature: Ed25519 over the canonical bytes, by the key the fingerprint names
    T3  the external witness: the proof's subject, the merkle fold, and the block's work
"""

from __future__ import annotations

import os
import re
from typing import NamedTuple

from . import bitcoin, ots
from .canonical import canonical_bytes
from .checkpoint import Checkpoint, read_checkpoint, read_tailproof
from .ed25519 import verify as ed25519_verify
from .entry import ENVELOPE_KEYS, Entry, entry_hash, read_line
from .keys import PublicKey, load_keyring
from .root import content_root, which_reading_closes
from .verdict import Refusal, Report

SEGMENT_NAME = re.compile(r"^[0-9]{6}\.jsonl$")
CHECKPOINTS_FILE = "checkpoints.jsonl"
TAILPROOF_FILE = "tailproof.json"
WITNESS_DIR = "witness"


class Coverage(NamedTuple):
    """Section 8's three-things-together, for one tail."""

    covered: bool
    instant: str
    block: int
    events_after: int
    dates_up_to: int
    last_seq: int

    def sentence(self) -> str:
        if self.covered:
            return (
                f"covered: bitcoin block {self.block} at {self.instant} dates seq "
                f"0..{self.dates_up_to}, which is every event written"
            )
        return (
            f"not covered: bitcoin block {self.block} at {self.instant} dates seq "
            f"0..{self.dates_up_to}, and {self.events_after} event(s) were written after it"
        )


def _lines(path: str) -> list[tuple[int, bytes]]:
    with open(path, "rb") as handle:
        raw = handle.read()
    out: list[tuple[int, bytes]] = []
    for number, line in enumerate(raw.split(b"\n"), start=1):
        if line.strip():
            out.append((number, line))
    return out


def _read_entries(report: Report, tail_dir: str, tail_id: str) -> list[Entry]:
    segments = sorted(name for name in os.listdir(tail_dir) if SEGMENT_NAME.match(name))
    skipped = sorted(
        name
        for name in os.listdir(tail_dir)
        if name.endswith(".jsonl") and not SEGMENT_NAME.match(name)
    )
    report.note(
        "4",
        f"{len(segments)} segment(s) taken as the tail, {len(skipped)} other .jsonl file(s) "
        f"left alone{': ' + ', '.join(skipped) if skipped else ''}",
        tail_id,
        "G01",
    )
    if len(segments) > 1:
        report.note("4", f"a tail of {len(segments)} segments", tail_id, "G15")

    entries: list[Entry] = []
    for name in segments:
        for number, raw in _lines(os.path.join(tail_dir, name)):
            where = f"{name}:{number}"
            try:
                entry = read_line(raw, where)
            except Refusal as refusal:
                report.fail(refusal.section, refusal.what, where)
                continue
            if not entry.line_is_canonical:
                report.fail(
                    "4",
                    "the stored line is not the canonical serialization of what it holds, so "
                    "the bytes on disk are not the bytes the entry hash was taken over",
                    where,
                )
            if set(entry.event) != ENVELOPE_KEYS:
                report.fail(
                    "7",
                    f"envelope keys are {sorted(entry.event)}, not {sorted(ENVELOPE_KEYS)}",
                    where,
                    "G14",
                )
            entries.append(entry)
    return entries


def _check_chain(report: Report, entries: list[Entry], tail_id: str) -> None:
    previous: str | None = None
    expected = 0
    for entry in entries:
        where = entry.source
        if entry.tail != tail_id:
            report.fail("3", f"link.tail is {entry.tail!r}, not the directory it is in", where)
        if entry.seq != expected:
            report.fail(
                "3",
                f"a gap in the sequence: seq {entry.seq} where {expected} was due. This reader "
                "cannot tell an authorized cut from tampering, because the document does not "
                "say what authorizes one",
                where,
                "G09",
            )
            expected = entry.seq
        if entry.prev != previous:
            report.fail("3", f"prev does not chain: {entry.prev} after {previous}", where)
        recomputed = entry_hash(entry.event_bytes, tail_id, entry.seq, entry.prev)
        if recomputed != entry.stored_hash:
            report.fail(
                "3",
                f"the entry hash is {recomputed[:16]}..., and the line stores "
                f"{entry.stored_hash[:16]}...",
                where,
            )
        previous = entry.stored_hash
        expected = entry.seq + 1
    if entries:
        report.ok("3", f"the hash chain closes over {len(entries)} entries", tail_id)


def _check_signature(
    report: Report, ring: dict[str, PublicKey], signer: str, signature: str, message: bytes,
    section: str, where: str,
) -> None:
    key = ring.get(signer)
    if key is None:
        report.unchecked(
            section,
            f"no public key in the keyring has fingerprint {signer[:12]}..., so the signature "
            "could not be checked either way",
            where,
            "G03",
        )
        return
    try:
        raw_signature = bytes.fromhex(signature)
    except ValueError:
        report.fail(section, "the signature is not hex", where)
        return
    if ed25519_verify(key.raw, raw_signature, message):
        report.ok(section, f"the Ed25519 signature verifies under {signer[:12]}...", where)
    else:
        report.fail(
            section,
            f"the Ed25519 signature does not verify under the key whose material hashes to "
            f"{signer[:12]}...",
            where,
        )


def _check_checkpoints(
    report: Report, tail_dir: str, tail_id: str, entries: list[Entry],
    ring: dict[str, PublicKey],
) -> list[Checkpoint]:
    path = os.path.join(tail_dir, CHECKPOINTS_FILE)
    if not os.path.exists(path):
        report.note("6", "no checkpoints file, so nothing is signed here", tail_id, "G13")
        return []

    event_bytes = [entry.event_bytes for entry in entries]
    checkpoints: list[Checkpoint] = []
    previous_hash: str | None = None
    previous_to: int | None = None
    readings: set[str] = set()

    for number, raw in _lines(path):
        where = f"{CHECKPOINTS_FILE}:{number}"
        try:
            checkpoint = read_checkpoint(raw, number)
        except Refusal as refusal:
            report.fail(refusal.section, refusal.what, where)
            continue
        checkpoints.append(checkpoint)
        label = f"{where} {checkpoint.label}"

        if not checkpoint.line_is_canonical:
            report.fail("6", "the stored checkpoint line is not canonical", label, "G13")
        if checkpoint.stored["tail"] != tail_id:
            report.fail("6", "the checkpoint names another tail", label)
        if checkpoint.stored["prev"] != previous_hash:
            report.fail(
                "6",
                f"prev is {checkpoint.stored['prev']}, and the previous checkpoint's signed "
                f"message hashes to {previous_hash}. Dropping an earlier checkpoint while "
                "keeping a later one breaks this link, which is what it is for",
                label,
                "G12",
            )
        if previous_to is not None and checkpoint.from_seq != previous_to + 1:
            report.note(
                "6",
                f"this range starts at {checkpoint.from_seq} and the one before ended at "
                f"{previous_to}; the document does not decide whether that is allowed",
                label,
                "G11",
            )

        if checkpoint.to_seq >= len(entries):
            report.unchecked(
                "5",
                f"the range reaches seq {checkpoint.to_seq} and the tail holds "
                f"{len(entries)} entries, so the root could not be folded",
                label,
            )
        else:
            span = event_bytes[checkpoint.from_seq : checkpoint.to_seq + 1]
            reading = which_reading_closes(span, checkpoint.stored["contentRoot"])
            if reading is None:
                report.fail(
                    "5",
                    "the content root does not match under either reading of the accumulator. "
                    "The root folds over the event CONTENT, so this is what an edited event "
                    "looks like even after every hash in the chain has been repaired",
                    label,
                    "G02",
                )
            else:
                readings.add(reading)
                report.ok(
                    "5",
                    f"the content root folds over seq {checkpoint.from_seq}.."
                    f"{checkpoint.to_seq}",
                    label,
                )

        _check_signature(
            report, ring, checkpoint.stored["signerFp"], checkpoint.stored["sig"],
            checkpoint.message, "6", label,
        )
        previous_hash = checkpoint.message_hash
        previous_to = checkpoint.to_seq

    covered_through = max((cp.to_seq for cp in checkpoints), default=-1)
    residual = len(entries) - (covered_through + 1)
    if residual > 0:
        report.note(
            "6",
            f"{residual} event(s) sit above the last checkpoint and rest on the hash chain "
            "ALONE: no signature covers them, so a party with no key can append or edit there "
            "and every signed statement still verifies. This reader cannot refuse such an "
            "event unless its bytes are malformed - see what is not covered, below",
            tail_id,
            "G08",
        )
    elif entries:
        report.ok(
            "6",
            f"every one of the {len(entries)} entries is covered by a checkpoint that verified, "
            "so there is no keyless window",
            tail_id,
        )

    if readings:
        report.note(
            "5",
            "the accumulator inside frame(acc) travels as " + " and ".join(sorted(readings))
            + ", which the document does not say and the published digests decided",
            tail_id,
            "G02",
        )
    return checkpoints


def _check_tailproof(
    report: Report, tail_dir: str, tail_id: str, ring: dict[str, PublicKey]
) -> None:
    path = os.path.join(tail_dir, TAILPROOF_FILE)
    if not os.path.exists(path):
        return
    with open(path, "rb") as handle:
        raw = handle.read().rstrip(b"\n")
    try:
        proof = read_tailproof(raw)
    except Refusal as refusal:
        report.fail(refusal.section, refusal.what, f"{tail_id}/{TAILPROOF_FILE}")
        return
    report.note(
        "-",
        "there is a signed tailproof.json here, with a scheme the document never mentions",
        tail_id,
        "G10",
    )
    if not proof.file_is_canonical:
        report.fail("-", "tailproof.json is not canonical", tail_id, "G10")
    if proof.stored["tail"] != tail_id:
        report.fail("-", "tailproof.json names another tail", tail_id, "G10")
    _check_signature(
        report, ring, proof.stored["signerFp"], proof.stored["sig"], proof.message,
        "-", f"{tail_id}/{TAILPROOF_FILE}",
    )


def _check_witness(
    report: Report, tail_dir: str, tail_id: str, checkpoints: list[Checkpoint],
    last_seq: int,
) -> Coverage | None:
    directory = os.path.join(tail_dir, WITNESS_DIR)
    if not os.path.isdir(directory):
        report.note("8", "no witness directory: nothing outside this machine attests this tail", tail_id)
        return None

    by_hash = {checkpoint.message_hash: checkpoint for checkpoint in checkpoints}
    best: Coverage | None = None
    pending_seen: list[str] = []

    for name in sorted(os.listdir(directory)):
        if not name.endswith(".ots"):
            continue
        digest = name[:-4]
        where = f"{tail_id}/{WITNESS_DIR}/{name}"
        with open(os.path.join(directory, name), "rb") as handle:
            raw = handle.read()
        try:
            proof = ots.parse(raw)
        except Refusal as refusal:
            report.fail(refusal.section, refusal.what, where)
            continue

        if proof.subject != digest:
            report.fail(
                "8", f"the proof's subject is {proof.subject[:16]}... and the file is named "
                f"{digest[:16]}...", where,
            )
            continue
        checkpoint = by_hash.get(digest)
        if checkpoint is None:
            report.note(
                "8",
                "a proof for a checkpoint this tail does not hold. Nothing in this format "
                "removes a witness file, so an attestation of a checkpoint that is gone is "
                "not by itself wrong",
                where,
            )
            continue
        report.ok(
            "8",
            f"the proof's subject is the SHA-256 of {checkpoint.label}'s signed message, and "
            f"nothing else left the machine",
            where,
        )
        report.note(
            "8",
            f"{proof.size} bytes, deepest path {proof.max_depth} operations against a limit of "
            f"{ots.MAX_PATH_STEPS}",
            where,
            "G20",
        )

        blocks_path = os.path.join(directory, digest + ".blocks")
        if not os.path.exists(blocks_path):
            report.unchecked(
                "8", "no .blocks sidecar, so the attestation cannot be checked offline", where,
            )
            continue
        with open(blocks_path, "rb") as handle:
            headers = bitcoin.read_blocks_sidecar(handle.read())

        used: set[int] = set()
        for attestation in proof.confirmed:
            header = headers.get(attestation.height)
            if header is None:
                report.note(
                    "8",
                    f"the proof attests bitcoin block {attestation.height} and the sidecar has "
                    "no header for it, so that one attestation cannot be folded offline",
                    where,
                    "G19",
                )
                continue
            used.add(attestation.height)
            if header.merkle_root != attestation.folded:
                report.fail(
                    "8",
                    f"the path folds to {attestation.folded.hex()[:16]}... and block "
                    f"{attestation.height}'s header carries "
                    f"{header.merkle_root.hex()[:16]}...",
                    where,
                )
                continue
            if not header.meets_its_own_target():
                report.fail("8", f"block {attestation.height}'s hash does not meet the target it declares", where)
                continue
            if not header.meets_the_declared_floor():
                report.fail(
                    "8",
                    f"block {attestation.height} declares {header.bits:#010x}, easier than the "
                    f"{bitcoin.MINIMUM_BITS:#010x} floor, and a header at an easier target is "
                    "found in milliseconds",
                    where,
                )
                continue
            report.ok(
                "8",
                f"the path folds to block {attestation.height}'s merkle root, and the block's "
                f"own hash meets the target it declares ({header.block_id[:16]}...)",
                where,
            )
            candidate = Coverage(
                covered=checkpoint.to_seq >= last_seq,
                instant=header.instant,
                block=attestation.height,
                events_after=max(0, last_seq - checkpoint.to_seq),
                dates_up_to=checkpoint.to_seq,
                last_seq=last_seq,
            )
            # The NEWEST checkpoint a confirmed attestation reaches, and among the
            # attestations of that checkpoint the EARLIEST block: an attestation in an
            # earlier block is the stronger existence claim, so reporting a later one
            # would understate what the files prove.
            if best is None or (candidate.dates_up_to, -attestation.height) > (
                best.dates_up_to,
                -best.block,
            ):
                best = candidate

        spare = sorted(set(headers) - used)
        if spare:
            report.note(
                "8",
                f"the sidecar carries {len(spare)} header(s) this proof does not use: "
                + ", ".join(str(height) for height in spare),
                where,
                "G16",
            )
        for attestation in proof.pending:
            pending_seen.append(f"{checkpoint.label} at {attestation.uri}")
        for attestation in proof.unusable:
            report.unchecked(
                "8",
                f"an attestation of kind {attestation.kind}, which this reader cannot date "
                "offline",
                where,
            )

    if pending_seen:
        report.note(
            "8",
            f"{len(pending_seen)} request(s) still in flight, which raise no level and satisfy "
            "no requirement, and are not the same thing as being dropped: "
            + "; ".join(pending_seen),
            tail_id,
        )
    if best is not None:
        report.note("8", best.sentence(), tail_id)
    elif not pending_seen:
        report.note("8", "nothing outside this machine attests this tail", tail_id)
    return best


def _check_tail_id(report: Report, tail_id: str, ring: dict[str, PublicKey]) -> None:
    """Section 3's tail id, read as a REQUIREMENT and not as a description (gap G22).

    "A tail id is <signing-key-fingerprint>-<installation-id>". Section 3 states that as a
    fact about the shape, and the fingerprint being a key the record actually CARRIES is
    the part that has to be checked: without it, the per-entry `link.tail == <directory>`
    check only proves a tail is consistent with its own directory name, which whoever
    wrote the directory chose. A tail copied into `tails/<fabricated>/`, relabelled, and
    re-chained - which needs no key at all, the entry hash is keyless - is then counted a
    second time, and everything verifies.

    A tail named by a bare fingerprint with no suffix is accepted: the whole name is the
    fingerprint, which is what an installation that predates the suffix looks like.
    """
    fingerprint = tail_id.split("-", 1)[0]
    if not ring:
        report.unchecked(
            "3", "no keyring, so the tail id's fingerprint could not be checked", tail_id, "G22"
        )
        return
    if fingerprint in ring:
        report.ok(
            "3",
            "the tail id's fingerprint is a key this record carries, so the directory is bound "
            "to the roster rather than to a name whoever wrote it chose",
            tail_id,
            "G22",
        )
    else:
        report.fail(
            "3",
            f"the tail id begins with {fingerprint[:12]}..., which is no key this record "
            "carries: a fabricated or relocated tail",
            tail_id,
            "G22",
        )


def verify_record(root: str, report: Report) -> None:
    if not os.path.isdir(root):
        report.break_out(f"there is no record at {root}")
        return

    ring, misnamed = load_keyring(root)
    for name in misnamed:
        report.fail(
            "6",
            f"the key file {name} is named for a fingerprint its own material does not hash "
            "to, so a signature could be re-pointed at another key by renaming a file",
            gap="G03",
        )
    if ring:
        report.ok(
            "6",
            f"{len(ring)} public key(s), each recomputed from its own material rather than "
            "trusted by filename",
            gap="G03",
        )
    else:
        report.unchecked("6", "no keys/ directory, so no signature can be checked", gap="G03")

    tails_dir = os.path.join(root, "tails")
    if not os.path.isdir(tails_dir):
        report.break_out(f"there is no tails/ directory under {root}")
        return
    tail_ids = sorted(
        name for name in os.listdir(tails_dir) if os.path.isdir(os.path.join(tails_dir, name))
    )
    if not tail_ids:
        report.break_out(f"there are no tails under {tails_dir}")
        return

    for tail_id in tail_ids:
        tail_dir = os.path.join(tails_dir, tail_id)
        _check_tail_id(report, tail_id, ring)
        entries = _read_entries(report, tail_dir, tail_id)
        _check_chain(report, entries, tail_id)
        checkpoints = _check_checkpoints(report, tail_dir, tail_id, entries, ring)
        _check_tailproof(report, tail_dir, tail_id, ring)
        last_seq = entries[-1].seq if entries else -1
        _check_witness(report, tail_dir, tail_id, checkpoints, last_seq)

    declare_scope(report)


def declare_scope(report: Report) -> None:
    """What this verifier does NOT check, said on every run including a verified one."""
    report.declare_not_covered(
        "6",
        "that the signer was ENROLLED - authorized for its anchor at that point in the chain",
        "enrolment is not in the document at all. Section 6 asks that the signature verify "
        "under signerFp, and this reader checks exactly that. key.enrolled and key.revoked are "
        "published kinds with no published semantics, so a signature by any key in keys/ is "
        "accepted here. THIS IS THE ONE PLACE THIS READER ACCEPTS WHAT THE PRODUCT REFUSES",
        "G21",
    )
    report.declare_not_covered(
        "4",
        "the per-kind field rebuild - SO A FORGED FIELD INSIDE A PAYLOAD IS ACCEPTED",
        "the field declarations of each kind are published nowhere: canonical-vectors.json gives "
        "one exemplar per kind, from which required and optional cannot be told apart. Byte "
        "identity of the stored line catches a field added to a line that was already written, "
        "because the stored hash no longer matches - but not a NEWLY APPENDED event above the "
        "last checkpoint, whose entry hash the appender computes and whose envelope keys are all "
        "present. Measured: an event appended keylessly with an extra key inside its payload is "
        "read as VERIFIED here and as unreadable by the product. This is the SECOND of the two "
        "places this reader accepts what the product refuses, and the one that a party with no "
        "key can actually walk through",
        "G08",
    )
    report.declare_not_covered(
        "7",
        "that a proof is never recomputed over a lifted reading",
        "no published vector carries v > 1 and no upcaster is published, so there is nothing "
        "from outside to lift. The claim is checkable only from inside today",
        "G18",
    )
    report.declare_not_covered(
        "3",
        "telling an authorized cut from tampering",
        "the word waiver appears once in the whole document, inside a test path. A sequence gap "
        "is reported and located; whether it was authorized cannot be read from here",
        "G09",
    )
    report.declare_not_covered(
        "8",
        "the stored header's place in the Bitcoin chain",
        "section 8 says this itself: the header is checked for its work, not for its place. "
        "A reader who needs that follows the block id into an explorer, or runs the ots client "
        "against a node",
    )
    report.declare_not_covered(
        "1",
        "the refusal of an explicit undefined property, over a record on disk",
        "JSON has no undefined, so no line can carry one. The rule is exercised through an "
        "in-memory sentinel in self-test and is unreachable from a file",
        "G06",
    )
