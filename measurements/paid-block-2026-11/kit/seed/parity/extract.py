#!/usr/bin/env python3
"""Copies, from the 0.1.4 comparison kits in the private archive, the two things the measured sessions of the free block reuse
(the maintainer's ruling of 29 October on ADR-119), and records where they came from and their hashes.

  rule      org-08, the parity rule: its entry of rules.yaml of the medium/pilot kit, field by field (title, why, alternatives,
            addresses), as the failure-modes kit recorded it for arm B. Copied, not edited.
  prompt    the governed prompt of the failure-modes kit's `inline` script, `inline.g.md` (the SCOPED prompt of 27 October: "In the
            JS package, ..."), copied byte for byte.
  neutral   the NEUTRAL prompt. THE 0.1.4 KITS HOLD NO FILE FOR IT: the design of the comparison after 0.1.4 lists it as new
            ("o prompt neutro de paridade, inline.g.neutral.md") and defines it as the scoped prompt "sem nomear o pacote". It is
            therefore DERIVED here by the one edit that definition names: the scope clause "In the JS package, " is dropped and the
            next letter capitalised. Nothing else changes. The provenance says so, so that the maintainer can confirm it.

    python3 seed/parity/extract.py            # rewrites org-08.json, prompts/*, provenance.json
    python3 seed/parity/extract.py --check    # exits 1 if what is committed differs from what the archive gives now
"""
import hashlib
import json
import os
import re
import subprocess
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(KIT, "..", ".."))  # the root of the private backup repository
ARCHIVE = "mnema/archive/round-0.1.4-2026-10-29/claude-md-comparison-0.1.4"
RULES = f"{ARCHIVE}/rules.yaml"
SCOPED = f"{ARCHIVE}/failure-modes/prompts/inline.g.md"
DESIGN = f"{ARCHIVE}/failure-modes/design.yaml"
SCOPE_CLAUSE = "In the JS package, "
RULE_ID = "org-08"
FIELDS = ("id", "source", "state", "title", "why", "alternatives", "addresses")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def blob(path: str) -> str:
    return subprocess.run(["git", "rev-parse", f"HEAD:{path}"], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()


def build() -> dict:
    rules_raw = open(os.path.join(REPO, RULES), "rb").read()
    scoped_raw = open(os.path.join(REPO, SCOPED), "rb").read()
    entry = next(r for r in yaml.safe_load(rules_raw)["rules"] if r["id"] == RULE_ID)
    rule = {k: entry[k] for k in FIELDS}
    scoped = scoped_raw.decode("utf-8")
    assert scoped.startswith(SCOPE_CLAUSE), "the scoped prompt no longer starts with the scope clause"
    rest = scoped[len(SCOPE_CLAUSE):]
    neutral = rest[0].upper() + rest[1:]
    return {
        "rule": rule,
        "scoped": scoped_raw,
        "neutral": neutral.encode("utf-8"),
        "provenance": {
            "comment": "Where the rule and the prompts of the measured sessions of the free block come from. Paths are relative to the root of the private backup repository; the git blob ids are of its HEAD when this was extracted.",
            "rule": {
                "id": RULE_ID,
                "copied_from": RULES,
                "source_file_sha256": sha(rules_raw),
                "source_file_git_blob": blob(RULES),
                "copied_as": "org-08.json (title, why, alternatives, addresses, field by field; unedited)",
                "recorded_by": "the failure-modes kit (arm B) with: decision record <title> --body-file <why> --alternatives <alternatives>; link <ADR> <path> --rel governs; decision move accept (gen.py of the pilot kit)",
                "rule_json_sha256": sha((json.dumps(rule, indent=2, ensure_ascii=False) + "\n").encode("utf-8")),
            },
            "scoped_prompt": {
                "copied_from": SCOPED,
                "source_file_sha256": sha(scoped_raw),
                "source_file_git_blob": blob(SCOPED),
                "copied_as": "prompts/inline.g.md (byte for byte)",
            },
            "neutral_prompt": {
                "status": "DERIVED, not copied: no file of the 0.1.4 kits holds a neutral prompt",
                "defined_by": "mnema/archive/active/comparison-after-0.1.4/design.md section 1 (Q4: 'o NEUTRO (sem nomear o pacote)') and section 5 (Novo, 2: 'o prompt neutro de paridade (inline.g.neutral.md)')",
                "derived_from": SCOPED,
                "derivation": f"drop the leading clause {SCOPE_CLAUSE!r} and capitalise the next letter; nothing else",
                "derived_as": "prompts/parity-neutral.md",
                "sha256": sha(neutral.encode("utf-8")),
            },
            "failure_modes_design": {"file": DESIGN, "source_file_sha256": sha(open(os.path.join(REPO, DESIGN), "rb").read()), "used_for": "rule_facts.org-08 (governed paths, the governed edit, the companion path, what the companion must add)"},
        },
    }


def main() -> int:
    b = build()
    outputs = {
        "org-08.json": (json.dumps(b["rule"], indent=2, ensure_ascii=False) + "\n").encode("utf-8"),
        "prompts/inline.g.md": b["scoped"],
        "prompts/parity-neutral.md": b["neutral"],
        "provenance.json": (json.dumps(b["provenance"], indent=2, ensure_ascii=False) + "\n").encode("utf-8"),
    }
    if "--check" in sys.argv:
        bad = [n for n, data in outputs.items() if not os.path.exists(os.path.join(HERE, n)) or open(os.path.join(HERE, n), "rb").read() != data]
        print("differs: " + ", ".join(bad) if bad else "same as the archive gives now")
        return 1 if bad else 0
    for n, data in outputs.items():
        with open(os.path.join(HERE, n), "wb") as handle:
            handle.write(data)
    print("written: " + ", ".join(outputs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
