"""Section 6.10 - the record a tail belongs to.

    record = SHA-256( frame("mnema.record.v1") || frame(UTF-8 of the genesis tail id) )

The genesis tail is the tail whose first entry (seq 0) carries the smallest `at`, compared as
text, a tie going to the smaller tail id compared as text by UTF-16 code unit. The name is
carried only by what is signed: a tail proof and a checkpoint under their second schemes. A
reader does not recompute it as an authority; it asks whether the named tails of a directory
agree, and names the genesis tail as information when one of them hashes to the name.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable, NamedTuple, Optional

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

    Three answers, by the keys `state`, `name`, `genesis`, `unnamed` and `groups`.
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


# Section 6.11: the tokens both readers refuse a relink by, and the three things they say of one.
RELINK_NOT_THE_OWNER = "relink-not-the-owner"
RELINK_CONFLICT = "relink-conflict"
RELINK_HOSTED_BY_A_RELINKED_TAIL = "relink-hosted-by-a-relinked-tail"
RELINK_INTO_MISMATCH = "relink-into-mismatch"
RELINK_FROM_MISMATCH = "relink-from-mismatch"
RELINKED_TAIL_GREW = "relinked-tail-grew"
RELINK_HEAD_MISMATCH = "relink-head-mismatch"
RELINK_NOT_A_MEMBER = "relink-not-a-member"


class Relink(NamedTuple):
    """A `tail.relinked` as this reader found it: where it sits, who signed it, what it says."""

    host: str
    seq: int
    signer: str
    tail: str
    source: str
    into: str
    through_hash: str
    event_count: int


class Relinks(NamedTuple):
    """What `relinked_naming` read: the names once the relinks that count are applied, the
    relinks that count with their census line, the refused with their sentence, the uncovered,
    and the covered relinks of a tail that is not in the directory."""

    named: dict[str, Optional[str]]
    counted: list[tuple[Relink, str]]
    refused: list[tuple[str, Relink, str]]
    uncovered: list[Relink]
    absent: list[Relink]


def _fingerprint(tail: str) -> str:
    dash = tail.rfind("-")
    return tail if dash == -1 else tail[:dash]


def _where(relink: Relink) -> str:
    return f"tail {relink.host} seq {relink.seq}"


def _record_said(name: Optional[str]) -> str:
    return "no record" if name is None else f"record {name[:12]}..."


def relinked_naming(
    named: dict[str, Optional[str]],
    entries_by_tail: dict[str, list[Any]],
    covered_through: dict[str, int],
    fold: Callable[[dict[str, list[Any]], dict[str, int]], Iterable[tuple[str, int]]],
) -> Relinks:
    """Section 6.11: the name a relink gives a tail, check by check in the section's order.

    `entries_by_tail` holds each tail's entries (`.event`, `.seq`, `.stored_hash`) and `fold`
    answers, over the tails it is handed, the (tail, seq) of every event section 6.2 refuses.
    """
    found: list[tuple[Relink, bool]] = []
    for host, entries in entries_by_tail.items():
        for entry in entries:
            event = entry.event
            if event.get("kind") != "tail.relinked":
                continue
            payload = event["payload"]
            relink = Relink(
                host, entry.seq, event["signerFp"], payload["tail"], payload["from"],
                payload["into"], payload["throughHash"], payload["eventCount"],
            )
            found.append((relink, entry.seq <= covered_through.get(host, -1)))
    if not found:
        return Relinks(named, [], [], [], [])

    uncovered = [relink for relink, covered in found if not covered]
    refused: list[tuple[str, Relink, str]] = []

    def refuse(token: str, relink: Relink, detail: str) -> None:
        refused.append((token, relink, f"{detail} ({token})"))

    by_tail: dict[str, list[Relink]] = {}
    for relink, covered in found:
        if not covered:
            continue
        owner = _fingerprint(relink.tail)
        if relink.signer != owner or _fingerprint(relink.host) != owner:
            refuse(
                RELINK_NOT_THE_OWNER, relink,
                f"{_where(relink)} relinks tail {relink.tail}, signed by {relink.signer[:12]}..., "
                "not the key that tail's id names",
            )
            continue
        by_tail.setdefault(relink.tail, []).append(relink)

    absent: list[Relink] = []
    admitted: list[Relink] = []
    for tail, relinks in by_tail.items():
        relink = relinks[0]
        if len(relinks) > 1:
            refuse(
                RELINK_CONFLICT, relink,
                f"tail {tail} is relinked {len(relinks)} times "
                f"({', '.join(_where(one) for one in relinks)}): a tail is relinked once",
            )
            continue
        if relink.host in by_tail:
            refuse(
                RELINK_HOSTED_BY_A_RELINKED_TAIL, relink,
                f"{_where(relink)} relinks tail {tail}, and is itself relinked: a relink counts "
                "only from a tail that names its record by its own artifacts",
            )
            continue
        host_names = named.get(relink.host)
        if host_names != relink.into:
            refuse(
                RELINK_INTO_MISMATCH, relink,
                f"{_where(relink)} relinks tail {tail} into record {relink.into[:12]}..., and "
                f"names {_record_said(host_names)} itself",
            )
            continue
        if tail not in named:
            absent.append(relink)
            continue
        tail_names = named.get(tail)
        if tail_names != relink.source:
            refuse(
                RELINK_FROM_MISMATCH, relink,
                f"{_where(relink)} relinks tail {tail} from record {relink.source[:12]}..., and "
                f"that tail names {_record_said(tail_names)}",
            )
            continue
        entries = entries_by_tail.get(tail, [])
        head = entries[-1].stored_hash if entries else None
        if head != relink.through_hash or len(entries) != relink.event_count:
            if (
                len(entries) > relink.event_count >= 1
                and entries[relink.event_count - 1].stored_hash == relink.through_hash
            ):
                refuse(
                    RELINKED_TAIL_GREW, relink,
                    f"tail {tail} holds {len(entries)} event(s), and the relink at "
                    f"{_where(relink)} froze it at {relink.event_count}",
                )
            else:
                refuse(
                    RELINK_HEAD_MISMATCH, relink,
                    f"tail {tail} ends at {(head or 'nothing')[:12]}... with {len(entries)} "
                    f"event(s), not at the head {relink.through_hash[:12]}... with "
                    f"{relink.event_count} the relink at {_where(relink)} names",
                )
            continue
        admitted.append(relink)

    refused_in: dict[str, set[tuple[str, int]]] = {}
    for into in dict.fromkeys(relink.into for relink in admitted):
        tails = [tail for tail, name in named.items() if name == into and tail not in by_tail]
        # ADR-157: only a membership the record gave counts, so no founding but the genesis tail's.
        given = {
            tail: (
                entries_by_tail.get(tail, [])
                if record_name(tail) == into
                else [
                    entry for entry in entries_by_tail.get(tail, [])
                    if entry.event.get("kind") != "identity.founded"
                ]
            )
            for tail in tails
        }
        refused_in[into] = set(
            fold(
                given,
                {tail: covered_through.get(tail, -1) for tail in tails},
            )
        )
    relinked = dict(named)
    counted: list[tuple[Relink, str]] = []
    for relink in admitted:
        if (relink.host, relink.seq) in refused_in.get(relink.into, set()):
            refuse(
                RELINK_NOT_A_MEMBER, relink,
                f"{_where(relink)} relinks tail {relink.tail}, and its key holds no membership "
                f"record {relink.into[:12]}... gave it at that point: the founding of its genesis "
                "identity, or an enrolment by a member that founding took in",
            )
            continue
        relinked[relink.tail] = relink.into
        entries = entries_by_tail.get(relink.tail, [])
        first_at = entries[0].event.get("at", "") if entries else ""
        counted.append((
            relink,
            f"tail {relink.tail}, record {relink.source[:12]}..., relinked into this record by its "
            f"own key at {_where(relink)}: {len(entries)} event(s), the first at {first_at}",
        ))
    return Relinks(relinked, counted, refused, uncovered, absent)
