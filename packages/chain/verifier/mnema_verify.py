#!/usr/bin/env python3
"""A second reader of the mnema chain format. Standard library only.

    python3 mnema_verify.py record <a record directory>
    python3 mnema_verify.py vectors [canonical-vectors.json]
    python3 mnema_verify.py self-test
    python3 mnema_verify.py all [--record DIR ...]
    python3 mnema_verify.py gaps

    --json    the verdict as one JSON object on stdout, for a caller that compares it.
              On `gaps` it is the registry instead, with what this reader does not check
              derived from it - the same list `record` prints, from the same function.

Exit codes are the verdict, and there are four of them because there are four things a
verifier can honestly say:

    0  VERIFIED     every check that was planned ran, and none refused
    1  REFUSED      a check ran and refused; the report names which
    2  INCOMPLETE   nothing refused, but a check that was planned could not run
    3  BROKEN       nothing was checked at all, or this program failed

There is no unconditional summary line anywhere in this program. The prototype it grew out
of printed "T2/T4 ok" after having already recorded a failure, which is the reason the
verdict is computed from the findings rather than written beside them.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from mnemaverify import gaps, record, selftest, vectors  # noqa: E402
from mnemaverify.verdict import Report  # noqa: E402

DEFAULT_VECTORS = os.path.normpath(os.path.join(HERE, "..", "canonical-vectors.json"))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mnema_verify.py",
        description="Verify a mnema record from FORMAT.md, with nothing of the product imported.",
    )
    parser.add_argument("--json", action="store_true", help="print the verdict as JSON")
    subs = parser.add_subparsers(dest="command", required=True)

    one = subs.add_parser("record", help="verify one record directory")
    one.add_argument("path")

    vecs = subs.add_parser("vectors", help="reproduce the published canonical vectors")
    vecs.add_argument("path", nargs="?", default=DEFAULT_VECTORS)

    subs.add_parser("self-test", help="check this verifier against RFC 8032 and section 1")
    subs.add_parser(
        "canonicalize",
        help="read one JSON document per line on stdin, write each one's canonical bytes as hex",
    )
    subs.add_parser("gaps", help="print where FORMAT.md did not suffice")

    every = subs.add_parser("all", help="self-test, then the vectors, then every record given")
    every.add_argument("--record", action="append", default=[], dest="records")
    every.add_argument("--vectors", default=DEFAULT_VECTORS)
    return parser


def _canonicalize() -> int:
    """A pipe for cross-checking section 1 against another implementation.

    ONE JSON DOCUMENT PER LINE IN, one result per line's worth out, as a JSON array. The
    canonical bytes come back as HEX, because half of any corpus worth comparing is control
    bytes and lone surrogates, and a comparison whose transport mangles the input compares
    nothing. A document section 1 refuses comes back as `refused` with the reason: "it
    refused" and "it produced nothing" are not the same answer.

    THE READING IS THE STRICT ONE, and it was not at first. This read stdin with
    `json.load`, the stdlib parser, so `{"a":1,"a":2}` came back through it as `{"a":2}` -
    ACCEPTED, with the duplicate silently dropped, while the same bytes handed to the
    record walker were refused. A pipe built to compare two readings of section 1, which
    did not itself apply section 1's parse-time refusals, was measuring the wrong thing.
    A test found that; reading the code had not.

    ONE PER LINE, and not one JSON array, for the same reason. Refusing at parse time
    refuses the whole document, so an array could only ever be refused as a unit - and a
    duplicate key cannot survive being re-serialized out of a loosely parsed array at all.
    A line each is what lets a refused value be reported BESIDE the ones that were not.
    """
    from mnemaverify.canonical import canonical_bytes, strict_loads
    from mnemaverify.verdict import Refusal

    out = []
    for line in sys.stdin.read().split("\n"):
        if not line.strip():
            continue
        try:
            out.append({"canonical": canonical_bytes(strict_loads(line)).hex()})
        except Refusal as refusal:
            out.append({"refused": refusal.what, "section": refusal.section})
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.command == "gaps":
        # `--json` IS HONOURED HERE, and for a while it was not: the flag is global, this
        # branch returned before anything looked at it, and `--json gaps` printed prose to a
        # caller that had asked for an object. A flag that arrives and feeds nothing is the
        # same defect in miniature as a list nobody derives.
        if args.json:
            payload = gaps.as_dict()
            payload["command"] = args.command
            json.dump(payload, sys.stdout, indent=2, sort_keys=True)
            sys.stdout.write("\n")
        else:
            sys.stdout.write(gaps.render())
        return 0

    if args.command == "canonicalize":
        return _canonicalize()

    report = Report()
    heading: list[str] = []

    if args.command == "self-test":
        heading.append("SELF-TEST - this verifier, against data somebody else published")
        selftest.run(report)
    elif args.command == "vectors":
        heading.append(f"VECTORS - {args.path}")
        vectors.verify_vectors(args.path, report)
    elif args.command == "record":
        heading.append(f"RECORD - {args.path}")
        record.verify_record(args.path, report)
    elif args.command == "all":
        heading.append("SELF-TEST, VECTORS, then every record given")
        selftest.run(report)
        vectors.verify_vectors(args.vectors, report)
        if not args.records:
            report.unchecked("-", "no record was given, so no record was read")
        for path in args.records:
            report.note("-", f"reading the record at {path}")
            record.verify_record(path, report)

    if args.json:
        payload = report.as_dict()
        payload["command"] = args.command
        json.dump(payload, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    else:
        sys.stdout.write("\n".join(heading) + "\n\n" + report.render() + "\n")
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
