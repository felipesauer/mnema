"""Section 4.1 - the field declarations, read from the artifact that publishes them.

GAP G08, CLOSED. Section 4 has always promised that "a reader rebuilds the event from the
fields its kind declares and rejects any other". Those declarations used to be published
NOWHERE: the canonical vectors give one exemplar per kind, and from an exemplar a required
field and an optional one that happens to be present look identical. So this reader had
only byte identity - which catches a field added to a line that was already written, and
CANNOT catch a newly appended event carrying one. It was measured accepting exactly that,
which the product refuses, and which a party with no key at all can produce.

`event-schema.json` is the artifact that closed it, and this module is section 4.1
implemented against it. Nothing here knows any kind by name: every rule comes out of the
file, and a kind, a field or a rule the file grows is a kind, a field or a rule this reader
applies without being edited.

WHAT THIS MODULE DELIBERATELY DOES NOT DO: trust the file's own `rules` glossary. The file
carries a one-line gloss of each rule so it is readable on its own, and section 4.1 states
the same vocabulary normatively. THE PROSE IS WHAT IS IMPLEMENTED HERE. What the glossary
is used for is the opposite check - that the file does not use a rule name it does not
define, and that it does not use one this reader has never heard of. A rule this reader
cannot apply is reported and the line it applies to is UNCHECKED, never quietly accepted:
"I do not know this rule" and "this line is fine" are not the same answer.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, NamedTuple

from .canonical import strict_loads
from .verdict import Refusal

DEFAULT_SCHEMA = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "event-schema.json")
)

# Section 4.1's `instant`: the exact spelling `toISOString` produces. The shape is a regex
# and the VALUE is a round trip - a pattern alone admits month 13 and day 32, which are not
# instants any clock produced.
_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

# Every rule name section 4.1 defines. A file naming one that is not here is a file this
# reader is too old for, and it says so rather than skipping the field.
KNOWN_RULES = frozenset(
    {
        "string",
        "string?",
        "string|null",
        "boolean",
        "count",
        "fields?",
        "string[]?",
        "version",
        "kind",
        "instant",
    }
)

# The largest whole number a double carries exactly. Section 4.1 says `count` is "a whole
# number of at least 1 (a safe integer)"; anything past this is a value that cannot survive
# the round trip through the JSON number section 1 specifies.
_MAX_SAFE_INTEGER = 2**53 - 1


class Contract(NamedTuple):
    kind: str
    v: int
    payload: dict[str, str]


class Schema(NamedTuple):
    """The published declarations, as this reader uses them."""

    envelope: dict[str, str]
    transition_fields: dict[str, str]
    contracts: dict[tuple[str, int], Contract]
    rules: dict[str, str]
    path: str
    unknown_rules: list[str]

    def top_level_keys(self) -> frozenset[str]:
        """Section 4.1: the keys of `envelope`, plus `payload`."""
        return frozenset(self.envelope) | {"payload"}


def load(path: str = DEFAULT_SCHEMA) -> Schema:
    """Read the artifact. Raises Refusal when it is not the file section 4.1 describes."""
    try:
        with open(path, "rb") as handle:
            document = strict_loads(handle.read().decode("utf-8"))
    except OSError as exc:
        raise Refusal("4", f"could not read the field declarations at {path}: {exc}") from exc
    if not isinstance(document, dict):
        raise Refusal("4", f"{path} is not the published schema")
    for key in ("envelope", "transitionFields", "contracts"):
        if key not in document:
            raise Refusal("4", f"{path} has no {key}, so it is not the published schema")

    envelope = _rule_map(document["envelope"], "envelope", path)
    transition = _rule_map(document["transitionFields"], "transitionFields", path)
    rows = document["contracts"]
    if not isinstance(rows, list) or not rows:
        raise Refusal("4", f"{path} declares no contracts")
    contracts: dict[tuple[str, int], Contract] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("kind"), str):
            raise Refusal("4", f"{path} holds a contract with no kind")
        v = row.get("v")
        if not isinstance(v, int) or isinstance(v, bool):
            raise Refusal("4", f"{path}: contract {row['kind']} has no integer v")
        payload = _rule_map(row.get("payload", {}), f"contract {row['kind']}@{v}", path)
        key = (row["kind"], v)
        if key in contracts:
            raise Refusal("4", f"{path} declares {row['kind']}@{v} twice")
        contracts[key] = Contract(row["kind"], v, payload)

    glossary = document.get("rules")
    rules = glossary if isinstance(glossary, dict) else {}
    used = set(envelope.values()) | set(transition.values())
    for contract in contracts.values():
        used |= set(contract.payload.values())
    unknown = sorted(used - KNOWN_RULES)
    return Schema(envelope, transition, contracts, rules, path, unknown)


def _rule_map(value: Any, where: str, path: str) -> dict[str, str]:
    if not isinstance(value, dict):
        raise Refusal("4", f"{path}: {where} is not an object of field rules")
    for field, rule in value.items():
        if not isinstance(rule, str):
            raise Refusal("4", f"{path}: {where}.{field} is not a rule name")
    return dict(value)


def undefined_rules(schema: Schema) -> list[str]:
    """Rule names the file uses and its own glossary does not define.

    Not a refusal of a record - it is a defect of the ARTIFACT, and it is reported as one.
    An artifact that names a rule it does not gloss is one a stranger has to guess at,
    which is the failure the whole file exists to end.
    """
    if not schema.rules:
        return []
    used: set[str] = set(schema.envelope.values()) | set(schema.transition_fields.values())
    for contract in schema.contracts.values():
        used |= set(contract.payload.values())
    return sorted(used - set(schema.rules))


class Rebuilt(NamedTuple):
    """One event, rebuilt from exactly what its contract declares."""

    event: dict[str, Any]
    contract: Contract


def rebuild(schema: Schema, event: Any) -> Rebuilt:
    """Section 4 and 4.1: rebuild the event from its declared fields, refusing any other.

    The rebuild is returned rather than a boolean, because "the fields it declares" is only
    half of section 4: the other half is that the rebuilt event canonicalizes to the stored
    bytes, and a caller that cannot see the rebuild cannot check that.
    """
    if not isinstance(event, dict):
        raise Refusal("4", "an event that is not a JSON object")
    kind = event.get("kind")
    if not isinstance(kind, str) or not kind:
        raise Refusal("4.1", "an event with no `kind`, so no contract selects it")
    v = event.get("v")
    if not isinstance(v, int) or isinstance(v, bool) or v < 1:
        raise Refusal("4.1", f"event {kind!r} carries no whole-number `v` of at least 1")
    contract = schema.contracts.get((kind, v))
    if contract is None:
        raise Refusal(
            "4.1",
            f"no published contract declares {kind}@{v}: a reader refuses a pair the table "
            "does not declare rather than guessing at the fields",
        )

    declared_top = schema.top_level_keys()
    extra = sorted(set(event) - declared_top)
    if extra:
        raise Refusal("4.1", f"event {kind!r} carries top-level field(s) {extra}, which nothing declares")

    rebuilt: dict[str, Any] = {}
    for field, rule in schema.envelope.items():
        value = _apply(kind, field, rule, event.get(field, _MISSING))
        if value is not _MISSING:
            rebuilt[field] = value

    payload = event.get("payload", _MISSING)
    if not isinstance(payload, dict):
        raise Refusal("4.1", f"event {kind!r} needs an object payload")
    forged = sorted(set(payload) - set(contract.payload))
    if forged:
        raise Refusal(
            "4.1",
            f"event {kind!r} carries payload field(s) {forged}, which its contract does not "
            "declare, so they would ride along into the signed bytes",
        )
    rebuilt_payload: dict[str, Any] = {}
    for field, rule in contract.payload.items():
        value = _apply(kind, f"payload.{field}", rule, payload.get(field, _MISSING), schema)
        if value is not _MISSING:
            rebuilt_payload[field] = value
    rebuilt["payload"] = rebuilt_payload
    return Rebuilt(rebuilt, contract)


class _Missing:
    """The absence of a key, which is not the same value as any key could hold."""

    def __repr__(self) -> str:  # pragma: no cover - a debugging convenience
        return "<absent>"


_MISSING = _Missing()


def _apply(kind: str, field: str, rule: str, value: Any, schema: Schema | None = None) -> Any:
    """Section 4.1's vocabulary, one rule at a time. Returns _MISSING for a legitimate absence."""
    if rule == "string":
        return _require_string(kind, field, value)
    if rule == "string?":
        return _MISSING if value is _MISSING else _require_string(kind, field, value)
    if rule == "string|null":
        if value is None:
            return None
        return _require_string(kind, field, value)
    if rule == "boolean":
        # Nothing is coerced: `"false"`, `0` and `null` are all falsy in the language this
        # format is written in and none of them is the position of a switch.
        if not isinstance(value, bool):
            raise Refusal("4.1", f"event {kind!r} needs true or false at {field}")
        return value
    if rule == "count":
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise Refusal("4.1", f"event {kind!r} needs a whole number of at least 1 at {field}")
        if value > _MAX_SAFE_INTEGER:
            raise Refusal("4.1", f"event {kind!r} has a count past the safe integers at {field}")
        return value
    if rule == "string[]?":
        if value is _MISSING:
            return _MISSING
        if not isinstance(value, list) or not value:
            raise Refusal("4.1", f"event {kind!r} needs a non-empty array at {field}")
        for at, item in enumerate(value):
            if not isinstance(item, str) or not item:
                raise Refusal("4.1", f"event {kind!r} needs a non-empty string at {field}[{at}]")
        return list(value)
    if rule == "fields?":
        if value is _MISSING:
            return _MISSING
        if schema is None:  # pragma: no cover - only the payload pass carries `fields?`
            raise Refusal("4.1", f"event {kind!r} declares {field} outside a payload")
        return _rebuild_fields(kind, field, value, schema)
    if rule == "version":
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise Refusal("4.1", f"event {kind!r} needs a whole number of at least 1 at {field}")
        return value
    if rule == "kind":
        return _require_string(kind, field, value)
    if rule == "instant":
        return _require_instant(kind, field, value)
    raise Refusal("4.1", f"event {kind!r} declares {field} under rule {rule!r}, which this reader does not know")


def _rebuild_fields(kind: str, field: str, value: Any, schema: Schema) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise Refusal("4.1", f"event {kind!r} needs an object at {field}")
    forged = sorted(set(value) - set(schema.transition_fields))
    if forged:
        raise Refusal("4.1", f"event {kind!r} carries {field} key(s) {forged}, which nothing declares")
    rebuilt: dict[str, Any] = {}
    for name, rule in schema.transition_fields.items():
        got = _apply(kind, f"{field}.{name}", rule, value.get(name, _MISSING), schema)
        if got is not _MISSING:
            rebuilt[name] = got
    if not rebuilt:
        # Section 4.1: never empty. An empty `fields` carries no proof, and admitting it
        # would make `{}` a second, byte-distinct spelling of "no fields".
        raise Refusal("4.1", f"event {kind!r} has an empty {field}; the declaration says omit it")
    return rebuilt


def _require_string(kind: str, field: str, value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise Refusal("4.1", f"event {kind!r} needs a non-empty string at {field}")
    return value


def _require_instant(kind: str, field: str, value: Any) -> str:
    text = _require_string(kind, field, value)
    if _INSTANT.match(text) is None or not _is_a_real_date(text):
        raise Refusal(
            "4.1",
            f"event {kind!r} needs a UTC millisecond instant at {field}, and carries {text!r}",
        )
    return text


def _is_a_real_date(text: str) -> bool:
    """The round trip the shape alone does not give: month 13 and day 32 match the pattern."""
    from datetime import datetime, timezone

    try:
        parsed = datetime(
            int(text[0:4]),
            int(text[5:7]),
            int(text[8:10]),
            int(text[11:13]),
            int(text[14:16]),
            int(text[17:19]),
            int(text[20:23]) * 1000,
            tzinfo=timezone.utc,
        )
    except ValueError:
        return False
    return parsed.strftime("%Y-%m-%dT%H:%M:%S.") + f"{parsed.microsecond // 1000:03d}Z" == text
