"""Section 8's arithmetic on a Bitcoin block header.

An 80-byte header, in the order Bitcoin serializes it:

    0..4    version              little-endian
    4..36   previous block hash
    36..68  the merkle root      "internal order" - the bytes as stored, which is the
                                 reverse of how an explorer prints it
    68..72  time                 little-endian
    72..76  bits                 the compact target, little-endian
    76..80  nonce

Two of section 8's three questions are here: the path folds to the merkle root the stored
header carries, and the header's own hash meets the target it declares.

GAP G17. Section 8 names the endianness for the merkle root ("bytes 36-68, internal
order") and names nothing for the target: not the compact nBits expansion, not that the
double-SHA256 is compared as a little-endian integer. Both are Bitcoin standard, so a
stranger gets there - but the document chose to spell out one of the two and not the other.

The floor checks out as arithmetic: 0x1800ffff expands to 0xffff * 2**168, the genesis
target 0x1d00ffff expands to 0xffff * 2**208, and 208 - 168 = 40. So "at least 0x1800ffff"
and "2**40 times the genesis difficulty" are the same sentence, as section 8 says.
"""

from __future__ import annotations

import hashlib
from typing import NamedTuple

from .verdict import Refusal

HEADER_LENGTH = 80
MERKLE_ROOT_SLICE = slice(36, 68)
TIME_SLICE = slice(68, 72)
BITS_SLICE = slice(72, 76)

# Section 8's declared floor. A header mined at an easier target is refused, because one
# is found in milliseconds.
MINIMUM_BITS = 0x1800FFFF
GENESIS_BITS = 0x1D00FFFF


def _sha256d(data: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()


def target_from_bits(bits: int) -> int:
    exponent = bits >> 24
    mantissa = bits & 0x007FFFFF
    if bits & 0x00800000:  # the sign bit; no real header sets it
        raise Refusal("8", f"a negative compact target: {bits:#010x}")
    if exponent <= 3:
        return mantissa >> (8 * (3 - exponent))
    return mantissa << (8 * (exponent - 3))


MINIMUM_TARGET = target_from_bits(MINIMUM_BITS)


class Header(NamedTuple):
    raw: bytes
    height: int
    merkle_root: bytes
    stamped_at: int
    bits: int
    block_id: str

    @property
    def instant(self) -> str:
        """The header's own timestamp, as section 8's "the instant"."""
        from datetime import datetime, timezone

        return datetime.fromtimestamp(self.stamped_at, tz=timezone.utc).isoformat(
            timespec="seconds"
        )

    @property
    def work_hash(self) -> int:
        return int.from_bytes(_sha256d(self.raw), "little")

    @property
    def target(self) -> int:
        return target_from_bits(self.bits)

    def meets_its_own_target(self) -> bool:
        return self.work_hash <= self.target

    def meets_the_declared_floor(self) -> bool:
        return self.target <= MINIMUM_TARGET


def parse_header(raw: bytes, height: int) -> Header:
    if len(raw) != HEADER_LENGTH:
        raise Refusal("8", f"a block header of {len(raw)} bytes, not {HEADER_LENGTH}")
    return Header(
        raw=raw,
        height=height,
        merkle_root=raw[MERKLE_ROOT_SLICE],
        stamped_at=int.from_bytes(raw[TIME_SLICE], "little"),
        bits=int.from_bytes(raw[BITS_SLICE], "little"),
        # The id an explorer prints: the double-SHA256 reversed. Reported so that section
        # 8's escape hatch - "follows the block id into any explorer" - is usable from here.
        block_id=_sha256d(raw)[::-1].hex(),
    )


def read_blocks_sidecar(raw: bytes) -> dict[int, Header]:
    """The `.blocks` file: one canonical JSON object per line, {"header","height"}.

    Gap G16: the sidecar may carry headers the proof beside it does not use - the frozen
    record has one `.ots` and two headers - and the document does not say that, nor that
    the pairing is by the height the attestation declares.
    """
    from .canonical import canonical_bytes, strict_loads

    headers: dict[int, Header] = {}
    for number, line in enumerate(raw.split(b"\n"), start=1):
        if not line.strip():
            continue
        stored = strict_loads(line.decode("utf-8"))
        if not isinstance(stored, dict) or set(stored) != {"header", "height"}:
            raise Refusal("8", f"a .blocks line whose keys are not header and height (line {number})")
        if canonical_bytes(stored) != line:
            raise Refusal("8", f"a .blocks line that is not canonical (line {number})")
        if not isinstance(stored["height"], int) or isinstance(stored["height"], bool):
            raise Refusal("8", f"a .blocks height that is not an integer (line {number})")
        hex_header = stored["header"]
        if not isinstance(hex_header, str) or len(hex_header) != HEADER_LENGTH * 2:
            raise Refusal("8", f"a .blocks header that is not 160 hex characters (line {number})")
        try:
            data = bytes.fromhex(hex_header)
        except ValueError as exc:
            raise Refusal("8", f"a .blocks header that is not hex (line {number})") from exc
        headers[stored["height"]] = parse_header(data, stored["height"])
    return headers
