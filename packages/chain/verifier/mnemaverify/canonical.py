"""Section 1 - an event becomes bytes.

Written from FORMAT.md section 1, from RFC 8259 for the JSON grammar, and from ECMA-262
for the two things section 1 anchors to JavaScript rather than states: the escaping
(section 1.4, "the shortest form JSON.stringify produces") and, by inference, the decimal
form of a number (gap G04 - the document says nothing about it beyond -0).

The six rules, and where each one is:

  1  keys sorted, recursively, by UTF-16 code unit, AFTER NFC     -> _sorted_pairs
  2  array order preserved                                        -> the list branch
  3  every string, value AND key, normalized to NFC               -> _text
  4  strings escaped by JSON semantics                            -> _escape
  5  -0 emitted as 0                                              -> _number
  6  UTF-8, no insignificant whitespace                           -> encode

And the four refusals, which are refusals and not coercions because a value that cannot
round-trip losslessly would let two different facts produce identical bytes:

  NaN / +-Infinity                     -> _number
  a lone surrogate in a string         -> _text
  an explicit undefined property       -> the UNDEFINED sentinel (gap G06)
  two keys colliding under NFC         -> _sorted_pairs (and literal duplicates, gap G07)
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from typing import Any

from .verdict import Refusal


class _Undefined:
    """The explicit-undefined of section 1's third refusal.

    JSON has no undefined, so no line on disk can carry one and no reader of files can
    ever reach this refusal (gap G06). It exists so the rule can be exercised at all,
    and so a writer built on this module refuses rather than choosing drop-or-keep.
    """

    _instance: "_Undefined | None" = None

    def __new__(cls) -> "_Undefined":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNDEFINED"


UNDEFINED = _Undefined()

_SHORT_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}

_MAX_EXACT_INT = 2**53


def _text(s: str) -> str:
    """Rule 3 plus the lone-surrogate refusal. Every string passes through here."""
    for ch in s:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise Refusal("1", f"lone surrogate U+{ord(ch):04X} in a string")
    return unicodedata.normalize("NFC", s)


def _escape(s: str) -> str:
    """Rule 4, written out rather than delegated (gap G05).

    Escaped, and only: `"`, `\\`, and U+0000..U+001F - two-character forms where one
    exists, `\\u00xx` in lower-case hex otherwise. Everything else travels literally in
    UTF-8: `/` is not escaped, U+2028 and U+2029 are not escaped, U+007F is not escaped,
    and `<` `>` `&` are not escaped. That last clause is the one that matters outside
    JavaScript: Go's encoding/json escapes those three by default.
    """
    out = ['"']
    for ch in s:
        short = _SHORT_ESCAPES.get(ch)
        if short is not None:
            out.append(short)
        elif ch < " ":
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


_REPR = re.compile(r"^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$")


def _double(x: float) -> str:
    """ECMA-262 Number::toString, base 10 (gap G04).

    Section 1 names only rule 5, so the decimal form is inferred from the JSON.stringify
    anchor in rule 4. The three cases that separate this from every other language's
    default: 1.0 prints as `1`, 1e-7 prints as `1e-7` and not `1e-07`, and 1e20 prints
    in full while 1e21 goes exponential.
    """
    if math.isnan(x):
        raise Refusal("1", "NaN")
    if math.isinf(x):
        raise Refusal("1", "Infinity" if x > 0 else "-Infinity")
    if x == 0:
        return "0"  # rule 5: -0.0 == 0.0 in Python, so this covers -0 too
    if x < 0:
        return "-" + _double(-x)

    m = _REPR.match(repr(x))
    if m is None:  # pragma: no cover - repr of a finite positive float always matches
        raise Refusal("1", f"a float this verifier cannot spell: {x!r}")
    int_part, frac, exp = m.group(1), m.group(2) or "", m.group(3)
    digits = int_part + frac
    tenth_power = (int(exp) if exp else 0) - len(frac)
    digits = digits.lstrip("0") or "0"
    while len(digits) > 1 and digits.endswith("0"):
        digits = digits[:-1]
        tenth_power += 1
    k = len(digits)
    n = k + tenth_power

    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    e = n - 1
    sign = "+" if e >= 0 else "-"
    mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{mantissa}e{sign}{abs(e)}"


def _number(v: int | float) -> str:
    if isinstance(v, int):
        # JavaScript has one number type, so a JSON integer past 2**53 is not the integer
        # a JavaScript reader would hold. Inside the exact range the decimal spelling and
        # the double spelling are the same string, so the fast path is not a second rule.
        if -_MAX_EXACT_INT < v < _MAX_EXACT_INT:
            return str(v)
        return _double(float(v))
    return _double(v)


def _sorted_pairs(obj: dict[Any, Any]) -> list[tuple[str, Any]]:
    """Rules 1 and 3, and the fourth refusal.

    The sort key is the UTF-16-BE encoding, not the code point sequence: comparing
    UTF-16 code units and comparing code points disagree above U+FFFF, because a
    surrogate pair starts at 0xD800 while U+FFFD is above it. `surrogatepass` is here
    only so the encode cannot raise; a lone surrogate has already been refused by _text.
    """
    pairs: list[tuple[str, Any]] = []
    seen: dict[str, None] = {}
    for raw_key, value in obj.items():
        if not isinstance(raw_key, str):
            raise Refusal("1", f"a non-string object key: {raw_key!r}")
        key = _text(raw_key)
        if key in seen:
            raise Refusal("1", f"two keys normalize to the same string: {key!r}")
        seen[key] = None
        pairs.append((key, value))
    pairs.sort(key=lambda kv: kv[0].encode("utf-16-be", errors="surrogatepass"))
    return pairs


def canonical(value: Any) -> str:
    if value is UNDEFINED:
        raise Refusal("1", "an explicit undefined property")
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _escape(_text(value))
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(f"{_escape(key)}:{canonical(val)}" for key, val in _sorted_pairs(value))
            + "}"
        )
    raise Refusal("1", f"a value the format has no bytes for: {type(value).__name__}")


def canonical_bytes(value: Any) -> bytes:
    """Rule 6. UTF-8, and the only place this module produces bytes."""
    return canonical(value).encode("utf-8")


# ---- reading a line back ------------------------------------------------------------


def _refuse_constant(name: str) -> Any:
    raise Refusal("1", f"the JSON literal {name}, which is not a value this format has")


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Refuse a duplicate key at PARSE time (gap G07).

    Every library JSON parser, `json.loads` among them, silently keeps the last of two
    identical keys. Section 1 refuses keys that collide; a reader that lets the parser
    swallow the literal duplicate accepts a line the format refuses, and so never
    disagrees with anything.
    """
    out: dict[str, Any] = {}
    normalized: dict[str, str] = {}
    for key, value in pairs:
        if key in out:
            raise Refusal("1", f"a duplicate object key on the line: {key!r}")
        folded = unicodedata.normalize("NFC", key)
        if folded in normalized:
            raise Refusal(
                "1", f"two keys normalize to the same string: {key!r} and {normalized[folded]!r}"
            )
        normalized[folded] = key
        out[key] = value
    return out


def strict_loads(text: str) -> Any:
    """Parse one JSON document with every refusal of section 1 in force."""
    try:
        return json.loads(
            text,
            object_pairs_hook=_strict_object,
            parse_constant=_refuse_constant,
        )
    except Refusal:
        raise
    except json.JSONDecodeError as exc:
        raise Refusal("1", f"not JSON: {exc}") from exc


def is_canonical_line(raw: bytes) -> tuple[bool, Any]:
    """Section 4's byte identity: re-serializing what a line holds reproduces the line.

    This one check subsumes key order, whitespace, escaping and the number form, and it
    is what refuses a forged extra field: a key that no writer of this format would have
    put there moves the bytes (gap G08 - the per-kind declarations are not published, so
    byte identity is the strongest refusal available from outside).
    """
    value = strict_loads(raw.decode("utf-8"))
    return canonical_bytes(value) == raw, value
