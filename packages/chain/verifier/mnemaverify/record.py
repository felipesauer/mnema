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

And two the document did not have until it was measured not having them - each one a place
this reader disagreed with the product, and each one now read from a published rule rather
than inferred from an exemplar:

    4.1 the field declarations: every event rebuilt from exactly what its contract
        declares, so a field no kind declares is refused even on a newly APPENDED event,
        which byte identity alone can never catch (`schema`, gap G08, gap G25)
    6.2 enrolment: the signer of every event is a key VALID FOR ITS ANCHOR at that point
        in the fold, which is a different claim from "the signature verifies"
        (`enrolment`, gap G21)
"""

from __future__ import annotations

import os
import re
from typing import NamedTuple

from . import bitcoin, enrolment, ots, schema
from .checkpoint import Checkpoint, read_checkpoint, read_tailproof
from .ed25519 import verify as ed25519_verify
from .entry import Entry, entry_hash, read_line
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


def _read_entries(
    report: Report, tail_dir: str, tail_id: str, declarations: schema.Schema | None
) -> list[Entry]:
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
            _check_declarations(report, declarations, entry, where)
            entries.append(entry)
    return entries


def _check_declarations(
    report: Report, declarations: schema.Schema | None, entry: Entry, where: str
) -> None:
    """Section 4.1: rebuild the event from exactly what its contract declares.

    THIS REPLACED A CHECK THAT WAS STRICTER THAN THE FORMAT (gap G25). With no published
    declarations, the envelope had to be guessed at, and the only derivation available was
    the INTERSECTION of the top-level keys of the published vectors - which section 7 stated
    as a fact ("the seven top-level keys of an event are ...") and which is not the envelope
    at all. `which` is carried by sixteen of the twenty-three vectors and `run` by three, so
    this reader REFUSED an honest event for carrying one, on a record the product read as
    fine. Accepting too much is the loud failure of a second reader; refusing too much is the
    quiet one, because it looks like rigour.

    WHAT IS NOT DONE HERE, AND WHY IT WAS TAKEN OUT. This used to compare the rebuilt event
    against the stored bytes, "which is what section 4 says the rebuild buys". A mutation
    turning that comparison off left ZERO tests red, and the reason is that it can never
    fire: the rebuild REFUSES every key it does not declare rather than dropping it, and
    copies every value it does declare unchanged, so the rebuilt event is the parsed event
    whenever it is produced at all. A third statement of section 4's byte identity - beside
    the canonical-line check and the entry hash, which do fire - is a line of code that looks
    like a check and is not one, and that is the exact failure this whole delivery is about.
    """
    if declarations is None:
        report.unchecked(
            "4.1",
            "the published field declarations could not be read, so no event could be "
            "rebuilt from its contract",
            where,
            "G08",
        )
        return
    try:
        schema.rebuild(declarations, entry.event)
    except Refusal as refusal:
        report.fail(refusal.section, refusal.what, where, "G08")


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
) -> bool:
    """Answers whether the signature VERIFIED, which is not the same as "nothing refused".

    A key that is not in the ring leaves this UNCHECKED and answers False: section 6.2's
    coverage gate must never treat a signature nobody could check as one that held.
    """
    key = ring.get(signer)
    if key is None:
        report.unchecked(
            section,
            f"no public key in the keyring has fingerprint {signer[:12]}..., so the signature "
            "could not be checked either way",
            where,
            "G03",
        )
        return False
    try:
        raw_signature = bytes.fromhex(signature)
    except ValueError:
        report.fail(section, "the signature is not hex", where)
        return False
    if ed25519_verify(key.raw, raw_signature, message):
        report.ok(section, f"the Ed25519 signature verifies under {signer[:12]}...", where)
        return True
    else:
        report.fail(
            section,
            f"the Ed25519 signature does not verify under the key whose material hashes to "
            f"{signer[:12]}...",
            where,
        )
        return False


class Checkpoints(NamedTuple):
    """What a tail's checkpoints file yielded, and how far a VERIFIED one reaches.

    `covered_through` counts only a checkpoint whose content root folded AND whose signature
    verified - which is what section 6.2 means by signature-covered. Counting a checkpoint
    that failed would hand the enrolment fold a window it has no right to trust, and the
    two gates of 6.2 are exactly about not trusting that window.
    """

    checkpoints: list[Checkpoint]
    covered_through: int


def _check_checkpoints(
    report: Report, tail_dir: str, tail_id: str, entries: list[Entry],
    ring: dict[str, PublicKey],
) -> Checkpoints:
    path = os.path.join(tail_dir, CHECKPOINTS_FILE)
    if not os.path.exists(path):
        report.note("6", "no checkpoints file, so nothing is signed here", tail_id, "G13")
        return Checkpoints([], -1)

    event_bytes = [entry.event_bytes for entry in entries]
    checkpoints: list[Checkpoint] = []
    verified: list[Checkpoint] = []
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

        root_held = False
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
                root_held = True
                report.ok(
                    "5",
                    f"the content root folds over seq {checkpoint.from_seq}.."
                    f"{checkpoint.to_seq}",
                    label,
                )

        signed = _check_signature(
            report, ring, checkpoint.stored["signerFp"], checkpoint.stored["sig"],
            checkpoint.message, "6", label,
        )
        if root_held and signed:
            verified.append(checkpoint)
        previous_hash = checkpoint.message_hash
        previous_to = checkpoint.to_seq

    # Section 6.2's "covered": the highest seq a checkpoint that VERIFIED reaches, which is
    # not the highest seq a checkpoint CLAIMS. A checkpoint whose signature failed proves
    # nothing about the events under it, and treating it as coverage would hand the enrolment
    # fold a window that a keyless party can write in.
    covered_through = max((cp.to_seq for cp in verified), default=-1)
    residual = len(entries) - (covered_through + 1)
    if residual > 0:
        report.note(
            "6",
            f"{residual} event(s) sit above the last checkpoint and rest on the hash chain "
            "ALONE: no signature covers them, so a party with no key can append or edit there "
            "and every signed statement still verifies. What this reader CAN refuse there is "
            "an event whose fields its contract does not declare (section 4.1) and one whose "
            "signer no enrolment authorized (section 6.2); what it cannot tell you is that "
            "the events are otherwise attested, because nothing signed them",
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
    return Checkpoints(checkpoints, covered_through)


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

    declarations = _load_declarations(report)

    entries_by_tail: dict[str, list[Entry]] = {}
    covered_by_tail: dict[str, int] = {}
    for tail_id in tail_ids:
        tail_dir = os.path.join(tails_dir, tail_id)
        _check_tail_id(report, tail_id, ring)
        entries = _read_entries(report, tail_dir, tail_id, declarations)
        _check_chain(report, entries, tail_id)
        found = _check_checkpoints(report, tail_dir, tail_id, entries, ring)
        _check_tailproof(report, tail_dir, tail_id, ring)
        last_seq = entries[-1].seq if entries else -1
        _check_witness(report, tail_dir, tail_id, found.checkpoints, last_seq)
        entries_by_tail[tail_id] = entries
        covered_by_tail[tail_id] = found.covered_through

    _check_enrolment(report, entries_by_tail, covered_by_tail, ring)
    declare_scope(report)


def _load_declarations(report: Report) -> schema.Schema | None:
    """The published field declarations, or None with the reason said out loud.

    A reader that could not load them has not found anything wrong; it has been unable to
    ask, and every event it reads is UNCHECKED under section 4.1 rather than accepted. That
    is the same distinction the keyring makes between REFUSED and INCOMPLETE, and it exists
    here for the same reason: a check that silently did not run looks exactly like a check
    that passed.
    """
    try:
        declarations = schema.load()
    except Refusal as refusal:
        report.unchecked("4.1", refusal.what, schema.DEFAULT_SCHEMA, "G08")
        return None
    if declarations.unknown_rules:
        report.unchecked(
            "4.1",
            "the published declarations use rule(s) this reader does not know: "
            + ", ".join(declarations.unknown_rules)
            + ". A rule it cannot apply is a field it has not checked, said rather than skipped",
            declarations.path,
            "G08",
        )
    for rule in schema.undefined_rules(declarations):
        report.note(
            "4.1",
            f"the published declarations use the rule {rule!r} and their own glossary does "
            "not define it, so a reader with only the file has to guess at it",
            declarations.path,
            "G08",
        )
    report.ok(
        "4.1",
        f"{len(declarations.contracts)} published contract(s) read, so every event is rebuilt "
        "from the fields its kind declares rather than from an exemplar",
        declarations.path,
        "G08",
    )
    return declarations


def _check_enrolment(
    report: Report,
    entries_by_tail: dict[str, list[Entry]],
    covered_by_tail: dict[str, int],
    ring: dict[str, PublicKey],
) -> None:
    """Section 6.2, folded over every tail at once, because enrolment spans them."""
    if not ring:
        report.unchecked(
            "6.2",
            "no keyring, so an enrolment's reverse signature could not be checked and the "
            "fold was not run",
            gap="G21",
        )
        return
    total = sum(len(entries) for entries in entries_by_tail.values())
    if total == 0:
        return
    issues = enrolment.resolve(entries_by_tail, covered_by_tail, ring)
    for issue in issues:
        report.fail("6.2", issue.detail, f"{issue.tail[:20]}... seq {issue.seq}", "G21")
    if not issues:
        report.ok(
            "6.2",
            f"every one of the {total} event(s) is signed by a key VALID FOR ITS ANCHOR at "
            "its point in the fold, which is a stronger claim than the signature verifying",
            gap="G21",
        )


def declare_scope(report: Report) -> None:
    """What this verifier does NOT check, said on every run including a verified one."""
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
