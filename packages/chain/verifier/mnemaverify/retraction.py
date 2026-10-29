"""Section 6.4 - a note or a link taken back, or a note written again, by an identity that did not
write it.

Only the identity that wrote a note takes it back, and only one that asserted a link withdraws
it. The comparison is on the anchor - the event's `who` - and not on the key. A retraction whose
`who` may not take back what it names is not applied, and it is not a break: the event is intact
and its key speaks for its own `who`; what it lacks is authority over somebody else's note. So
this reader names it, as a note, and the verdict does not move.

    memory.captured, observation.recorded
                     a note is the identity that wrote it FIRST, in the merged order of
                     section 6.2; a writing of the same id by another identity is not
                     applied
    note.retracted   names a memory.captured or observation.recorded by its subject
                     not applied when its `who` is not that note's `who`
                     neither applied nor named when the record holds no such note
    link.retracted   names the knowledge.linked of (subject, target, rel), byte for byte
                     not applied when its `who` asserted that edge nowhere while another
                     identity did; neither applied nor named when nobody asserted it

The authors are read over every tail first, so a retraction is judged whatever tail, or order,
its note or its link sits in. Of two writings of one note, the FIRST in the merged order names its
author: the order the product's read takes it in, never the order of the tail ids, which begin
with a key's fingerprint and so are a signer's to choose.

Section 6.8 - a decision recorded again - is read over the same order and is stricter: a decision is
the text its first judgment was made on, the FIRST `decision.recorded` in the merged order among
those the writer of its first applied move after the birth had read (section 6.7's sight), or its
first writing in the merged order while no move has judged it or the move's writer read none. Every
other writing of its id is not applied, whoever signed it, the text's writer's own and a copy of
the same payload included, since the product mints a decision's id when it records it and never
writes one id twice.
"""

from __future__ import annotations

import json
from typing import NamedTuple

from .canonical import utf16_order
from .enrolment import Merged, merged_order
from .entry import Entry
from .workflow import sight

NOTE_KINDS = ("memory.captured", "observation.recorded")


class Foreign(NamedTuple):
    tail: str
    seq: int
    rule: str
    detail: str


def _shown(value: object) -> str:
    return json.dumps(value, ensure_ascii=True)


def foreign_retractions(entries_by_tail: dict[str, list[Entry]]) -> list[Foreign]:
    """Every retraction, and every writing of a note, that is not applied, in tail order and then
    `seq` order."""
    tails = sorted(entries_by_tail, key=utf16_order)
    authors: dict[str, object] = {}
    for _tail, entry in merged_order(entries_by_tail).order:
        if entry.event.get("kind") in NOTE_KINDS:
            authors.setdefault(str(entry.event.get("subject")), entry.event.get("who"))
    asserters: dict[str, list[object]] = {}
    for tail in tails:
        for entry in entries_by_tail[tail]:
            event = entry.event
            kind = event.get("kind")
            if kind == "knowledge.linked":
                linked = asserters.setdefault(_edge(event), [])
                if event.get("who") not in linked:
                    linked.append(event.get("who"))
    found: list[Foreign] = []
    for tail in tails:
        for entry in entries_by_tail[tail]:
            event = entry.event
            kind = event.get("kind")
            who = event.get("who")
            if kind in NOTE_KINDS:
                author = authors.get(str(event.get("subject")))
                if author is None or author == who:
                    continue
                found.append(
                    Foreign(
                        tail,
                        entry.seq,
                        "foreign-rewrite",
                        f"a {kind} of {_shown(event.get('subject'))} signed by {_shown(who)}, "
                        f"which did not write it first ({_shown(author)} did) - a note is the "
                        "identity that wrote it first, so this writing is not applied and the note "
                        "stands as its author wrote it",
                    )
                )
            elif kind == "note.retracted":
                author = authors.get(str(event.get("subject")))
                if author is None or author == who:
                    continue
                found.append(
                    Foreign(
                        tail,
                        entry.seq,
                        "foreign-retraction",
                        f"a retraction of {_shown(event.get('subject'))} signed by {_shown(who)}, "
                        f"which did not write it ({_shown(author)} did) - only the identity that "
                        "wrote a note takes it back, so it is not applied and the note still stands",
                    )
                )
            elif kind == "link.retracted":
                whos = asserters.get(_edge(event))
                if whos is None or who in whos:
                    continue
                found.append(
                    Foreign(
                        tail,
                        entry.seq,
                        "foreign-link-retraction",
                        f"a retraction of the link {_edge(event)} signed by "
                        f"{_shown(who)}, which did not record it "
                        f"({', '.join(_shown(w) for w in whos)} did) - only the identity that "
                        "recorded a link takes it back, so it is not applied and the link still "
                        "stands",
                    )
                )
    return found


def _edge(event: dict) -> str:
    """The edge a link names, as the JSON array of its three parts: no choice of target or rel
    can make two edges one."""
    payload = event.get("payload")
    payload = payload if isinstance(payload, dict) else {}
    return _shown([event.get("subject"), payload.get("target"), payload.get("rel")])


def decision_texts(merged: Merged, not_applied: set[tuple[str, int]]) -> dict[str, Entry]:
    """Section 6.8: by decision id, the `decision.recorded` that is its text, judged over `merged`.

    `not_applied` holds the (tail, seq) of every move section 6.7 does not apply: such a move judges
    nothing, so it binds no text.
    """
    saw = sight(merged.held)
    positions: dict[str, int] = {}
    writings: dict[str, list[tuple[str, int, Entry]]] = {}
    texts: dict[str, Entry] = {}
    judged: set[str] = set()
    for tail, entry in merged.order:
        position = positions.get(tail, 0)
        positions[tail] = position + 1
        event = entry.event
        subject = str(event.get("subject"))
        kind = event.get("kind")
        if kind == "decision.recorded":
            if subject not in writings:
                writings[subject] = []
                texts[subject] = entry
            writings[subject].append((tail, position, entry))
            continue
        payload = event.get("payload")
        if kind != "decision.transitioned" or not isinstance(payload, dict):
            continue
        if payload.get("from", "") is None or subject in judged:
            continue
        if (tail, entry.seq) in not_applied:
            continue
        judged.add(subject)
        for written_tail, written_position, written in writings.get(subject, []):
            if saw((tail, position), (written_tail, written_position)):
                texts[subject] = written
                break
    return texts


def decision_rewrites(
    entries_by_tail: dict[str, list[Entry]], not_applied: set[tuple[str, int]]
) -> list[Foreign]:
    """Section 6.8: every `decision.recorded` that is not its decision's text, in tail order and
    then `seq` order."""
    tails = sorted(entries_by_tail, key=utf16_order)
    texts = decision_texts(merged_order(entries_by_tail), not_applied)
    found: list[Foreign] = []
    for tail in tails:
        for entry in entries_by_tail[tail]:
            event = entry.event
            if event.get("kind") != "decision.recorded":
                continue
            kept = texts.get(str(event.get("subject")))
            if kept is None or kept is entry:
                continue
            found.append(
                Foreign(
                    tail,
                    entry.seq,
                    "decision-rewrite",
                    f"a decision.recorded of {_shown(event.get('subject'))} signed by "
                    f"{_shown(event.get('who'))}, not the text of the decision (the writing signed by "
                    f"{_shown(kept.event.get('who'))} is) - a decision is the text its first "
                    "judgment was made on, or its first writing while none has judged it, so this "
                    "writing is not applied",
                )
            )
    return found


def decision_divergences(
    entries_by_tail: dict[str, list[Entry]], not_applied: set[tuple[str, int]]
) -> list[Foreign]:
    """Section 6.7: every decision that one machine ACCEPTED and another RETIRED (rejected or
    superseded) out of the same state, by moves that did not see each other - the moves a reader
    applies, in the merged order. Named, never refused: both moves are intact, chained and signed,
    and the verdict does not change. A move repeated byte for byte is one move read twice."""
    seen: dict[tuple[str, str], list[tuple[str, Entry]]] = {}
    read: set[str] = set()
    for tail, entry in merged_order(entries_by_tail).order:
        event = entry.event
        payload = event.get("payload")
        if event.get("kind") != "decision.transitioned" or not isinstance(payload, dict):
            continue
        if (tail, entry.seq) in not_applied or payload.get("from") is None:
            continue
        bytes_ = json.dumps(event, sort_keys=True, ensure_ascii=True)
        if bytes_ in read:
            continue
        read.add(bytes_)
        seen.setdefault((str(event.get("subject")), str(payload.get("from"))), []).append(
            (tail, entry)
        )
    found: list[Foreign] = []
    for (subject, left), moves in seen.items():
        to = [str(entry.event["payload"].get("to")) for _tail, entry in moves]
        if "accepted" not in to or all(one == "accepted" for one in to):
            continue
        by = " and ".join(
            f"{_shown(one)} ({_shown(entry.event.get('who'))} at {_shown(entry.event.get('at'))})"
            for one, (_tail, entry) in zip(to, moves)
        )
        tail, first = moves[0]
        found.append(
            Foreign(
                tail,
                first.seq,
                "decision-divergence",
                f"{_shown(subject)} left {_shown(left)} by {by}, moves on machines that had not "
                "seen each other: the decision is in force under neither, and a person decides "
                "it again",
            )
        )
    return found
