"""Section 6.7 - which moves of a workflow a reader applies, judged where the merged order puts them.

The tables are not here. They are the `workflows` object of `event-schema.json`, read by
`load` below, and nothing in this module names a state, an action or a field of one: a row the
file grows is a row this reader applies without being edited. What the section states in prose,
and is therefore written here, is the rest:

    a birth (`from` null)   legal when its action and `to` are the table's birth and the subject
                            has no state yet                      else born-twice / not-in-the-table
    any other move          the subject has a state at this point             else not-born
                            (from, action) is a row and `to` is the row's     else not-in-the-table
                            every field the row requires is in `fields`       else proof-missing
                            a row with `by` names a decision whose birth the
                            record holds and that is not its subject, and no
                            other row carries a `by`                          else successor
                            `from` is the state at this point, or the state its
                            writer saw, or - when its writer saw nothing of the
                            subject - a state the subject had been in         else not-the-state-seen
    run.ended               a run.started before it, and no end applied before
                            it or an open run in what its writer saw  else not-born / ended-twice

THE STATE AT A POINT is the `to` of the last move APPLIED before it in the merged order, so a
move that is not applied moves nothing after it either. THE STATE ITS WRITER SAW is the same
fold over only the moves its writer had read: the entries of its own tail before it, and on
every other tail the entries up to the last one its own tail cites in `after` at or before it.
A citation of a hash the record does not hold reads as nothing seen, as it is nothing ordered.

A subject is one workflow's: a decision and a task that share an id are two subjects, because
each table moves its own kind's subjects, and a run is a subject of its own.

A MOVE THAT IS NOT LEGAL IS NOT A BREAK. The event is intact, chained and signed; what it lacks
is a place in the workflow. So this reader names it, as a note, and the verdict does not move.
"""

from __future__ import annotations

import json
from typing import Any, Callable, NamedTuple

from .entry import Entry
from .verdict import Refusal

# Section 6.7's two kinds of a run, which no table holds: a run is open from its start and ends
# once.
RUN_STARTED = "run.started"
RUN_ENDED = "run.ended"
RUN_OPEN = "open"
RUN_SHUT = "ended"


class Row(NamedTuple):
    source: str
    action: str
    to: str
    requires: tuple[str, ...]
    by: bool


class Workflow(NamedTuple):
    states: tuple[str, ...]
    birth_action: str
    birth_to: str
    rows: tuple[Row, ...]


class Ruling(NamedTuple):
    """A move this reader does not apply: where it is, the rule it broke, and what it said."""

    tail: str
    seq: int
    kind: str
    subject: str
    rule: str
    detail: str


def load(value: Any, path: str) -> dict[str, Workflow]:
    """The `workflows` object of the published schema, or a Refusal naming what is wrong with it."""
    if not isinstance(value, dict) or not value:
        raise Refusal("6.7", f"{path}: workflows is not an object of tables")
    tables: dict[str, Workflow] = {}
    for kind, table in value.items():
        where = f"{path}: the workflow of {kind}"
        if not isinstance(table, dict):
            raise Refusal("6.7", f"{where} is not an object")
        states = table.get("states")
        birth = table.get("birth")
        moves = table.get("moves")
        if not isinstance(states, list) or not all(isinstance(s, str) for s in states):
            raise Refusal("6.7", f"{where} has no list of states")
        if (
            not isinstance(birth, dict)
            or not isinstance(birth.get("action"), str)
            or birth.get("to") not in states
        ):
            raise Refusal("6.7", f"{where} has no birth into one of its states")
        if not isinstance(moves, list):
            raise Refusal("6.7", f"{where} has no list of moves")
        rows: list[Row] = []
        for move in moves:
            if (
                not isinstance(move, dict)
                or move.get("from") not in states
                or move.get("to") not in states
                or not isinstance(move.get("action"), str)
                or not isinstance(move.get("requires"), list)
                or not all(isinstance(f, str) for f in move["requires"])
                or move.get("by", False) not in (True, False)
            ):
                raise Refusal("6.7", f"{where} holds a move that is not a row: {move!r}")
            if any(r.source == move["from"] and r.action == move["action"] for r in rows):
                raise Refusal(
                    "6.7", f"{where} holds two rows from {move['from']} by {move['action']}"
                )
            rows.append(
                Row(
                    move["from"],
                    move["action"],
                    move["to"],
                    tuple(move["requires"]),
                    move.get("by", False) is True,
                )
            )
        tables[kind] = Workflow(tuple(states), birth["action"], birth["to"], tuple(rows))
    return tables


def _shown(value: Any) -> str:
    """A value out of the record, as one line of ASCII: JSON's own escaping, quotes and all."""
    return json.dumps(value, ensure_ascii=True)


class _Applied(NamedTuple):
    tail: str
    position: int
    to: str


def judge(
    order: list[tuple[str, Entry]],
    held: list[tuple[str, int, str, int]],
    tables: dict[str, Workflow],
) -> list[Ruling]:
    """Every move of `order` this reader does not apply, in the merged order.

    `order` is the merged order of every tail, and `held` the citations it honoured, each as
    (citing tail, its position there, cited tail, the cited position) - positions counted from 0
    in each tail, as the order walks them.
    """
    seen_by = sight(held)
    # A successor is a subject whose birth the record holds, in the workflow whose row asks for one.
    births: dict[str, set[str]] = {}
    for _tail, entry in order:
        kind = entry.event.get("kind")
        payload = entry.event.get("payload")
        if kind in tables and isinstance(payload, dict) and payload.get("from", "") is None:
            births.setdefault(kind, set()).add(str(entry.event.get("subject")))

    positions: dict[str, int] = {}
    subjects: dict[tuple[str, str], list[_Applied]] = {}
    rulings: list[Ruling] = []
    for tail, entry in order:
        position = positions.get(tail, 0)
        positions[tail] = position + 1
        event = entry.event
        kind = event.get("kind")
        subject = event.get("subject")
        if not isinstance(kind, str) or not isinstance(subject, str):
            continue
        if kind == RUN_STARTED:
            subjects.setdefault((RUN_STARTED, subject), [_Applied(tail, position, RUN_OPEN)])
            continue
        if kind != RUN_ENDED and kind not in tables:
            continue
        key = (RUN_STARTED if kind == RUN_ENDED else kind, subject)
        applied = subjects.get(key, [])

        def seen(applied: list[_Applied] = applied, tail: str = tail, position: int = position) -> str | None:
            for move in reversed(applied):
                if seen_by((tail, position), (move.tail, move.position)):
                    return move.to
            return None

        if kind == RUN_ENDED:
            rule, detail, to = _judge_end(applied, seen)
        else:
            rule, detail, to = _judge_move(
                tables[kind], event, applied, seen, births.get(kind, set())
            )
        if rule is not None:
            rulings.append(Ruling(tail, entry.seq, kind, subject, rule, detail))
            continue
        applied.append(_Applied(tail, position, to))
        subjects[key] = applied
    return rulings


def _judge_end(
    applied: list[_Applied], seen: Callable[[], str | None]
) -> tuple[str | None, str, str]:
    if not applied:
        return "not-born", "the end of a run with no start before it", RUN_SHUT
    if applied[-1].to == RUN_OPEN or seen() == RUN_OPEN:
        return None, "", RUN_SHUT
    return "ended-twice", "the end of a run that had ended already", RUN_SHUT


def _judge_move(
    table: Workflow,
    event: dict[str, Any],
    applied: list[_Applied],
    seen: Callable[[], str | None],
    births: set[str],
) -> tuple[str | None, str, str]:
    payload = event.get("payload")
    payload = payload if isinstance(payload, dict) else {}
    source = payload.get("from")
    to = payload.get("to")
    action = payload.get("action")
    said = f"a move {'null' if source is None else _shown(source)} -> {_shown(to)} by {_shown(action)}"
    now = applied[-1].to if applied else None
    to_text = to if isinstance(to, str) else ""

    if source is None:
        if now is not None:
            return "born-twice", f"{said}, a birth of a subject born already", to_text
        if action != table.birth_action or to != table.birth_to:
            return (
                "not-in-the-table",
                f"{said}, where a birth is null -> {_shown(table.birth_to)} by "
                f"{_shown(table.birth_action)}",
                to_text,
            )
        return _judge_successor(None, event, payload, births, said, to_text)
    if now is None:
        return "not-born", f"{said} of a subject with no birth before it", to_text
    row = next((r for r in table.rows if r.source == source and r.action == action), None)
    if row is None or row.to != to:
        return "not-in-the-table", f"{said}, which the workflow does not hold", to_text
    fields = payload.get("fields")
    fields = fields if isinstance(fields, dict) else {}
    missing = [field for field in row.requires if field not in fields]
    if missing:
        return "proof-missing", f"{said} without the {', '.join(missing)} it requires", to_text
    successor = _judge_successor(row, event, payload, births, said, to_text)
    if successor[0] is not None:
        return successor
    if source == now:
        return None, "", to_text
    sight = seen()
    if source == sight:
        return None, "", to_text
    # A writer whose sight holds nothing of the subject did not say what it read, and the bytes
    # cannot say it for it: it is held to a state the subject had been in before this point.
    if sight is None and any(move.to == source for move in applied):
        return None, "", to_text
    return (
        "not-the-state-seen",
        f"{said} of a subject that was {_shown(now)} there, and "
        f"{'not born' if sight is None else _shown(sight)} to the one that wrote it",
        to_text,
    )


def _judge_successor(
    row: Row | None,
    event: dict[str, Any],
    payload: dict[str, Any],
    births: set[str],
    said: str,
    to_text: str,
) -> tuple[str | None, str, str]:
    by = payload.get("by")
    if row is None or not row.by:
        if by is None:
            return None, "", to_text
        return "successor", f"{said} that names a successor it does not take", to_text
    if by is None:
        return "successor", f"{said} that names no successor", to_text
    if by == event.get("subject"):
        return "successor", f"{said} that names its own subject as successor", to_text
    if by not in births:
        return (
            "successor",
            f"{said} naming a successor {_shown(by)} the record holds no birth of",
            to_text,
        )
    return None, "", to_text


def sight(
    held: list[tuple[str, int, str, int]],
) -> Callable[[tuple[str, int], tuple[str, int]], bool]:
    """Whether the writer of `later` had read `earlier`: on one tail, whether `earlier` comes
    first; across tails, whether `later`'s tail cites, at or before it, an entry of `earlier`'s
    tail at or after it."""
    by_tail: dict[str, list[tuple[int, str, int]]] = {}
    for tail, position, cited_tail, cited_position in held:
        by_tail.setdefault(tail, []).append((position, cited_tail, cited_position))

    def saw(later: tuple[str, int], earlier: tuple[str, int]) -> bool:
        if later[0] == earlier[0]:
            return earlier[1] < later[1]
        return any(
            position <= later[1] and cited_tail == earlier[0] and cited_position >= earlier[1]
            for position, cited_tail, cited_position in by_tail.get(later[0], [])
        )

    return saw
