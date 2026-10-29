"""Section 6.10 - the record a tail belongs to.

    record = SHA-256( frame("mnema.record.v1") || frame(UTF-8 of the genesis tail id) )

The genesis tail is the tail whose first entry (seq 0) carries the smallest `at`, compared as
text, a tie going to the smaller tail id compared as text by UTF-16 code unit. The name is
carried only by what is signed: a tail proof and a checkpoint under their second schemes. A
reader does not recompute it as an authority; it asks whether the named tails of a directory
agree, and names the genesis tail as information when one of them hashes to the name.
"""

from __future__ import annotations

from typing import Iterable, Optional

from .canonical import utf16_order
from .framed import digest

RECORD_DOMAIN = "mnema.record.v1"


def record_name(genesis: str) -> str:
    return digest(RECORD_DOMAIN, genesis)


def genesis_tail(firsts: Iterable[tuple[str, str]]) -> Optional[str]:
    """`firsts` is (tail id, `at` of its seq 0); None when no tail holds a first entry."""
    best: Optional[tuple[str, str]] = None
    for tail, at in firsts:
        if best is None or (utf16_order(at), utf16_order(tail)) < (
            utf16_order(best[1]),
            utf16_order(best[0]),
        ):
            best = (tail, at)
    return None if best is None else best[0]


def record_of(named: dict[str, Optional[str]]) -> dict[str, object]:
    """What the named tails say: {"state": "unnamed"}, one name, or several groups by name.

    The same three answers, with the same keys, as `recordOf` in the product's record-name.ts.
    """
    groups: dict[str, list[str]] = {}
    unnamed: list[str] = []
    for tail, name in named.items():
        if name is None:
            unnamed.append(tail)
        else:
            groups.setdefault(name, []).append(tail)
    if not groups:
        return {"state": "unnamed"}
    if len(groups) > 1:
        return {
            "state": "several",
            "groups": [{"name": name, "tails": groups[name]} for name in sorted(groups)],
        }
    (name,) = groups
    found: dict[str, object] = {"state": "named", "name": name, "unnamed": unnamed}
    genesis = next((tail for tail in named if record_name(tail) == name), None)
    if genesis is not None:
        found["genesis"] = genesis
    return found
