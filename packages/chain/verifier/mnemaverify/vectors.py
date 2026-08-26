"""The published vectors, checked by the rules of the document.

`canonical-vectors.json` is the machine-readable half of FORMAT.md, and the document says
what to do with it: "canonicalize each `event` by the rules in section 1, SHA-256 the
bytes, and compare with the row's `sha256`." It is the sharpest test of sections 1 and 2
there is, because it is one digest per kind of event the catalog can hold, published and
waiting, with no code of ours needed to read it.

The four aggregates are checked too: the fold over an empty range, the entry hash of a
genesis entry and of a linked one, and the content root over every vector in file order.
Those are what pin sections 3 and 5.

AND THE TWO PUBLISHED ARTIFACTS ARE CHECKED AGAINST EACH OTHER. `event-schema.json` says
what every kind declares; these vectors are one real event of each. Every vector is rebuilt
from its own published contract and has to come back byte-identical - so a declaration that
drifted from the events this product actually writes reddens here, on published data, with
no record needed.

THAT PAIRING REPLACED A DERIVATION THAT WAS WRONG (gap G25). The envelope used to be
re-derived here as the INTERSECTION of the vectors' top-level keys, because the document
said the envelope was seven keys and published nothing else. It is eight names, two of them
optional: `which` rides on sixteen of these twenty-three vectors and `run` on three, so an
intersection is not the envelope - and a reader built on it refused an honest event for
carrying `which`. An intersection can never tell a required field from an optional one, and
that is the whole reason the declarations are published now.
"""

from __future__ import annotations

import hashlib
import json

from . import schema as declarations
from .canonical import canonical_bytes, strict_loads
from .entry import entry_hash
from .root import content_root, empty_root, which_reading_closes
from .verdict import Refusal, Report


def verify_vectors(path: str, report: Report) -> None:
    try:
        with open(path, "rb") as handle:
            document = strict_loads(handle.read().decode("utf-8"))
    except (OSError, Refusal) as exc:
        report.break_out(f"could not read the vectors at {path}: {exc}")
        return
    if not isinstance(document, dict) or "vectors" not in document:
        report.break_out(f"{path} does not look like the published vectors")
        return

    rows = document["vectors"]
    matched = 0
    for row in rows:
        name = row.get("name", "<unnamed>")
        try:
            recomputed = hashlib.sha256(canonical_bytes(row["event"])).hexdigest()
        except Refusal as refusal:
            report.fail(refusal.section, f"vector {name}: {refusal.what}", path)
            continue
        if recomputed == row["sha256"]:
            matched += 1
        else:
            report.fail(
                "1",
                f"vector {name}: the canonical bytes hash to {recomputed[:16]}... and the file "
                f"declares {row['sha256'][:16]}...",
                path,
            )
    if matched:
        report.ok(
            "1",
            f"{matched} of {len(rows)} published vectors reproduce their SHA-256 from the rules "
            "of section 1 alone",
            path,
        )

    chain = document.get("chain")
    if not isinstance(chain, dict):
        report.unchecked("5", "the vectors carry no aggregate digests", path)
        return

    if empty_root() == chain["emptyRoot"]:
        report.ok("5", "the fold over an empty range reproduces", path)
    else:
        report.fail("5", f"the empty root is {empty_root()[:16]}..., not what the file declares", path)

    by_name = {row["name"]: row for row in rows}
    for key, literal in (("entryHashGenesis", "genesis"), ("entryHashLinked", "linked")):
        spec = chain.get(key)
        if not isinstance(spec, dict):
            report.unchecked("3", f"the vectors carry no {key}", path)
            continue
        event = by_name.get(spec["vector"])
        if event is None:
            report.fail("3", f"{key} names a vector the file does not hold: {spec['vector']}", path)
            continue
        recomputed = entry_hash(
            canonical_bytes(event["event"]), chain["tail"], spec["seq"], spec["prev"]
        )
        if recomputed == spec["entryHash"]:
            report.ok("3", f"the entry hash of a {literal} entry reproduces", path)
        else:
            report.fail(
                "3",
                f"the {literal} entry hash is {recomputed[:16]}..., and the file declares "
                f"{spec['entryHash'][:16]}...",
                path,
            )

    declared = chain.get("contentRootOverAllVectors")
    if isinstance(declared, str):
        span = [canonical_bytes(row["event"]) for row in rows]
        reading = which_reading_closes(span, declared)
        if reading is None:
            report.fail(
                "5",
                "the content root over every vector in file order does not reproduce under "
                "either reading of the accumulator",
                path,
                "G02",
            )
        else:
            report.ok(
                "5",
                f"the content root over all {len(rows)} vectors reproduces, with the "
                f"accumulator carried as {reading}",
                path,
                "G02",
            )
            if content_root(span, "hex") == declared and reading == "raw":  # pragma: no cover
                report.fail("5", "both readings of the accumulator agree, which cannot happen", path)

    _check_against_the_declarations(rows, path, report)

    kinds = {row["kind"] for row in rows}
    report.note(
        "-",
        f"{len(kinds)} kinds over {len(rows)} vectors; the vectors are total over the catalog by "
        "type, which is a claim only the code can hold and this reader takes on trust",
        path,
    )
    report.note("-", f"vectorsVersion {document.get('vectorsVersion')}, describedBy "
                     f"{json.dumps(document.get('describedBy'))}", path)


def _check_against_the_declarations(rows: list, path: str, report: Report) -> None:
    """The exemplars against the schema: every vector rebuilt from its own contract.

    This is the one check in this program that reads BOTH published artifacts and requires
    them to agree, and it needs no record to run - which is what makes it the cheapest place
    for a drift between them to show up.
    """
    try:
        published = declarations.load()
    except Refusal as refusal:
        report.unchecked("4.1", refusal.what, declarations.DEFAULT_SCHEMA, "G08")
        return
    rebuilt = 0
    for row in rows:
        name = row.get("name", "<unnamed>")
        try:
            result = declarations.rebuild(published, row["event"])
        except Refusal as refusal:
            report.fail("4.1", f"vector {name}: {refusal.what}", path, "G08")
            continue
        if canonical_bytes(result.event) != canonical_bytes(row["event"]):
            report.fail(
                "4.1",
                f"vector {name} rebuilt from contract {result.contract.kind}@{result.contract.v} "
                "does not re-serialize to the published event",
                path,
                "G08",
            )
            continue
        rebuilt += 1
    if rebuilt:
        report.ok(
            "4.1",
            f"{rebuilt} of {len(rows)} published vectors rebuild byte-identically from the "
            "contract the published declarations give their kind, so the two artifacts agree",
            path,
            "G08",
        )
    kinds_declared = {kind for kind, _ in published.contracts}
    missing = sorted({row["kind"] for row in rows} - kinds_declared)
    if missing:
        report.fail(
            "4.1", f"the vectors carry kind(s) the declarations do not: {missing}", path, "G08"
        )
    unexercised = sorted(kinds_declared - {row["kind"] for row in rows})
    if unexercised:
        report.note(
            "4.1",
            "the declarations declare kind(s) no published vector exercises: "
            + ", ".join(unexercised),
            path,
            "G08",
        )
