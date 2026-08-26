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

Resolution = Literal["experiment", "external-spec", "unresolved"]


class Gap(NamedTuple):
    id: str
    section: str
    what: str
    how: Resolution
    note: str


GAPS: tuple[Gap, ...] = (
    Gap(
        "G01",
        "4",
        "the record's layout and the segment naming convention are not written, and "
        '"a tail is a JSONL file" contradicts it: a tail is a DIRECTORY of segments, '
        "with checkpoints.jsonl and tailproof.json beside them",
        "experiment",
        "segments are taken to be ^[0-9]{6}\\.jsonl$, ordered by name, concatenated",
    ),
    Gap(
        "G02",
        "5",
        "frame(acc) does not say whether the accumulator travels as hex or as the raw "
        "32 bytes; both readings are grammatical",
        "experiment",
        "both are computed and the published digests pick: RAW bytes",
    ),
    Gap(
        "G03",
        "6",
        "the fingerprint derivation is not written, so a stranger loads the key by its "
        'FILENAME and section 6\'s "cannot be re-pointed at another key" is assumed, '
        "not checked",
        "experiment",
        "fp = sha256(DER SubjectPublicKeyInfo); three other derivations were tried and fail",
    ),
    Gap(
        "G04",
        "1",
        "number serialization is unspecified beyond -0; Python, Go and JavaScript "
        "disagree on 1.0, 1e-7 and 1e20",
        "external-spec",
        "ECMA-262 Number::toString, inferred from the JSON.stringify anchor in 1.4",
    ),
    Gap(
        "G05",
        "1.4",
        "escaping is anchored to a JavaScript implementation rather than stated as a "
        "rule, and Go's encoding/json escapes < > & by default",
        "external-spec",
        "RFC 8259 + ECMA-262, and cross-checked against Node's own JSON.stringify in the suite",
    ),
    Gap(
        "G06",
        "1",
        "an explicit undefined property cannot occur in a JSONL line, so the refusal is "
        "unreachable for any reader that only reads files",
        "unresolved",
        "exercised through an in-memory sentinel; reported as unreachable from disk",
    ),
    Gap(
        "G07",
        "1",
        'the refusal of "two keys that normalize to the same string" also has to cover '
        "LITERAL duplicates, which every library JSON parser silently keeps the last of",
        "experiment",
        "a strict reader refuses both; the document should say the refusal reaches both",
    ),
    Gap(
        "G08",
        "4",
        "the per-kind field declarations are published nowhere, so the forged-extra-field "
        "refusal cannot be implemented from the document",
        "unresolved",
        "envelope shape only, intersected from the 23 published vectors; refusal not covered",
    ),
    Gap(
        "G09",
        "3",
        'the word "waiver" appears once in the whole document, inside a test path: what a '
        "waiver is, where it lives and what it signs is not specified, so an authorized cut "
        "is indistinguishable from tampering",
        "unresolved",
        "a sequence gap is reported and located; authorization is declared unrecognizable",
    ),
    Gap(
        "G10",
        "-",
        "tailproof.json is a signed per-tail artifact with scheme mnema-tail/1 and is not "
        "mentioned anywhere in the document",
        "experiment",
        "five candidate messages tried; canonical bytes of {scheme,signerFp,tail} verifies",
    ),
    Gap(
        "G11",
        "6",
        "whether consecutive checkpoint ranges must be contiguous is not decided",
        "unresolved",
        "a discontinuity is reported by name and is not turned into a refusal",
    ),
    Gap(
        "G12",
        "6",
        "the checkpoint's prev is not said to be lower-case hex, though section 5 says it "
        "for the root",
        "experiment",
        "lower-case hex, from the published data",
    ),
    Gap(
        "G13",
        "6",
        "the checkpoints file's name, that it is JSONL, that its line order is the chain "
        "order, and that the stored line is itself canonical, are all unwritten",
        "experiment",
        "byte-identity is required of the checkpoint line too, inferred from section 4",
    ),
    Gap(
        "G14",
        "7",
        "the event envelope is specified nowhere: section 7 names kind and v, and the other "
        "five top-level keys exist only in the published vectors",
        "experiment",
        "envelope keys intersected from the 23 vectors",
    ),
    Gap(
        "G15",
        "4",
        "the mapping from sequence number to segment file is not written: which segment holds "
        "seq N, whether a segment may be empty, what starts a new one",
        "experiment",
        "concatenate by name order; contiguity is checked over the concatenation",
    ),
    Gap(
        "G16",
        "8",
        "the .blocks sidecar may carry headers the proof does not use, and the pairing is by "
        "the height the attestation declares; neither is written",
        "experiment",
        "paired by height; unused headers are counted and reported",
    ),
    Gap(
        "G17",
        "8",
        "the compact nBits expansion and the little-endian comparison of the double-SHA256 are "
        'not named, though "bytes 36-68, internal order" is named for the merkle root',
        "external-spec",
        "Bitcoin header serialization; 0x1800ffff checks out as 0xffff * 2**168",
    ),
    Gap(
        "G18",
        "7",
        "no published vector carries v > 1 and no upcaster is published, so section 7's claim is "
        "checkable only from inside - which is the self-compatibility a second implementation "
        "exists in order not to be",
        "unresolved",
        "declared not covered",
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
    ),
    Gap(
        "G21",
        "6",
        "enrolment is not in the document at all: the product requires the signer to be a key "
        "VALID FOR ITS ANCHOR at that point in the chain, and section 6 asks only that the "
        "signature verify under signerFp. key.enrolled and key.revoked are published kinds with "
        "no published semantics",
        "unresolved",
        "declared not covered - this is the one place this reader accepts what the product "
        "refuses, and it is said out loud rather than left to be found",
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
        ".ots can reorder. The divergence is pinned by a test rather than hidden",
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
    ),
)

BY_ID = {g.id: g for g in GAPS}


def gap(gid: str) -> Gap:
    """Cite a gap. Raises if the id is not in the registry, so a citation cannot rot."""
    return BY_ID[gid]


def render() -> str:
    lines = [
        "The points where FORMAT.md did not suffice.",
        "",
        f"{len(GAPS)} gaps: "
        + ", ".join(
            f"{how} {sum(1 for g in GAPS if g.how == how)}"
            for how in ("experiment", "external-spec", "unresolved")
        ),
        "",
    ]
    for g in GAPS:
        head = f"{g.id} [section {g.section}] ({g.how})" if g.section != "-" else f"{g.id} [not in the document] ({g.how})"
        lines.append(head)
        lines.append(f"    {g.what}")
        lines.append(f"    -> {g.note}")
        lines.append("")
    return "\n".join(lines)
