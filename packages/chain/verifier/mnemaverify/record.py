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

And two that are readings rather than checks, so they name and never refuse:

    6.4 a note or a link taken back by an identity that did not write it, named as not
        applied (`retraction`)
    6.7 the workflows: every move judged at its point in the merged order, against the tables
        `event-schema.json` publishes, and a move they do not allow named as not applied
        (`workflow`)
"""

from __future__ import annotations

import json
import os
import re
from typing import NamedTuple

from . import bitcoin, enrolment, gaps, ots, retraction, schema, workflow
from .canonical import CRLF, ends_in_crlf_only, utf16_order
from .checkpoint import Checkpoint, binding_break, read_checkpoint, read_tailproof
from .ed25519 import verify as ed25519_verify
from .entry import Entry, entry_hash, read_line
from .keys import HOLDS_NO_KEY, PublicKey, load_keyring
from .root import which_reading_closes
from .verdict import Refusal, Report

SEGMENT_NAME = re.compile(r"^[0-9]{6}\.jsonl$")
CHECKPOINTS_FILE = "checkpoints.jsonl"
TAILPROOF_FILE = "tailproof.json"
WITNESS_DIR = "witness"
SIGSTORE_SUFFIX = ".sigstore.json"


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
    """Every line of a `.jsonl` that CLAIMS to be one, numbered from 1.

    ONLY A ZERO-LENGTH LINE IS DROPPED, and the distinction is the whole function. A file
    written with a trailing newline splits into a final empty piece that was never a line,
    so dropping the empty ones is reading the terminator rather than skipping content. This
    used to drop every line that was blank AFTER `.strip()`, which quietly took whitespace
    with it - and section 4 says each line of a segment is the CANONICAL serialization
    (section 1) of the stored object, section 6 says the checkpoints are "one canonical line
    each", and section 1.6 says canonical bytes carry "no insignificant whitespace". A line
    of spaces is therefore not a line this format has, and passing over it is a leniency the
    document does not license.

    MEASURED, BEFORE IT WAS A REFUSAL: one line of a single space appended to
    `checkpoints.jsonl` - or to a segment - left this reader saying VERIFIED, exit 0, over
    bytes the product refuses as UNREADABLE. That is the asymmetry class this suite declares
    closed (G21, G08) with a member alive in it, and it arrived on the one file the freshness
    probe never stats at all. A whitespace line now reaches the parser like any other and is
    refused under section 1, located by file and number, by the rule that was already there.
    """
    with open(path, "rb") as handle:
        raw = handle.read()
    out: list[tuple[int, bytes]] = []
    for number, line in enumerate(raw.split(b"\n"), start=1):
        if line:
            out.append((number, line))
    return out


def _torn_line(path: str) -> int | None:
    """The number of the file's last line when no newline ends it - the piece a crash leaves.

    THE ONE TOLERANCE AN APPEND-ONLY FILE EARNS, and the product's rule (`parseStoredLine`):
    every complete append ends in a newline, so an interrupted one leaves exactly an
    unterminated last piece. A caller drops that piece when it does not read - and only then,
    and only in the file whose end is the end of the stream (the tail's last segment, the
    checkpoints). Any other line that does not read, terminated or not, is still refused.
    It holds when the crash cut the piece inside a multi-byte character: those bytes are a
    torn write, not a line that is not UTF-8.
    """
    with open(path, "rb") as handle:
        raw = handle.read()
    if raw == b"" or raw.endswith(b"\n"):
        return None
    return raw.count(b"\n") + 1


TORN = (
    "ends in a partial line that was dropped - the mark of a write interrupted mid-append, "
    "and indistinguishable from an appended fragment"
)


def _read_entries(
    report: Report, tail_dir: str, tail_id: str, declarations: schema.Schema | None
) -> tuple[list[Entry], list[str], int]:
    """The entries a tail holds, WHERE each line this reader refused to read was, and how many
    entries stand before the first of those.

    A refused line is not an entry, and the checks that count entries by position (the chain
    walk, the root fold) cannot be run over a list with a hole in it: the hole reads as a
    gap in the sequence, a `prev` that does not chain and a root that does not fold, three
    findings that name a cut or an edit the record does not contain. The caller therefore
    gets the places back, and says "not checked" about the checks the hole would make lie.
    """
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
    refused: list[str] = []
    before_refused = -1
    for name in segments:
        path = os.path.join(tail_dir, name)
        # Only the LAST segment's end is the tail's end: an earlier one's is a seal.
        torn = _torn_line(path) if name == segments[-1] else None
        for number, raw in _lines(path):
            where = f"{name}:{number}"
            try:
                entry = read_line(raw, where)
                if number == torn and not entry.line_is_canonical:
                    raise Refusal("4", "not canonical")
            except Refusal as refusal:
                if number == torn:
                    report.note("4", f"the tail {TORN}", where)
                    continue
                report.fail(refusal.section, refusal.what, where)
                if not refused:
                    before_refused = len(entries)
                refused.append(where)
                continue
            if not entry.line_is_canonical:
                report.fail(
                    "4",
                    "the stored line is not the canonical serialization of what it holds"
                    + (
                        f": {CRLF}"
                        if ends_in_crlf_only(raw)
                        else ", so the bytes on disk are not the bytes the entry hash was "
                        "taken over"
                    ),
                    where,
                )
            _check_declarations(report, declarations, entry, where)
            entries.append(entry)
    return entries, refused, len(entries) if before_refused < 0 else before_refused


def _check_declarations(
    report: Report, declarations: schema.Schema | None, entry: Entry, where: str
) -> None:
    """Section 4.1: rebuild the event from exactly what its contract declares.

    THIS REPLACED A CHECK THAT WAS STRICTER THAN THE FORMAT (gap G25). With no published
    declarations, the envelope had to be guessed at, and the only derivation available was
    the INTERSECTION of the top-level keys of the published vectors - which section 7 stated
    as a fact ("the seven top-level keys of an event are ...") and which is not the envelope
    at all. `which` was carried by sixteen of the twenty-three vectors published when this was found
    (October 2026) and `run` by three, so
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
    like a check and is not one: nothing can turn it red, so a reader of this file would take
    it for coverage it does not give.
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


def _check_chain(
    report: Report, entries: list[Entry], tail_id: str, refused: list[str]
) -> None:
    if refused:
        report.unchecked(
            "3",
            f"the hash chain was not walked: {refused[0]} was refused above, and a chain read "
            "past a line this reader could not read would report a gap, a broken prev and a "
            "root that does not fold, none of which the record contains",
            tail_id,
        )
        return
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


def _check_binding(
    report: Report, span: list[Entry], signer: object, label: str
) -> bool:
    """Section 6: every event in a checkpoint's range names that checkpoint's signer.

    The checkpoint is the one thing that proves which key signed the range; an event's own
    `signerFp` is a claim inside the bytes it signed. This reader used to fold that claim into
    section 6.2 unchecked, so the holder of a checker key could write an event naming the
    person's key, sign the checkpoint with the checker's, and section 6.2 saw the person. The
    product refused that record and this reader verified it.
    """
    found = binding_break([entry.event for entry in span], signer)
    if found is None:
        return True
    offset, half = found
    seq = span[offset].seq
    if half == "signer":
        report.fail(
            "6",
            f"seq {seq} names a signer other than the checkpoint that signs its range: every "
            "event in a checkpoint's range names that checkpoint's signerFp, because the "
            "checkpoint is what proves who signed it",
            label,
        )
    else:
        report.fail(
            "6",
            f"seq {seq}: its `which` is its `who` in their canonical form, an identity "
            "authorizing itself, which no event in a signed range may say",
            label,
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
    ring: dict[str, PublicKey], refused: list[str],
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

    torn = _torn_line(path)
    for number, raw in _lines(path):
        where = f"{CHECKPOINTS_FILE}:{number}"
        try:
            checkpoint = read_checkpoint(raw, number)
            if number == torn and not checkpoint.line_is_canonical:
                raise Refusal("6", "not canonical")
        except Refusal as refusal:
            if number == torn:
                report.note("6", f"the checkpoints file {TORN}", where)
                continue
            report.fail(refusal.section, refusal.what, where)
            continue
        checkpoints.append(checkpoint)
        label = f"{where} {checkpoint.label}"

        if not checkpoint.line_is_canonical:
            report.fail(
                "6",
                "the stored checkpoint line is not canonical"
                + (f": {CRLF}" if ends_in_crlf_only(raw) else ""),
                label,
                "G13",
            )
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
        if refused:
            report.unchecked(
                "5",
                f"the root could not be folded: {refused[0]} was refused above, so the entries "
                "this range covers are not all known",
                label,
            )
        elif checkpoint.to_seq >= len(entries):
            # WHY THIS IS UNCHECKED AND NOT A FAIL, and why it cites G09. A signed
            # checkpoint naming events the tail does not hold looks like the record
            # contradicting itself, and the product reads it that way (`broken`). But a cut
            # that removed events and left checkpoints.jsonl alone leaves the checkpoints
            # that covered them standing over nothing (section 6 chains them by `prev`,
            # which catches an earlier one dropped and not the last ones, so a cut may also
            # take the last ones with their events and leave nothing to see). A range with
            # no entries under it is a shape an AUTHORIZED cut may leave, and section 3
            # says of exactly this that a party reading only the document "cannot tell an
            # authorized cut from tampering, and the honest thing for them to do is report
            # the gap and stop". This is that report, and the stop.
            report.unchecked(
                "5",
                f"the range reaches seq {checkpoint.to_seq} and the tail holds "
                f"{len(entries)} entries, so the root could not be folded",
                label,
                "G09",
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
        # The binding is judged over a range whose signature VERIFIED, as the product judges
        # it: a signature that fails already says nothing about who signed the range.
        if root_held and signed and _check_binding(
            report, entries[checkpoint.from_seq : checkpoint.to_seq + 1],
            checkpoint.stored["signerFp"], label,
        ):
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
        # Section 6.1: the proof sits beside the segments of EVERY tail, and it is the only
        # thing that stops a party with no key copying a tail under a real fingerprint and a
        # forged installation suffix. The product refuses a tail without one, and this
        # reader used to pass over the absence in silence, so the two disagreed on exactly
        # the record the proof exists to refuse.
        report.fail(
            "6.1",
            "this tail has no tailproof.json, so nothing shows that the key its id names "
            "ever signed that id",
            tail_id,
        )
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
        report.fail(
            "-",
            "tailproof.json is not canonical" + (f": {CRLF}" if ends_in_crlf_only(raw) else ""),
            tail_id,
            "G10",
        )
    if proof.stored["tail"] != tail_id:
        report.fail("-", "tailproof.json names another tail", tail_id, "G10")
    # Section 6.1: the signature is "under the key `signerFp` names, which is the fingerprint
    # the tail id begins with". The key is looked up by the TAIL ID, as the product looks it
    # up. This reader used to look it up by the proof's own `signerFp`, so a proof any other
    # key of the record signed over this tail's id, naming itself, verified here and was
    # refused by the product: the two readers disagreed on who owns a tail.
    owner = _tail_fingerprint(tail_id)
    signer = proof.stored["signerFp"]
    if signer != owner:
        report.fail(
            "6.1",
            f"tailproof.json names {str(signer)[:12]}... as its signer, and the key that signs it is "
            f"the one the tail id begins with, {owner[:12]}... (signer-mismatch)",
            f"{tail_id}/{TAILPROOF_FILE}",
        )
        return
    _check_signature(
        report, ring, owner, proof.stored["sig"], proof.message,
        "-", f"{tail_id}/{TAILPROOF_FILE}",
    )


TAIL_SIGNER_MISMATCH = "tail-signer-mismatch"


def _check_tail_signer(
    report: Report, tail_id: str, entries: list[Entry], checkpoints: list[Checkpoint]
) -> None:
    """Section 6: a tail belongs to one key, and only that key writes to it.

    Every checkpoint of the tail and every event of it names as `signerFp` the fingerprint the
    tail id begins with. The checkpoint loop checks a signature under the key the checkpoint's
    OWN `signerFp` names and binds its range to that key, so neither asks whose tail it is: a
    second key of the record, enrolled for the anchor, could write its events into another
    key's tail and sign a checkpoint over them there. An event above the last checkpoint has
    no checkpoint to be bound to, so this is a pass over every event, not over the ranges.
    Each half is said once per tail, at the first that breaks, as the product says it, and in
    the product's words.
    """
    owner = _tail_fingerprint(tail_id)
    said = (
        f"a tail is written only by the key its id begins with, {owner[:12]}... "
        f"({TAIL_SIGNER_MISMATCH})"
    )
    for checkpoint in sorted(checkpoints, key=lambda cp: cp.from_seq):
        signer = checkpoint.stored["signerFp"]
        if signer != owner:
            report.fail(
                "6",
                f"checkpoint cp[{checkpoint.from_seq}..{checkpoint.to_seq}] is signed by "
                f"{str(signer)[:12]}..., and {said}",
                tail_id,
            )
            break
    for entry in entries:
        signer = entry.event.get("signerFp")
        if signer != owner:
            report.fail(
                "6", f"seq {entry.seq} names {str(signer)[:12]}... as its signer, and {said}", tail_id
            )
            break


def _tail_fingerprint(tail_id: str) -> str:
    """The key a tail id names: everything before its last `-`, as the product splits it."""
    return tail_id.rsplit("-", 1)[0]


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
        if name.endswith(SIGSTORE_SUFFIX):
            report.note(
                "8",
                "a Sigstore bundle, NOT CHECKED by this reader: it neither raises nor lowers "
                "the verdict",
                f"{tail_id}/{WITNESS_DIR}/{name}",
                "G26",
            )
            continue
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
        # A sidecar this reader refuses - a line that is not canonical, a duplicate key - used
        # to escape as a traceback, so the verifier printed no verdict at all over a record
        # whose chain it had already checked. The sidecar is not part of the chain: refusing
        # it leaves the attestation uncheckable offline, which is what a missing one says.
        try:
            with open(blocks_path, "rb") as handle:
                headers = bitcoin.read_blocks_sidecar(handle.read())
        except Refusal as refusal:
            report.unchecked(
                "8",
                f"the .blocks sidecar was refused ({refusal.what}), so the attestation cannot "
                "be checked offline",
                where,
            )
            continue

        used: set[int] = set()
        for attestation in proof.confirmed:
            # `confirmed` holds only bitcoin attestations, and `ots` builds each of those with
            # its height, so the `None` a type checker sees in `height` cannot reach here.
            header = headers.get(attestation.height)  # type: ignore[arg-type]
            if header is None:
                report.note(
                    "8",
                    f"the proof attests bitcoin block {attestation.height} and the sidecar has "
                    "no header for it, so that one attestation cannot be folded offline",
                    where,
                    "G19",
                )
                continue
            used.add(attestation.height)  # type: ignore[arg-type]
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
                block=attestation.height,  # type: ignore[arg-type]
                events_after=max(0, last_seq - checkpoint.to_seq),
                dates_up_to=checkpoint.to_seq,
                last_seq=last_seq,
            )
            # The NEWEST checkpoint a confirmed attestation reaches, and among the
            # attestations of that checkpoint the EARLIEST block: an attestation in an
            # earlier block is the stronger existence claim, so reporting a later one
            # would understate what the files prove.
            if best is None or (candidate.dates_up_to, -attestation.height) > (  # type: ignore[operator]
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


REQUIREMENTS = ("chained", "signed")


def _check_requirement(
    report: Report, require: str, entries_by_tail: dict[str, list[Entry]],
    covered_by_tail: dict[str, int],
) -> None:
    """What the caller said it would accept, held against what the walk above established.

    `chained` is the default and asks for nothing the walk has not already refused on. `signed`
    asks that a signature cover EVERY event of EVERY tail, and that at least one did: a record
    with no event above the last checkpoint and none a checkpoint reached is not signed, it is
    empty, and "signed" over nothing is the sentence this refuses to say. It refuses by
    `fail`, which is the same exit as any other refusal: a caller that gates on this reader
    gets one answer for "something is wrong" and one for "what I asked for is not there".

    Both numbers come from the same `covered_through` the section 6.2 note counts with, so
    the note and this refusal cannot disagree about how many events sit above the last
    checkpoint that VERIFIED.
    """
    if require != "signed":
        return
    covered = sum(covered_by_tail[tail] + 1 for tail in entries_by_tail)
    above = sum(
        len(entries_by_tail[tail]) - (covered_by_tail[tail] + 1) for tail in entries_by_tail
    )
    if covered == 0:
        report.fail(
            "6",
            "requirement not met: --require=signed needs every event covered by a checkpoint "
            "that verified, and no checkpoint verified over any event, so nothing here is signed",
        )
    elif above > 0:
        report.fail(
            "6",
            f"requirement not met: --require=signed needs every event covered by a checkpoint "
            f"that verified, and {above} event(s) sit above the last one and rest on the hash "
            "chain alone",
        )
    else:
        report.ok(
            "6",
            f"--require=signed is met: all {covered} event(s) are covered by a checkpoint "
            "that verified",
        )


def verify_record(root: str, report: Report, require: str = "chained") -> None:
    declare_scope(report)
    if not os.path.isdir(root):
        report.break_out(f"there is no record at {root}")
        return

    ring, misnamed, no_key = load_keyring(root)
    for name, why in no_key:
        report.fail("6", f"the key file keys/{name} {HOLDS_NO_KEY}: {why}", f"keys/{name}")
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
    tail_ids = (
        sorted(
            (name for name in os.listdir(tails_dir) if os.path.isdir(os.path.join(tails_dir, name))),
            key=utf16_order,
        )
        if os.path.isdir(tails_dir)
        else []
    )

    declarations = _load_declarations(report)

    entries_by_tail: dict[str, list[Entry]] = {}
    covered_by_tail: dict[str, int] = {}
    # The tails whose FIRST line this reader refused, before any entry of theirs: where it was.
    refused_first: dict[str, str] = {}
    for tail_id in tail_ids:
        tail_dir = os.path.join(tails_dir, tail_id)
        _check_tail_id(report, tail_id, ring)
        if _holds_nothing(tail_dir):
            _say_empty_tail(report, tail_dir, tail_id, ring)
            continue
        entries, refused, before_refused = _read_entries(report, tail_dir, tail_id, declarations)
        _check_chain(report, entries, tail_id, refused)
        found = _check_checkpoints(report, tail_dir, tail_id, entries, ring, refused)
        _check_tail_signer(report, tail_id, entries, found.checkpoints)
        _check_tailproof(report, tail_dir, tail_id, ring)
        last_seq = entries[-1].seq if entries else -1
        _check_witness(report, tail_dir, tail_id, found.checkpoints, last_seq)
        entries_by_tail[tail_id] = entries
        covered_by_tail[tail_id] = found.covered_through
        if refused and before_refused == 0:
            refused_first[tail_id] = refused[0]

    resolution = _check_enrolment(report, entries_by_tail, covered_by_tail, ring, refused_first)
    _check_retractions(report, entries_by_tail)
    not_applied = _check_moves(report, entries_by_tail, declarations)
    _check_rewrites(report, entries_by_tail, not_applied)
    _say_keys_without_tail(report, ring, tail_ids, resolution)
    _refuse_a_record_no_tail_holds(report, tails_dir, tail_ids, entries_by_tail)
    _check_requirement(report, require, entries_by_tail, covered_by_tail)


NO_TAIL_HELD = "no tail in this record holds an event or a checkpoint"


def _refuse_a_record_no_tail_holds(
    report: Report, tails_dir: str, tail_ids: list[str], entries_by_tail: dict[str, list[Entry]]
) -> None:
    """Section 4: a record in which no tail holds an event or a checkpoint asserts no fact.

    No tails/ directory, no tail directory in it, or only tails that hold nothing - which section 4
    does not count - and the record is refused by name, at every --require, with the exit of any
    other refusal. These used to be two early stops that said BROKEN and returned before section
    6.5 ran, while the same nothing with a tail proof left behind said VERIFIED. It runs AFTER
    section 6.5, so each committed key with no tail is still named. A path with no directory at it
    is still BROKEN: there is no record there to refuse.
    """
    if entries_by_tail:
        return
    if not os.path.isdir(tails_dir):
        why = "there is no tails/ directory"
    elif not tail_ids:
        why = "there are no tails"
    else:
        why = "every tail in it holds no event and no checkpoint"
    report.fail(
        "4",
        f"{NO_TAIL_HELD}: {why}, so the record asserts no fact, and nothing verifies over "
        "nothing",
        "tails/",
    )


def _check_retractions(report: Report, entries_by_tail: dict[str, list[Entry]]) -> None:
    """Section 6.4: a retraction by an identity that did not write what it names - named, never
    refused, because the event is intact and its key speaks for its own `who`."""
    for found in retraction.foreign_retractions(entries_by_tail):
        report.note("6.4", f"{found.detail} (rule {found.rule})", f"{found.tail} seq {found.seq}")


def _check_rewrites(
    report: Report, entries_by_tail: dict[str, list[Entry]], not_applied: set[tuple[str, int]]
) -> None:
    """Section 6.8: every writing of a decision that is not its text - named, never refused, for
    the reason a foreign retraction is not. `not_applied` is the (tail, seq) of every move section
    6.7 does not apply; empty when the tables could not be read, and then every move judges."""
    for found in retraction.decision_rewrites(entries_by_tail, not_applied):
        report.note("6.8", f"{found.detail} (rule {found.rule})", f"{found.tail} seq {found.seq}")


def _check_moves(
    report: Report,
    entries_by_tail: dict[str, list[Entry]],
    declarations: schema.Schema | None,
) -> set[tuple[str, int]]:
    """Section 6.7, over the merged order of every tail: the moves the workflows do not allow.

    Each is NAMED and none is refused - a move the workflow does not allow is intact, chained
    and signed, and what it lacks is a place in the workflow - so a record that holds one
    verifies, and its verdict says which move is not applied and by which rule.
    """
    if declarations is None:
        return set()  # Section 4.1 has already said the declarations could not be read.
    try:
        tables = workflow.load(declarations.workflows, declarations.path)
    except Refusal as refusal:
        report.unchecked(
            "6.7",
            f"{refusal.what}, so no move of a workflow was judged",
            declarations.path,
        )
        return set()
    merged = enrolment.merged_order(entries_by_tail)
    moves = sum(
        1
        for _tail, entry in merged.order
        if entry.event.get("kind") in tables or entry.event.get("kind") == workflow.RUN_ENDED
    )
    rulings = workflow.judge(merged.order, merged.held, tables)
    for ruling in rulings:
        report.note(
            "6.7",
            f"a {ruling.kind} of {json.dumps(ruling.subject, ensure_ascii=True)}: {ruling.detail} "
            f"- the workflow does not allow it, so it is not applied (rule {ruling.rule})",
            f"{ruling.tail} seq {ruling.seq}",
        )
    if moves and not rulings:
        report.ok(
            "6.7",
            f"every one of the {moves} move(s) is one the workflows allow, judged at its point in "
            "the merged order against the tables event-schema.json publishes",
        )
    return {(ruling.tail, ruling.seq) for ruling in rulings}


def _holds_nothing(tail_dir: str) -> bool:
    """Section 4: a tail with no event and no checkpoint is not counted as a tail.

    A line is anything `_lines` returns, so a line of whitespace is a line here, and the
    tail holding one is read and refused like any other rather than passed over as empty.
    """
    names = os.listdir(tail_dir)
    for name in names:
        if (SEGMENT_NAME.match(name) or name == CHECKPOINTS_FILE) and _lines(
            os.path.join(tail_dir, name)
        ):
            return False
    return True


def _say_empty_tail(
    report: Report, tail_dir: str, tail_id: str, ring: dict[str, PublicKey]
) -> None:
    """Section 4: said once, and folded into nothing, with its ownership still checked.

    Read as a tail, it said four things about nothing - no segment, no checkpoint, no witness -
    and none of them was false; what was wrong was that a reader counted it. Its proof is
    still checked, because a tail directory whose key never signed its id is a refusal
    whether or not it holds anything. A witness directory in it, about a checkpoint it does
    not hold, is still read, so a proof there that does not parse is still refused.
    """
    report.note(
        "4",
        "this tail holds no event and no checkpoint, so it asserts nothing and is not counted "
        "as a tail: what an older writer left when a first write was refused, and what a tail "
        "emptied of its events with its ownership proof kept looks like too",
        tail_id,
    )
    _check_tailproof(report, tail_dir, tail_id, ring)
    if os.path.isdir(os.path.join(tail_dir, WITNESS_DIR)):
        _check_witness(report, tail_dir, tail_id, [], -1)


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
    refused_first: dict[str, str],
) -> enrolment.Resolution | None:
    """Section 6.2, folded over every tail at once, because enrolment spans them.

    The fold reads every entry this reader could read, a tail with a refused line included, so
    what a refused line held is missing from it and a cause may be that line's consequence: the
    record is refused at the line already, and the causes are said as the fold finds them. One
    consequence is not named, because it is certain: a refused FOUNDING (`refused_first`,
    `_unread_foundings`). Its key is valid for its anchor from that line on or never, and the
    reader cannot tell which, so the events that key signed for its own anchor are said once as
    not judged instead of each as signed by a key not enrolled.
    """
    if not ring:
        report.unchecked(
            "6.2",
            "no keyring, so an enrolment's reverse signature could not be checked and the "
            "fold was not run",
            gap="G21",
        )
        return None
    total = sum(len(entries) for entries in entries_by_tail.values())
    if total == 0:
        return None
    resolution = enrolment.resolve(entries_by_tail, covered_by_tail, ring)
    # "Reading many tails": what the order made of the citations, said and never judged.
    for tail, seq, cited in resolution.not_held:
        report.note(
            "6.2",
            f"the event cites {cited[:12]}..., an entry this record does not hold - ignored in "
            "the order, which places the event as if it cited nothing",
            f"{tail[:20]}... seq {seq}",
        )
    behind_by_tail: dict[str, list[int]] = {}
    for tail, _seq, gap in resolution.behind:
        behind_by_tail.setdefault(tail, []).append(gap)
    for tail, behind in behind_by_tail.items():
        report.note(
            "6.2",
            f"{len(behind)} event(s) stamped before an entry they cite: the writer's clock ran "
            f"behind what it had read, by up to {max(behind) / 1000:.3f} s - the order puts each "
            "after what it cites",
            f"{tail[:20]}...",
        )
    # Section 6.2, "What a reader learns from it": who the accepted facts name as their agent, and
    # on whose word. Said and never judged - the product's census says the same counts.
    for agent_fp, anchor, name, count in resolution.attested:
        report.note(
            "6.2",
            f'{count} event(s) attested by an agent key enrolled as "{name}" '
            f"({agent_fp[:12]}, for {anchor[:17]})",
        )
    for which, count in resolution.declared:
        report.note(
            "6.2",
            f'{count} event(s) name the agent "{which}": declared by the key that signed, '
            "not attested",
        )
    # An agent key the record retired, after the facts it signed while it held the role: the same
    # count the product's census names, and for the same reason - "before" is the place the `at`
    # the key itself wrote gives a fact.
    for agent_fp, by, count in resolution.retired_agents:
        report.note(
            "6.2",
            f"{count} event(s) signed by the agent key {agent_fp[:12]} before {by[:17]} retired it "
            "- authentic, since the key held the role when it signed, and no longer vouched for: "
            "an event is placed before a retirement by the time the key itself wrote",
        )
    issues = resolution.issues
    unjudged = _unjudged_for_an_unread_founding(
        report, issues, entries_by_tail, _unread_foundings(entries_by_tail, refused_first)
    )
    for issue in issues:
        if issue not in unjudged:
            report.fail("6.2", issue.detail, f"{issue.tail[:20]}... seq {issue.seq}", "G21")
    if not issues:
        report.ok(
            "6.2",
            f"every one of the {total} event(s) is signed by a key VALID FOR ITS ANCHOR at "
            "its point in the fold, which is a stronger claim than the signature verifying",
            gap="G21",
        )
    return resolution


def _unread_foundings(
    entries_by_tail: dict[str, list[Entry]], refused_first: dict[str, str]
) -> dict[str, tuple[str, str]]:
    """The keys whose founding is a line this reader refused: key -> (its tail, where the line was).

    Section 6.2: an identity is founded by `identity.founded`, self-signed by its founding key,
    whose `subject` is that key's anchor - the fact that enrols the identity's FIRST key, and the
    only one that can, since every other enrolment is signed by a key the anchor already holds.
    Section 3: a tail id begins with the fingerprint of the key that writes it. So when a tail's
    first line is refused, before any entry of the tail was read, and no line this reader did
    read founds the anchor of that tail's key, the refused line is the one place that founding
    can stand, and the key is "not enrolled" only because the line did not read. A refused line
    anywhere else, or a first line whose key some line read does found, is not this.
    """
    founded: set[str] = set()
    for entries in entries_by_tail.values():
        for entry in entries:
            event = entry.event
            if event.get("kind") != "identity.founded":
                continue
            payload = event.get("payload")
            founding = payload.get("foundingFp") if isinstance(payload, dict) else None
            for named in (event.get("subject"), founding):
                if isinstance(named, str):
                    founded.add(named)
    unread: dict[str, tuple[str, str]] = {}
    for tail_id, where in refused_first.items():
        key = tail_id.split("-", 1)[0]
        if key in founded or enrolment.anchor_of(key) in founded:
            continue
        unread[key] = (tail_id, where)
    return unread


def _unjudged_for_an_unread_founding(
    report: Report,
    issues: list[enrolment.Issue],
    entries_by_tail: dict[str, list[Entry]],
    unread: dict[str, tuple[str, str]],
) -> list[enrolment.Issue]:
    """The causes of section 6.2 an unread founding accounts for, said once per key as not judged.

    Only one cause: an event signed by the key the refused line would have founded, refused
    because that key is not valid for the key's OWN anchor. Whether it is depends on that line
    alone, so the event is not judged. Any other cause stands as the fold finds it - an event
    the key signed for another anchor, one signed by another key (an agent the founding key
    enrolled included) - because the founding would not have changed it; and nothing positive
    is said that the fold would not say, since the fold itself is the one read with every line.
    """
    if not unread:
        return []
    signer_of = {
        (tail, entry.seq): entry.event.get("signerFp")
        for tail, entries in entries_by_tail.items()
        for entry in entries
    }
    by_key: dict[str, list[enrolment.Issue]] = {}
    for issue in issues:
        signer = signer_of.get((issue.tail, issue.seq))
        if (
            isinstance(signer, str)
            and signer in unread
            and issue.not_valid_for == enrolment.anchor_of(signer)
        ):
            by_key.setdefault(signer, []).append(issue)
    for key, unjudged in by_key.items():
        tail_id, where = unread[key]
        report.unchecked(
            "6.2",
            f"{len(unjudged)} event(s) signed by {key[:12]}... for its own anchor were not "
            f"judged: the first line of its tail, {where}, was refused above, and no line this "
            "reader read founds that anchor, so the refused line is where the founding stands "
            "and whether the key was valid for its anchor rests on it",
            tail_id,
            "G21",
        )
    return [issue for unjudged in by_key.values() for issue in unjudged]


def _say_keys_without_tail(
    report: Report,
    ring: dict[str, PublicKey],
    tail_ids: list[str],
    resolution: enrolment.Resolution | None,
) -> None:
    """Section 6.5: a committed key with no tail, said as a backup only when the record says so.

    A key's fingerprint is the id of the tail it writes - the whole name, or the part before
    the last `-` - so `keys/` is a roster of the tails that should exist. A key with none is
    either a backup, which signs nothing until it is restored, or a key whose tail is gone, and
    only a covered `backup.declared` naming a key the identity still holds tells them apart.
    Both are notes: an absence is not something this reader can refuse.
    """
    with_tail = {tail_id.rsplit("-", 1)[0] if "-" in tail_id else tail_id for tail_id in tail_ids}
    backups = resolution.backups if resolution is not None else {}
    members = resolution.members if resolution is not None else {}
    for fingerprint in sorted(ring):
        if fingerprint in with_tail:
            continue
        anchor = backups.get(fingerprint)
        if anchor is not None and fingerprint in members.get(anchor, set()):
            report.note(
                "6.5",
                f"the committed key {fingerprint} has no tail, and the record declares it the "
                f"backup of {anchor}, which signs nothing until it is restored",
            )
            continue
        if anchor is not None:
            report.note(
                "6.5",
                f"the committed key {fingerprint} has no tail on disk, and the record declared it "
                f"a backup of {anchor}, which that identity has since revoked, so the absence is "
                "no longer expected: the tail may have been dropped, never written, or removed",
            )
            continue
        report.note(
            "6.5",
            f"the committed key {fingerprint} has no tail on disk, and the record declares no "
            "backup for it: the tail may have been dropped, never written, or removed (a backup "
            "made before backups were declared in the record reads this way too)",
        )


def declare_scope(report: Report) -> None:
    """What this reader does NOT check, read off the registry rather than written here.

    THE DEFECT THIS REPLACES. This function used to hold four `declare_not_covered` calls
    with their prose typed into it, and it was one of three places that said the same thing:
    `gaps.py` classified nothing, this said four, and `verifier/README.md` said three. They
    drifted - the README never named G06, and G23, which was then believed to be the one
    place the two readers date the same record differently, was said in NO verdict at all.
    A reader who ran this program and got VERIFIED was never told that the instant it
    printed is this reader's rule and not the document's.

    G23 IS SETTLED NOW, AND IT WAS NOT AN AMBIGUITY EITHER. Section 8 already said "Take
    the earliest confirmed block among them" while the registry still called the question
    open; what was actually wrong was the PRODUCT, which elected the first attestation a
    walk of the proof reached. It elects by height now, the two readers date the frozen
    record from the same block, and the entry left this list by being answered rather than
    by being reworded. The defect this docstring describes is unchanged: one list, one
    source, and a `standing` field that decides.

    So the list has one source: `gaps.scope()`, which reads it off the `standing` field of
    the registry. There is nothing to add here, and nothing that CAN be added here.

    IT RUNS BEFORE ANY CHECK, which is why it is the first thing `verify_record` does. The
    old call site was the last line of the walk, so every `break_out` above it - no record,
    no tails/ directory, no tails - returned a BROKEN verdict with the block missing, on
    exactly the runs where a reader is most likely to fix something and try again. (Only
    "no record" is a `break_out` now; the other two are section 4's refusal.)
    """
    for entry in gaps.scope():
        report.declare_not_covered(
            entry.section, entry.what, entry.why, entry.gap, entry.explore
        )
