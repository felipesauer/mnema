"""What this verifier checks about ITSELF, from data somebody else published.

A second implementation whose own correctness rests on its author's word is not much of a
second opinion. So the cases here come from outside wherever they can:

  Ed25519              RFC 8032 section 7.1's test vectors, verbatim
  framed hashing       section 2's own collision argument, built as a pair
  section 1            the six rules and the four refusals, each exercised
  section 5            an empty range's root, distinct from any single-event root
  section 8            the three declared limits, each refused BY NAME

Nothing here reads the product. The RFC vectors are the load-bearing half: they are what
makes the signature check somebody else's published claim rather than mine.

THIS FILE IS PURE ASCII. Every character above U+007E is written as an escape, because two
of these cases ARE control bytes and a byte a reviewer cannot see is a byte nobody reviewed.
"""

from __future__ import annotations

import hashlib

from . import ots
from .canonical import UNDEFINED, canonical, canonical_bytes, strict_loads
from .ed25519 import public_key_of as ed_public_key_of
from .ed25519 import sign as ed_sign
from .ed25519 import verify as ed25519_verify
from . import schema
from .framed import digest, frame
from .root import content_root, empty_root
from .verdict import Refusal, Report

# RFC 8032, section 7.1 - Test Vectors for Ed25519. (public key, signature, message), hex.
RFC8032 = (
    (
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555f"
        "b8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        "",
    ),
    (
        "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da08"
        "5ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
        "72",
    ),
    (
        "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
        "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18"
        "ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
        "af82",
    ),
)

# The SECRETS of the three vectors above, which RFC 8032 section 7.1 publishes beside them.
# They are here because this program SIGNS as well as verifies: `mutate` needs a checkpoint
# signed by a key no enrolment authorized, and that input cannot be forged by editing bytes -
# every other check has to keep closing, so the signature has to be real. A key whose secret
# is in a published RFC is the one key a verifier can hold without holding a secret.
RFC8032_SECRETS = (
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
)


def _expect_refusal(report: Report, section: str, what: str, thunk) -> None:
    try:
        thunk()
    except Refusal:
        report.ok(section, f"refuses {what}", "self-test")
        return
    report.fail(section, f"ACCEPTS {what}, and the format refuses it", "self-test")


def _signatures(report: Report) -> None:
    good = 0
    for public_key, signature, message in RFC8032:
        if ed25519_verify(
            bytes.fromhex(public_key), bytes.fromhex(signature), bytes.fromhex(message)
        ):
            good += 1
        else:
            report.fail(
                "6", f"an RFC 8032 vector does not verify: {public_key[:12]}...", "self-test"
            )
    if good:
        report.ok("6", f"{good} of {len(RFC8032)} RFC 8032 Ed25519 vectors verify", "self-test")

    # THE SIGNER, against the same published data. A signer checked only by this program's
    # own verifier would be two halves agreeing with each other; these are RFC 8032's own
    # signatures, byte for byte, and Ed25519 is deterministic so there is exactly one right
    # answer per (secret, message).
    signed = 0
    derived = 0
    for secret, (public_key, signature, message) in zip(RFC8032_SECRETS, RFC8032):
        raw = bytes.fromhex(secret)
        if ed_public_key_of(raw).hex() == public_key:
            derived += 1
        if ed_sign(raw, bytes.fromhex(message)).hex() == signature:
            signed += 1
    if derived == len(RFC8032):
        report.ok("6", f"{derived} RFC 8032 secrets derive the public keys the RFC publishes", "self-test")
    else:
        report.fail("6", f"only {derived} of {len(RFC8032)} secrets derive their published key", "self-test")
    if signed == len(RFC8032):
        report.ok("6", f"{signed} of {len(RFC8032)} RFC 8032 signatures are reproduced by signing", "self-test")
    else:
        report.fail("6", f"only {signed} of {len(RFC8032)} RFC 8032 signatures reproduce", "self-test")

    public_key, signature, message = RFC8032[1]
    flipped = bytearray(bytes.fromhex(signature))
    flipped[0] ^= 0x01
    if ed25519_verify(bytes.fromhex(public_key), bytes(flipped), bytes.fromhex(message)):
        report.fail("6", "a signature with a flipped bit still verifies", "self-test")
    else:
        report.ok("6", "a signature with a flipped bit does not verify", "self-test")

    if ed25519_verify(
        bytes.fromhex(RFC8032[0][0]), bytes.fromhex(signature), bytes.fromhex(message)
    ):
        report.fail("6", "a signature verifies under the wrong key", "self-test")
    else:
        report.ok("6", "a signature does not verify under another key", "self-test")

    if ed25519_verify(bytes.fromhex(public_key), bytes.fromhex(signature)[:63], b"r"):
        report.fail("6", "a 63-byte signature verifies", "self-test")
    else:
        report.ok("6", "a signature of the wrong length does not verify", "self-test")


def _framing(report: Report) -> None:
    if frame(b"") == b"\x00\x00\x00\x00":
        report.ok("2", "an empty field is four zero bytes and nothing after them", "self-test")
    else:
        report.fail("2", "an empty field is not four zero bytes", "self-test")

    if digest("d", b"a", b"bc") != digest("d", b"ab", b"c"):
        report.ok(
            "2",
            'the field tuples ("a","bc") and ("ab","c") hash differently, which is what the '
            "frame is for: without it they are the same byte stream",
            "self-test",
        )
    else:
        report.fail("2", 'the pair ("a","bc") and ("ab","c") collides', "self-test")

    if digest("one", b"x") != digest("two", b"x"):
        report.ok(
            "2", "the domain separates: the same field under two domains differs", "self-test"
        )
    else:
        report.fail("2", "the domain does not separate", "self-test")

    if hashlib.sha256(b"").hexdigest().startswith("e3b0c442"):
        report.ok("2", "this build's SHA-256 is SHA-256", "self-test")
    else:  # pragma: no cover
        report.fail("2", "this build's SHA-256 is not SHA-256", "self-test")


# The six rules, as (what it shows, the bytes section 1 asks for, the value).
_RULES: tuple[tuple[str, str, object], ...] = (
    (
        "keys are sorted by UTF-16 code unit, not by code point: a surrogate pair starts at "
        "0xD800, so U+10000 sorts before U+FFFD",
        '{"\U00010000":2,"\ufffd":1}',
        {"\ufffd": 1, "\U00010000": 2},
    ),
    ("array order is preserved, because order in an array is semantic", "[3,1,2]", [3, 1, 2]),
    ("a decomposed string normalizes to NFC", '"\u00e9"', "e\u0301"),
    ("a decomposed KEY normalizes to NFC", '{"\u00e9":1}', {"e\u0301": 1}),
    ("-0 is emitted as 0", "0", -0.0),
    ("1.0 is emitted as 1, the way JavaScript spells it", "1", 1.0),
    ("1e-7 is emitted as 1e-7, not as 1e-07", "1e-7", 1e-7),
    (
        "1e20 is emitted in full and 1e21 exponentially, which is where ECMA-262 puts the line",
        "[100000000000000000000,1e+21]",
        [1e20, 1e21],
    ),
    ("a solidus is not escaped", '"/"', "/"),
    ("U+2028 and U+2029 are not escaped", '["\u2028","\u2029"]', ["\u2028", "\u2029"]),
    ("U+007F is not escaped", '"\u007f"', "\u007f"),
    (
        "the three characters Go's encoding/json escapes by default are not escaped here",
        '"<>&"',
        "<>&",
    ),
    (
        "a control character below U+0020 with no short form is \\u00xx in LOWER-case hex",
        '"\\u001f"',
        "\u001f",
    ),
    (
        "the five control characters with a short form use it",
        '"\\b\\t\\n\\f\\r"',
        "\b\t\n\f\r",
    ),
    (
        "there is no insignificant whitespace, and the sort is recursive",
        '{"a":[1,2],"b":{"c":3,"d":4}}',
        {"b": {"d": 4, "c": 3}, "a": [1, 2]},
    ),
)


def _canonicalization(report: Report) -> None:
    for what, expected, value in _RULES:
        produced = canonical(value)
        if produced == expected:
            report.ok("1", what, "self-test")
        else:
            report.fail("1", f"{what}: produced {produced!r}, wanted {expected!r}", "self-test")

    _expect_refusal(report, "1", "NaN", lambda: canonical(float("nan")))
    _expect_refusal(report, "1", "+Infinity", lambda: canonical(float("inf")))
    _expect_refusal(report, "1", "-Infinity", lambda: canonical(float("-inf")))
    _expect_refusal(report, "1", "a lone surrogate in a value", lambda: canonical("\ud800"))
    _expect_refusal(report, "1", "a lone surrogate in a key", lambda: canonical({"\udfff": 1}))
    _expect_refusal(
        report, "1", "an explicit undefined property", lambda: canonical({"a": UNDEFINED})
    )
    _expect_refusal(
        report,
        "1",
        "two keys that normalize to the same string",
        lambda: canonical({"\u00e9": 1, "e\u0301": 2}),
    )
    _expect_refusal(
        report,
        "1",
        "a literal duplicate key on a line, which every library parser silently keeps the last of",
        lambda: strict_loads('{"a":1,"a":2}'),
    )
    _expect_refusal(
        report, "1", "the NaN literal in a line", lambda: strict_loads('{"a":NaN}')
    )
    _expect_refusal(
        report, "1", "the Infinity literal in a line", lambda: strict_loads('{"a":Infinity}')
    )
    _expect_refusal(
        report,
        "1",
        "a lone surrogate escaped into a line",
        lambda: canonical(strict_loads('"\\ud800"')),
    )
    _expect_refusal(
        report, "1", "a value the format has no bytes for", lambda: canonical(object())
    )


def _folding(report: Report) -> None:
    if empty_root() != content_root([b"{}"]):
        report.ok("5", "an empty range's root is distinct from a single-event root", "self-test")
    else:
        report.fail("5", "an empty range's root equals a single-event root", "self-test")

    if content_root([b"a", b"b"]) != content_root([b"ab"]):
        report.ok(
            "5",
            "a two-event fold cannot equal a one-event fold over the concatenation",
            "self-test",
        )
    else:
        report.fail(
            "5", "a two-event fold equals the one-event fold of the concatenation", "self-test"
        )

    honest = canonical_bytes({"payload": "honest"})
    edited = canonical_bytes({"payload": "edited"})
    if content_root([honest, honest]) != content_root([honest, edited]):
        report.ok(
            "5",
            "editing one event of a range moves the root, which is what folding CONTENT rather "
            "than stored hashes buys: repairing every hash in the chain does not repair this",
            "self-test",
        )
    else:
        report.fail("5", "editing an event of a range leaves the root unchanged", "self-test")

    if content_root([honest, edited]) != content_root([edited, honest]):
        report.ok("5", "the fold is ordered: swapping two events moves the root", "self-test")
    else:
        report.fail("5", "the fold does not depend on order", "self-test")


def _witness_limits(report: Report) -> None:
    head = ots.MAGIC + b"\x01\x08" + b"\x00" * 32

    _expect_refusal(
        report,
        "8",
        f"a proof past {ots.MAX_PROOF_BYTES} bytes",
        lambda: ots.parse(b"\x00" * (ots.MAX_PROOF_BYTES + 1)),
    )
    _expect_refusal(
        report, "8", "a file that is not an OpenTimestamps proof", lambda: ots.parse(b"nope")
    )
    _expect_refusal(
        report,
        "8",
        f"a path deeper than {ots.MAX_PATH_STEPS} steps",
        lambda: ots.parse(head + b"\x08" * (ots.MAX_PATH_STEPS + 2)),
    )

    # Two appends of 4 KiB each walk the folded message past the 4 KiB limit. The length is
    # a varuint: 0x2000 is 4096, which is 0x80 0x20 little-endian, seven bits at a time.
    append_4k = b"\xf0\x80\x20" + b"\x00" * ots.MAX_FOLDED_BYTES
    _expect_refusal(
        report,
        "8",
        f"a message a path has folded past {ots.MAX_FOLDED_BYTES} bytes",
        lambda: ots.parse(head + append_4k + append_4k),
    )
    _expect_refusal(
        report,
        "8",
        "a proof that ends in the middle of a field",
        lambda: ots.parse(ots.MAGIC + b"\x01\x08" + b"\x00" * 8),
    )
    _expect_refusal(
        report, "8", "an operation tag it does not know", lambda: ots.parse(head + b"\x99")
    )
    _expect_refusal(
        report,
        "8",
        "a major version it does not know",
        lambda: ots.parse(ots.MAGIC + b"\x09\x08" + b"\x00" * 32),
    )
    _expect_refusal(
        report,
        "8",
        "trailing bytes after the proof",
        lambda: ots.parse(head + b"\x00" + b"\x00" * 8 + b"\x00" + b"\xff"),
    )

    from .bitcoin import GENESIS_BITS, MINIMUM_BITS, parse_header, target_from_bits

    if target_from_bits(GENESIS_BITS) // 2**40 == target_from_bits(MINIMUM_BITS):
        report.ok(
            "8",
            f"the {MINIMUM_BITS:#010x} floor is the genesis target divided by 2**40, so "
            '"at least 0x1800ffff" and "2**40 times the genesis difficulty" are one sentence',
            "self-test",
        )
    else:
        report.fail(
            "8", f"{MINIMUM_BITS:#010x} is not the genesis target over 2**40", "self-test"
        )

    genesis_style = bytes(72) + GENESIS_BITS.to_bytes(4, "little") + bytes(4)
    if not parse_header(genesis_style, 0).meets_the_declared_floor():
        report.ok(
            "8",
            "a header declaring the genesis target is refused by the floor, which is the whole "
            "point of having one",
            "self-test",
        )
    else:
        report.fail("8", "a header at the genesis target passes the floor", "self-test")

    _expect_refusal(
        report, "8", "a block header that is not 80 bytes", lambda: parse_header(b"\x00" * 79, 0)
    )


def _declarations(report: Report) -> None:
    """Section 4.1's rule vocabulary, one accepted value and one refused value each.

    THIS BATTERY EXISTS BECAUSE A MUTATION FOUND NOTHING. Turning the `instant` rule off
    left ZERO tests red: every published vector and every frozen record carries a
    well-formed `at`, and no mutation produced a malformed one, so a rule the document
    states and this reader implements was exercised by nothing at all. A rule with no input
    is a rule nobody has checked, and the same was true of `boolean`, `count` and
    `string|null` on the REFUSING side — the accepting side is covered by rebuilding the 23
    vectors, which is exactly the half that cannot go wrong quietly.

    It is total over the vocabulary by construction: the loop is over KNOWN_RULES, so a
    rule added without a row here is reported as unexercised rather than silently skipped.
    """
    # (rule, a value it accepts, a value it refuses). `_MISSING` stands for an absent key.
    cases: dict[str, tuple[object, object]] = {
        "string": ("a", ""),
        "string?": (schema._MISSING, ""),
        "string|null": (None, ""),
        "boolean": (False, "false"),
        "count": (1, 0),
        "string[]?": (["a"], []),
        "fields?": ({"note": "n"}, {}),
        "version": (1, 0),
        "kind": ("memory.captured", ""),
        "instant": ("2026-07-21T00:00:00.000Z", "2026-07-21T00:00:00Z"),
    }
    unexercised = sorted(schema.KNOWN_RULES - set(cases))
    if unexercised:
        report.fail(
            "4.1",
            "rule(s) in this reader's vocabulary with no self-test case: " + ", ".join(unexercised),
            "self-test",
        )
    declarations = None
    try:
        declarations = schema.load()
    except Refusal as refusal:
        report.unchecked("4.1", refusal.what, "self-test", "G08")
    accepted = 0
    refused = 0
    for rule, (good, bad) in sorted(cases.items()):
        try:
            schema._apply("self-test", "f", rule, good, declarations)
            accepted += 1
        except Refusal:
            report.fail("4.1", f"the rule {rule!r} refuses a value section 4.1 accepts", "self-test")
        try:
            schema._apply("self-test", "f", rule, bad, declarations)
            report.fail("4.1", f"the rule {rule!r} ACCEPTS a value section 4.1 refuses", "self-test")
        except Refusal:
            refused += 1
    if accepted == len(cases) and refused == len(cases):
        report.ok(
            "4.1",
            f"all {len(cases)} field rules of the published vocabulary accept a value and "
            "refuse one, which is every rule this reader knows",
            "self-test",
        )
    # The instant rule twice more, on the two ways a date can be wrong that a PATTERN alone
    # cannot tell apart: the shape is right and the date is not.
    for impossible in ("2026-13-01T00:00:00.000Z", "2026-02-30T00:00:00.000Z"):
        _expect_refusal(
            report,
            "4.1",
            f"an `at` matching the shape and naming no day: {impossible}",
            lambda value=impossible: schema._apply("self-test", "at", "instant", value),
        )


def run(report: Report) -> None:
    _signatures(report)
    _declarations(report)
    _framing(report)
    _canonicalization(report)
    _folding(report)
    _witness_limits(report)
