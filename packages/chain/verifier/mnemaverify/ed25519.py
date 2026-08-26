"""Ed25519 verification, from RFC 8032, with nothing imported but `hashlib`.

Section 6 says the signature is Ed25519 over the canonical bytes. It does not say more,
and it does not have to: Ed25519 is RFC 8032 and the RFC's own test vectors are published
data, so this is one of the few places where the document being terse costs nothing.

Why by hand rather than `cryptography`. A verifier a stranger has to `pip install`
something for is a verifier a stranger does not run, and a verifier whose signature check
lives in a wheel is one more thing that has to be the same wheel in ten years. The whole
program is the standard library. `selftest` runs RFC 8032 section 7.1's vectors, which is
what makes this file's correctness somebody else's published claim rather than mine.

Curve constants and the verification equation are RFC 8032 section 5.1. The equation used
is the cofactorless one, [S]B == R + [k]A, which is the one the RFC states; the cofactored
variant accepts a strictly larger set and no honest signer produces the difference.
"""

from __future__ import annotations

import hashlib

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, P - 2, P)) % P
SQRT_M1 = pow(2, (P - 1) // 4, P)

# The base point B, in extended coordinates (X, Y, Z, T) with T = X*Y/Z.
_BY = (4 * pow(5, P - 2, P)) % P
_BX = 0  # replaced below; recovered from _BY the same way any point is


def _recover_x(y: int, sign: int) -> int | None:
    """x from y on -x^2 + y^2 = 1 + d x^2 y^2, or None if there is no such point."""
    if y >= P:
        return None
    x2 = (y * y - 1) * pow(D * y * y + 1, P - 2, P) % P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (P + 3) // 8, P)
    if x * x % P != x2:
        x = x * SQRT_M1 % P
    if x * x % P != x2:
        return None
    if x % 2 != sign:
        x = P - x
    return x


_x = _recover_x(_BY, 0)
assert _x is not None  # noqa: S101 - the base point is a constant of the curve
B = (_x, _BY, 1, _x * _BY % P)
IDENTITY = (0, 1, 1, 0)


def _add(p: tuple[int, int, int, int], q: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = (y1 - x1) * (y2 - x2) % P
    b = (y1 + x1) * (y2 + x2) % P
    c = 2 * t1 * t2 * D % P
    dd = 2 * z1 * z2 % P
    e, f, g, h = b - a, dd - c, dd + c, b + a
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def _mul(p: tuple[int, int, int, int], n: int) -> tuple[int, int, int, int]:
    result = IDENTITY
    while n > 0:
        if n & 1:
            result = _add(result, p)
        p = _add(p, p)
        n >>= 1
    return result


def _equal(p: tuple[int, int, int, int], q: tuple[int, int, int, int]) -> bool:
    x1, y1, z1, _ = p
    x2, y2, z2, _ = q
    return (x1 * z2 - x2 * z1) % P == 0 and (y1 * z2 - y2 * z1) % P == 0


def _decode_point(data: bytes) -> tuple[int, int, int, int] | None:
    if len(data) != 32:
        return None
    y = int.from_bytes(data, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % P)


def verify(public_key: bytes, signature: bytes, message: bytes) -> bool:
    """True only if the signature is a valid Ed25519 signature of `message`.

    Every early return is a refusal, and none of them raises: a malformed key or a
    malformed signature is a failed verification, which is what a verifier wants, rather
    than an exception that a caller might catch into a pass.
    """
    if len(public_key) != 32 or len(signature) != 64:
        return False
    a = _decode_point(public_key)
    if a is None:
        return False
    r = _decode_point(signature[:32])
    if r is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= L:
        return False
    k = (
        int.from_bytes(
            hashlib.sha512(signature[:32] + public_key + message).digest(), "little"
        )
        % L
    )
    return _equal(_mul(B, s), _add(r, _mul(a, k)))
