"""Where FORMAT.md did not suffice.

Every point in this verifier that had to guess, infer, or give up cites a gap by id
from this registry. `mnema_verify.py gaps` prints it, and the verifier's own output
names the ids it leaned on, so a reader of a verdict can tell which parts of it rest
on the document and which rest on a guess.

The registry is the deliverable half of a second implementation: a second reader that
found nothing to write down here would be a reader that copied the first one.
"""

from __future__ import annotations

from typing import Literal, NamedTuple

Resolution = Literal["experiment", "external-spec", "specified", "unresolved"]
# `specified` is the fourth, and it arrived after the first pass: the document GREW the
# rule, so this reader implements it from prose and from a published artifact rather than
# from a guess. It is the only resolution that removes an entry from what this verifier
# declares it does not check - the other three leave the reading resting on something.

Standing = Literal["reader-limit", "record-finding", "settled"]
# WHICH KIND OF HOLE AN UNRESOLVED GAP IS, and the only place that question is answered.
#
# The discriminant is whether this reader can OBSERVE the condition on a record:
#
#   reader-limit    it cannot, on any record. There is no code path that could ever decide
#                   it, so no input makes it go away and SILENCE CARRIES NO INFORMATION.
#                   A verdict that does not say it invites its reader to think it was
#                   answered, so it is said on every run that reads a record.
#   record-finding  it can, and does: the condition is reported by name and with its
#                   location where a record exhibits it. The ABSENCE of that report is
#                   itself information, so announcing it as a general limit would say of
#                   every record what is true of some - the opposite lie.
#   settled         `how` is not `unresolved`: the reading rests on an experiment, on an
#                   external specification, or on the document, and there is no hole.
#
# Nothing else in this file answers it, and nothing outside this file may: `scope()` below
# is the one derivation, and a list of ids typed anywhere else would be a second reading of
# the same fact and would drift from this one, which is how the three lists this field
# exists to reconcile came to disagree in the first place.


class Gap(NamedTuple):
    id: str
    section: str
    what: str
    how: Resolution
    note: str
    standing: Standing
    #: For a `reader-limit` only: what a reader of a verdict does not get, in that reader's
    #: words. It is the `NOT COVERED` line verbatim; `note` is the `why` beneath it.
    not_checked: str = ""


GAPS: tuple[Gap, ...] = (
    Gap(
        "G01",
        "4",
        "the record's layout and the segment naming convention are not written, and "
        '"a tail is a JSONL file" contradicts it: a tail is a DIRECTORY of segments, '
        "with checkpoints.jsonl and tailproof.json beside them",
        "experiment",
        "segments are taken to be ^[0-9]{6}\\.jsonl$, ordered by name, concatenated",
        standing="settled",
    ),
    Gap(
        "G02",
        "5",
        "frame(acc) does not say whether the accumulator travels as hex or as the raw "
        "32 bytes; both readings are grammatical",
        "experiment",
        "both are computed and the published digests pick: RAW bytes",
        standing="settled",
    ),
    Gap(
        "G03",
        "6",
        "the fingerprint derivation is not written, so a stranger loads the key by its "
        'FILENAME and section 6\'s "cannot be re-pointed at another key" is assumed, '
        "not checked",
        "experiment",
        "fp = sha256(DER SubjectPublicKeyInfo); three other derivations were tried and fail",
        standing="settled",
    ),
    Gap(
        "G04",
        "1",
        "number serialization is unspecified beyond -0; Python, Go and JavaScript "
        "disagree on 1.0, 1e-7 and 1e20",
        "external-spec",
        "ECMA-262 Number::toString, inferred from the JSON.stringify anchor in 1.4",
        standing="settled",
    ),
    Gap(
        "G05",
        "1.4",
        "escaping is anchored to a JavaScript implementation rather than stated as a "
        "rule, and Go's encoding/json escapes < > & by default",
        "external-spec",
        "RFC 8259 + ECMA-262, and cross-checked against Node's own JSON.stringify in the suite",
        standing="settled",
    ),
    Gap(
        "G06",
        "1",
        "an explicit undefined property cannot occur in a JSONL line, so the refusal is "
        "unreachable for any reader that only reads files",
        "unresolved",
        "JSON has no undefined, so no line can carry one. The rule is exercised through an "
        "in-memory sentinel in self-test and is unreachable from a file",
        standing="reader-limit",
        not_checked="the refusal of an explicit undefined property, over a record on disk",
    ),
    Gap(
        "G07",
        "1",
        'the refusal of "two keys that normalize to the same string" also has to cover '
        "LITERAL duplicates, which every library JSON parser silently keeps the last of",
        "experiment",
        "a strict reader refuses both; the document should say the refusal reaches both",
        standing="settled",
    ),
    Gap(
        "G08",
        "4",
        "the per-kind field declarations were published nowhere, so section 4's rebuild-and-"
        "reject could not be implemented from the document: an exemplar cannot tell a required "
        "field from an optional one that happens to be present. Measured as an ACCEPTANCE - an "
        "event appended keylessly above the last checkpoint, carrying a field no kind declares, "
        "read as verified here and as unreadable by the product",
        "specified",
        "CLOSED: section 4.1 and event-schema.json publish every contract as (kind, v) with a "
        "rule per field, and this reader rebuilds each event from its own contract. The same "
        "input is refused now, and so is a REQUIRED field left out, which byte identity could "
        "never have caught",
        standing="settled",
    ),
    Gap(
        "G09",
        "3",
        'the word "waiver" appears once in the whole document, inside a test path: what a '
        "waiver is, where it lives and what it signs is not specified, so an authorized cut "
        "is indistinguishable from tampering",
        "unresolved",
        "the word waiver appears once in the whole document, inside a test path. A sequence "
        "gap is reported and located; whether it was authorized cannot be read from here - "
        "and neither can the ABSENCE of one, because a removal that took a whole tail, or "
        "the end of one, leaves nothing discontinuous to report",
        standing="reader-limit",
        not_checked="telling an authorized cut from tampering",
    ),
    Gap(
        "G10",
        "-",
        "tailproof.json is a signed per-tail artifact with scheme mnema-tail/1 and is not "
        "mentioned anywhere in the document",
        "experiment",
        "five candidate messages tried; canonical bytes of {scheme,signerFp,tail} verifies",
        standing="settled",
    ),
    Gap(
        "G11",
        "6",
        "whether consecutive checkpoint ranges must be contiguous is not decided",
        "unresolved",
        "a discontinuity is reported by name and is not turned into a refusal",
        standing="record-finding",
    ),
    Gap(
        "G12",
        "6",
        "the checkpoint's prev is not said to be lower-case hex, though section 5 says it "
        "for the root",
        "experiment",
        "lower-case hex, from the published data",
        standing="settled",
    ),
    Gap(
        "G13",
        "6",
        "the checkpoints file's name, that it is JSONL, that its line order is the chain "
        "order, and that the stored line is itself canonical, are all unwritten",
        "experiment",
        "byte-identity is required of the checkpoint line too, inferred from section 4",
        standing="settled",
    ),
    Gap(
        "G14",
        "7",
        "the event envelope was specified nowhere: section 7 named kind and v, and the other "
        "top-level keys existed only in the published vectors - so the only derivation "
        "available was the INTERSECTION of them, which is not the envelope (see G25)",
        "specified",
        "CLOSED: the envelope is the `envelope` object of event-schema.json, eight names of "
        "which two are optional, and this reader reads it rather than deriving it",
        standing="settled",
    ),
    Gap(
        "G15",
        "4",
        "the mapping from sequence number to segment file is not written: which segment holds "
        "seq N, whether a segment may be empty, what starts a new one",
        "experiment",
        "concatenate by name order; contiguity is checked over the concatenation",
        standing="settled",
    ),
    Gap(
        "G16",
        "8",
        "the .blocks sidecar may carry headers the proof does not use, and the pairing is by "
        "the height the attestation declares; neither is written",
        "experiment",
        "paired by height; unused headers are counted and reported",
        standing="settled",
    ),
    Gap(
        "G17",
        "8",
        "the compact nBits expansion and the little-endian comparison of the double-SHA256 are "
        'not named, though "bytes 36-68, internal order" is named for the merkle root',
        "external-spec",
        "Bitcoin header serialization; 0x1800ffff checks out as 0xffff * 2**168",
        standing="settled",
    ),
    Gap(
        "G18",
        "7",
        "no published vector carries v > 1 and no upcaster is published, so section 7's claim is "
        "checkable only from inside - which is the self-compatibility a second implementation "
        "exists in order not to be",
        "unresolved",
        "no published vector carries v > 1 and no upcaster is published, so there is nothing "
        "from outside to lift. The claim is checkable only from inside today",
        standing="reader-limit",
        not_checked="that a proof is never recomputed over a lifted reading",
    ),
    Gap(
        "G19",
        "8",
        "the .blocks sidecar may carry FEWER headers than the proof has bitcoin attestations, "
        "and the document does not say whether a missing header is an incomplete file to refuse "
        "or a normal absence to ignore",
        "unresolved",
        "measured: witnessed-record attests blocks 963688/963689/963690 and ships two headers; "
        "963689 has none. Reported by name, not refused",
        standing="record-finding",
    ),
    Gap(
        "G20",
        "8",
        'the unit of the "1000 steps" limit is undefined, and the "eight or nine steps per '
        'calendar" that justifies its headroom does not close with any count this reader can '
        "construct",
        "unresolved",
        "measured on the three frozen proofs: 8-14 operations to a calendar's pending leaf, "
        "77-83 to a bitcoin leaf. A step is taken to be one operation, the earlier-refusing "
        "reading, and the measured depth is printed rather than cited",
        standing="record-finding",
    ),
    Gap(
        "G21",
        "6",
        "enrolment was not in the document at all: the product requires the signer to be a key "
        "VALID FOR ITS ANCHOR at that point in the chain, and section 6 asked only that the "
        "signature verify under signerFp. key.enrolled and key.revoked were published kinds with "
        "no published semantics - the bytes of the facts that carry the authorization were "
        "published and the rule that reads them was not",
        "specified",
        "CLOSED: section 6.2 gives the anchor derivation, the fold order across tails, the three "
        "facts and their conditions, and the two signature-coverage gates. Implemented from it, "
        "and earned by two mutations - one with no key at all, one with a checkpoint genuinely "
        "signed by a key the RFC publishes the secret of, where every check below the enrolment "
        "layer closes",
        standing="settled",
    ),
    Gap(
        "G22",
        "3",
        'section 3 says "a tail id is <signing-key-fingerprint>-<installation-id>" descriptively, '
        "and the fingerprint being a key the record actually carries is a REQUIREMENT: without it "
        "a tail copied into a fabricated directory, relabelled and re-chained without any key, is "
        "counted twice and passes",
        "experiment",
        "implemented: a tail whose fingerprint prefix is not in the keyring is refused",
        standing="settled",
    ),
    Gap(
        "G23",
        "8",
        'section 8 says "the instant" as though a checkpoint had ONE attestation, and the normal '
        "case is several - it names which CHECKPOINT to take and not which ATTESTATION inside it, "
        "so two faithful readers date the same record differently",
        "unresolved",
        "this reader takes the EARLIEST block: an earlier attestation is the stronger existence "
        "claim, and the alternative rule is proof traversal order, which a semantically identical "
        ".ots can reorder. So the instant a verdict prints is THIS reader's rule and not the "
        "document's, and the product reads a different one off the same bytes. The divergence "
        "is pinned by a test rather than hidden, and is not this reader's to settle",
        standing="reader-limit",
        not_checked="which attestation inside a checkpoint dates the record, when it carries more than one",
    ),
    Gap(
        "G25",
        "7",
        "THE ONE THAT RAN THE OTHER WAY, and nobody was looking for it because refusing too "
        "much looks like rigour. Section 7 stated that \"the seven top-level keys of an event "
        "are at, kind, payload, signerFp, subject, v and who\", which is the INTERSECTION of "
        "the published vectors and not the envelope: `which` rides on sixteen of the "
        "twenty-three and `run` on three. A reader that believed the sentence - this one did - "
        "REFUSES an honest event carrying `which`, on a record the product reads as fine",
        "specified",
        "CLOSED by the same artifact as G08 and G14: an optional envelope field is spelled "
        "`string?` in event-schema.json, so nothing has to be inferred from an exemplar. Found "
        "by building an HONEST input, which is the only way this class shows up - an acceptance "
        "is found by building an attack, and an over-refusal is not",
        standing="settled",
    ),
    Gap(
        "G24",
        "8",
        "of section 8's three questions, the merkle-root one is unreachable by mutating a header: "
        "any change to the 80 bytes breaks the proof of work first, so the work gate answers "
        "every such case and the merkle branch never runs",
        "experiment",
        "reached instead by mutating the PATH inside the .ots and leaving the header real - which "
        "is what the witness-path-bit mutation is for",
        standing="settled",
    ),
)

BY_ID = {g.id: g for g in GAPS}


class Boundary(NamedTuple):
    """A limit the DOCUMENT draws on itself, which is not a gap and never gets an id.

    A gap is a place FORMAT.md did not suffice. This is the other thing: a place where it
    sufficed and said NO. Section 8 states that the header is checked for its work and not
    for its place in the chain, so nothing here was inferred and nothing is open - but a
    reader of a VERIFIED verdict still needs to be told, for exactly the reason the gaps
    are told: coverage they assume and did not get.

    It is a separate tuple rather than a twenty-sixth Gap because giving it an id would
    make the registry's own count a lie: `25 gaps` is a claim about where the document was
    not enough, and this is not one of those places.
    """

    section: str
    not_checked: str
    why: str


DOCUMENT_BOUNDARIES: tuple[Boundary, ...] = (
    Boundary(
        "8",
        "the stored header's place in the Bitcoin chain",
        "section 8 says this itself: the header is checked for its work, not for its place. "
        "A reader who needs that follows the block id into an explorer, or runs the ots "
        "client against a node",
    ),
)


class Scope(NamedTuple):
    """One line of what this reader does not check, and the reason beneath it."""

    section: str
    what: str
    why: str
    gap: str


def audit(catalogue: tuple[Gap, ...] = GAPS) -> None:
    """Refuse a catalogue that has not answered the question, at import.

    TOTALITY, SAID THE ONLY WAY THIS TREE CAN SAY IT. `Standing` is a `Literal` and no type
    checker runs over this directory, so the annotation checks nothing on its own; what does
    check is that `standing` is a NamedTuple field with NO DEFAULT, which makes a gap written
    without one a TypeError at import, plus the four rules below - an id used twice, a standing
    that is not one of the three, an open gap that is not a hole or a hole that is not open, and
    a limit with no words for a verdict to print - which fire the same way. A new `unresolved`
    gap therefore cannot exist without saying which kind of hole it is.

    The trunk's suite calls this over five deliberately broken catalogues, built in memory
    and never on disk, which is what keeps it from being decoration. That suite is not named
    here: nothing in this directory may name a module of the product, and a file name is a
    name.
    """
    seen: set[str] = set()
    for g in catalogue:
        if g.id in seen:
            raise ValueError(f"{g.id} is in the registry twice")
        seen.add(g.id)
        if g.standing not in ("reader-limit", "record-finding", "settled"):
            raise ValueError(f"{g.id} has standing {g.standing!r}, which is not one of the three")
        unresolved = g.how == "unresolved"
        hole = g.standing in ("reader-limit", "record-finding")
        if unresolved and not hole:
            raise ValueError(
                f"{g.id} is unresolved and stands as {g.standing!r}: an open gap is either a "
                "limit of this reader or a finding about a record, and which one decides "
                "whether every verdict has to say it"
            )
        if hole and not unresolved:
            raise ValueError(
                f"{g.id} stands as {g.standing!r} and is {g.how!r}: a reading that rests on "
                "an experiment, an external specification or the document is not a hole"
            )
        if (g.standing == "reader-limit") != bool(g.not_checked):
            raise ValueError(
                f"{g.id} stands as {g.standing!r} and its not_checked is {g.not_checked!r}: a "
                "limit of this reader is printed on every verdict and needs the words it is "
                "printed in; nothing else may carry them"
            )


audit()


def gap(gid: str) -> Gap:
    """Cite a gap. Raises if the id is not in the registry, so a citation cannot rot."""
    return BY_ID[gid]


def scope() -> tuple[Scope, ...]:
    """What this reader does not check - THE one derivation, and the only list of it.

    Three places used to say this and none was derived from another: this registry, a run
    of four hand-written declarations in the walker, and a section of the README. They
    disagreed - the README never named G06, and G23 was said in no verdict at all - which is
    the failure mode a gap that looks like coverage has when the gap is in the gap list.

    So the walker calls this and writes nothing of its own, and the README is held against
    it by a test in both directions. Adding an entry means classifying a gap here; there is
    nowhere else to add one.
    """
    return tuple(
        [Scope(g.section, g.not_checked, g.note, g.id) for g in GAPS if g.standing == "reader-limit"]
        + [Scope(b.section, b.not_checked, b.why, "") for b in DOCUMENT_BOUNDARIES]
    )


def as_dict() -> dict[str, object]:
    """The registry as data, for a caller that compares it rather than reads it."""
    return {
        "gaps": [
            {
                "id": g.id,
                "section": g.section,
                "what": g.what,
                "how": g.how,
                "note": g.note,
                "standing": g.standing,
                "notChecked": g.not_checked,
            }
            for g in GAPS
        ],
        "counts": {
            how: sum(1 for g in GAPS if g.how == how)
            for how in ("experiment", "external-spec", "specified", "unresolved")
        },
        "standings": {
            standing: sum(1 for g in GAPS if g.standing == standing)
            for standing in ("reader-limit", "record-finding", "settled")
        },
        "documentBoundaries": [
            {"section": b.section, "notChecked": b.not_checked, "why": b.why}
            for b in DOCUMENT_BOUNDARIES
        ],
        "scope": [
            {"section": s.section, "what": s.what, "why": s.why, "gap": s.gap} for s in scope()
        ],
    }


def render() -> str:
    lines = [
        "The points where FORMAT.md did not suffice.",
        "",
        f"{len(GAPS)} gaps: "
        + ", ".join(
            f"{how} {sum(1 for g in GAPS if g.how == how)}"
            for how in ("experiment", "external-spec", "specified", "unresolved")
        ),
        "",
        "An unresolved gap is one of two things, and the difference is whether this reader "
        "can see the",
        "condition on a record at all. A LIMIT OF THIS READER cannot be seen on any record, "
        "so silence",
        "about it says nothing and every verdict that reads a record prints it. A FINDING "
        "ABOUT A RECORD",
        "is reported by name where a record has it, so the absence of that report is itself "
        "an answer.",
        "",
    ]
    for g in GAPS:
        head = f"{g.id} [section {g.section}] ({g.how})" if g.section != "-" else f"{g.id} [not in the document] ({g.how})"
        if g.standing == "reader-limit":
            head += "  LIMIT OF THIS READER"
        elif g.standing == "record-finding":
            head += "  FINDING ABOUT A RECORD"
        lines.append(head)
        lines.append(f"    {g.what}")
        lines.append(f"    -> {g.note}")
        lines.append("")
    lines.append("NOT COVERED by this reader, which is what every verdict over a record prints:")
    lines.append("")
    for s in scope():
        tag = f"S{s.section}" if s.section not in ("", "-") else "--"
        suffix = f"  [{s.gap}]" if s.gap else "  [the document says so itself]"
        lines.append(f"  {tag:>4}  {s.what}{suffix}")
        lines.append(f"        why: {s.why}")
    lines.append("")
    return "\n".join(lines)
