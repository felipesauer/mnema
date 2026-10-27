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
"""

from __future__ import annotations

import json
from typing import NamedTuple

from .canonical import utf16_order
from .enrolment import merged_order
from .entry import Entry

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
