"""The published vectors, checked by the rules of the document.

`canonical-vectors.json` is the machine-readable half of FORMAT.md, and the document says
what to do with it: "canonicalize each `event` by the rules in section 1, SHA-256 the
bytes, and compare with the row's `sha256`." It is the sharpest test of sections 1 and 2
there is, because it is one digest per kind of event the catalog can hold, published and
waiting, with no code of ours needed to read it.

The four aggregates are checked too: the fold over an empty range, the entry hash of a
genesis entry and of a linked one, and the content root over every vector in file order.
Those are what pin sections 3 and 5.

And the seven envelope keys `entry` relies on are RE-DERIVED here from the intersection of
the 23 vectors, rather than trusted as a constant (gap G14 - the envelope is specified
nowhere in the document). A vector set whose intersection moves reddens this check instead
of quietly disagreeing with the constant.
"""

from __future__ import annotations

import hashlib
import json

from .canonical import canonical_bytes, strict_loads
from .entry import ENVELOPE_KEYS, entry_hash
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

    intersection = frozenset.intersection(*(frozenset(row["event"]) for row in rows))
    if intersection == ENVELOPE_KEYS:
        report.ok(
            "7",
            f"the envelope is the same {len(intersection)} keys across all {len(rows)} vectors",
            path,
            "G14",
        )
    else:
        report.fail(
            "7",
            f"the envelope keys derived from the vectors are {sorted(intersection)}, and this "
            f"verifier was built expecting {sorted(ENVELOPE_KEYS)}",
            path,
            "G14",
        )

    kinds = {row["kind"] for row in rows}
    report.note(
        "-",
        f"{len(kinds)} kinds over {len(rows)} vectors; the vectors are total over the catalog by "
        "type, which is a claim only the code can hold and this reader takes on trust",
        path,
    )
    report.note("-", f"vectorsVersion {document.get('vectorsVersion')}, describedBy "
                     f"{json.dumps(document.get('describedBy'))}", path)
