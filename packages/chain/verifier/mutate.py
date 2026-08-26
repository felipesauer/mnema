#!/usr/bin/env python3
"""The refusals, built - one named mutation of a record, applied in place.

A verifier that says "verified" about everything proves nothing, so this ships beside the
verifier rather than beside a test: the guard and the mutation that lights it travel
together, and anybody who doubts a refusal can produce the input that earns it.

    python3 mutate.py list
    python3 mutate.py <name> <record directory>       prints one JSON line

EVERY MUTATION REPORTS WHETHER IT APPLIED, and that is the whole reason the output is
machine-readable. A mutation anchored on bytes that moved leaves the record untouched and
the guard looks blind, when in fact nothing was mutated - so `applied` is asserted before
any verdict is read. It is also why each mutation compares the bytes it wrote against the
bytes that were there, rather than trusting that it edited something.

IT NEVER TOUCHES A RECORD IT DOES NOT OWN. It edits the directory it is given and nothing
else; the caller's job is to give it a copy. The frozen records carry real Bitcoin
attestations and real signatures and cannot be regenerated.

The bytes it writes are written by this verifier's own canonicalizer, not the product's,
which is worth something on its own: a mutation the product then reads as a well-formed
line is a round trip through a second implementation.
"""

from __future__ import annotations

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import base64  # noqa: E402
import hashlib  # noqa: E402

from mnemaverify.canonical import canonical_bytes, strict_loads  # noqa: E402
from mnemaverify.checkpoint import CHECKPOINT_KEYS, CHECKPOINT_SCHEME, signed_message  # noqa: E402
from mnemaverify.ed25519 import public_key_of, sign  # noqa: E402
from mnemaverify.entry import entry_hash  # noqa: E402
from mnemaverify.root import content_root  # noqa: E402

OTHER_KEY = "6bc98177967e959aefddb48f3e757e4358c6fb30910f44d5aa75247e05cdbc10"

# A KEY NOBODY ENROLLED, and one whose secret is published so it can actually sign.
#
# Section 6.2 is the difference between "the signature verifies" and "the signer was allowed
# to sign it", and an input that separates the two cannot be made by editing bytes: every
# other check has to keep closing, so the signature has to be REAL. RFC 8032 section 7.1's
# first test vector is the one key a verifier can hold the secret of without holding a
# secret - the RFC publishes it. Its public half is committed into the record like any
# other, correctly named by its own fingerprint, so nothing about the KEY is wrong. What is
# wrong is that no `identity.founded` and no `key.enrolled` ever brought it in.
UNENROLLED_SECRET = bytes.fromhex(
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
)
_SPKI_ED25519_PREFIX = bytes.fromhex("302a300506032b6570032100")


def _unenrolled_public() -> tuple[str, str]:
    """The committed form of that key: its fingerprint, and the PEM to write beside it."""
    der = _SPKI_ED25519_PREFIX + public_key_of(UNENROLLED_SECRET)
    body = base64.b64encode(der).decode("ascii")
    pem = f"-----BEGIN PUBLIC KEY-----\n{body}\n-----END PUBLIC KEY-----\n"
    return hashlib.sha256(der).hexdigest(), pem


def _commit_the_unenrolled_key(root: str) -> str:
    """Write it into `keys/`, so the reader can look it up and check its material."""
    fingerprint, pem = _unenrolled_public()
    keys = os.path.join(root, "keys")
    os.makedirs(keys, exist_ok=True)
    with open(os.path.join(keys, fingerprint + ".pub"), "w", encoding="utf-8") as handle:
        handle.write(pem)
    return fingerprint


def _tail_dir(root: str) -> str:
    tails = os.path.join(root, "tails")
    names = sorted(name for name in os.listdir(tails) if os.path.isdir(os.path.join(tails, name)))
    if not names:
        raise SystemExit(f"no tail under {tails}")
    return os.path.join(tails, names[0])


def _segment(root: str) -> str:
    tail = _tail_dir(root)
    names = sorted(
        name for name in os.listdir(tail) if name.endswith(".jsonl") and name[:-6].isdigit()
    )
    return os.path.join(tail, names[-1])


def _checkpoints(root: str) -> str:
    return os.path.join(_tail_dir(root), "checkpoints.jsonl")


def _read_lines(path: str) -> list[bytes]:
    with open(path, "rb") as handle:
        return handle.read().rstrip(b"\n").split(b"\n")


def _write_lines(path: str, lines: list[bytes]) -> None:
    with open(path, "wb") as handle:
        handle.write(b"\n".join(lines) + b"\n")


def _rewrite(path: str, lines: list[bytes]) -> bool:
    with open(path, "rb") as handle:
        before = handle.read()
    _write_lines(path, lines)
    with open(path, "rb") as handle:
        return handle.read() != before


# ---- the mutations ------------------------------------------------------------------


def edited_event(root: str) -> tuple[bool, str]:
    """One event's payload edited, and the hash chain left exactly as it was."""
    path = _segment(root)
    lines = _read_lines(path)
    at = min(2, len(lines) - 1)
    record = strict_loads(lines[at].decode("utf-8"))
    record["event"]["payload"] = _flip_payload(record["event"]["payload"])
    lines[at] = canonical_bytes(record)
    return _rewrite(path, lines), f"payload of seq {record['link']['seq']} edited"


def edited_event_chain_repaired(root: str) -> tuple[bool, str]:
    """THE CLAIM SECTION 5 CALLS LOAD-BEARING, as an attack.

    One event edited, and then every `hash` and `prev` in the tail recomputed so the
    keyless chain closes again. Anybody can do this: the entry hash takes no key. If the
    content root folded stored hashes, the signed head would be unchanged and its
    signature would still verify. It folds the CONTENT, so the root moves anyway - and
    the only thing that can catch this is the root.
    """
    path = _segment(root)
    records = [strict_loads(line.decode("utf-8")) for line in _read_lines(path)]
    at = min(2, len(records) - 1)
    records[at]["event"]["payload"] = _flip_payload(records[at]["event"]["payload"])
    tail = records[0]["link"]["tail"]
    previous: str | None = None
    for record in records:
        record["link"]["prev"] = previous
        record["link"]["hash"] = entry_hash(
            canonical_bytes(record["event"]), tail, record["link"]["seq"], previous
        )
        previous = record["link"]["hash"]
    lines = [canonical_bytes(record) for record in records]
    return _rewrite(path, lines), f"payload of seq {at} edited, the whole chain re-hashed"


def forged_extra_field(root: str) -> tuple[bool, str]:
    """A field no writer of this format puts there, with the line re-canonicalized."""
    path = _segment(root)
    lines = _read_lines(path)
    at = min(2, len(lines) - 1)
    record = strict_loads(lines[at].decode("utf-8"))
    record["event"]["forged"] = "rides along"
    lines[at] = canonical_bytes(record)
    return _rewrite(path, lines), f"an extra event field on seq {record['link']['seq']}"


def checkpoint_other_key(root: str) -> tuple[bool, str]:
    """A checkpoint pointed at another enrolled key, which is what signerFp is for."""
    path = _checkpoints(root)
    lines = _read_lines(path)
    checkpoint = strict_loads(lines[0].decode("utf-8"))
    if checkpoint["signerFp"] == OTHER_KEY:
        return False, "the checkpoint was already signed by the other key"
    checkpoint["signerFp"] = OTHER_KEY
    lines[0] = canonical_bytes(checkpoint)
    return _rewrite(path, lines), f"checkpoint 0 re-pointed at {OTHER_KEY[:12]}..."


def checkpoint_prev_broken(root: str) -> tuple[bool, str]:
    """The link that makes the checkpoints a chain, clobbered."""
    path = _checkpoints(root)
    lines = _read_lines(path)
    if len(lines) < 2:
        return False, "there is only one checkpoint, so there is no prev to break"
    checkpoint = strict_loads(lines[1].decode("utf-8"))
    checkpoint["prev"] = "f" * 64
    lines[1] = canonical_bytes(checkpoint)
    return _rewrite(path, lines), "checkpoint 1's prev clobbered"


def checkpoint_dropped(root: str) -> tuple[bool, str]:
    """Section 6's own sentence: dropping an earlier one while keeping a later one."""
    path = _checkpoints(root)
    lines = _read_lines(path)
    if len(lines) < 2:
        return False, "there is only one checkpoint, so none can be dropped"
    return _rewrite(path, lines[1:]), "the first checkpoint dropped, the later ones kept"


def witness_header_bit(root: str) -> tuple[bool, str]:
    """One bit of a stored block header, inside the merkle root the path folds to."""
    witness = os.path.join(_tail_dir(root), "witness")
    if not os.path.isdir(witness):
        return False, "there is no witness directory"
    names = sorted(name for name in os.listdir(witness) if name.endswith(".blocks"))
    if not names:
        return False, "there is no .blocks sidecar"
    path = os.path.join(witness, names[0])
    lines = _read_lines(path)
    stored = strict_loads(lines[-1].decode("utf-8"))
    header = bytearray(bytes.fromhex(stored["header"]))
    header[40] ^= 0x01  # inside bytes 36..68, the merkle root
    stored["header"] = bytes(header).hex()
    lines[-1] = canonical_bytes(stored)
    return _rewrite(path, lines), f"one bit of block {stored['height']}'s merkle root"


def witness_headers_swapped(root: str) -> tuple[bool, str]:
    """Two real block headers filed under each other's heights.

    GAP G24. Section 8 asks three things of a proof read offline: that its subject is the
    checkpoint's digest, that the path folds to the merkle root the stored header carries,
    and that the header's own hash meets the target it declares. The SECOND of those cannot
    be reached by editing a header: any change to the 80 bytes moves the double-SHA256 and
    breaks the work, so the work gate answers the case and the merkle question never runs.
    Measured - a flipped bit in a stored header makes the product say "carries no proof of
    work", never "carries another merkle root".

    So nothing is edited here. Two headers the record already carries are filed under each
    other's heights. Both are still real blocks with real work, and the merkle root under
    each height is now the wrong one - which is the only input that reaches the branch, and
    without it one of section 8's three requirements would be asserted by two readers and
    exercised by neither.
    """
    witness = os.path.join(_tail_dir(root), "witness")
    if not os.path.isdir(witness):
        return False, "there is no witness directory"
    names = sorted(name for name in os.listdir(witness) if name.endswith(".blocks"))
    if not names:
        return False, "there is no .blocks sidecar"
    path = os.path.join(witness, names[0])
    lines = _read_lines(path)
    if len(lines) < 2:
        return False, "the sidecar carries fewer than two headers, so none can be swapped"
    first = strict_loads(lines[0].decode("utf-8"))
    last = strict_loads(lines[-1].decode("utf-8"))
    if first["header"] == last["header"]:
        return False, "the two headers are identical, so swapping them changes nothing"
    lines[0] = canonical_bytes({"header": last["header"], "height": first["height"]})
    lines[-1] = canonical_bytes({"header": first["header"], "height": last["height"]})
    return (
        _rewrite(path, lines),
        f"blocks {first['height']} and {last['height']} filed under each other's heights",
    )


def forged_payload_field_appended(root: str) -> tuple[bool, str]:
    """An event appended KEYLESSLY, with a field inside its payload that no kind declares.

    THIS USED TO BE THE ONE THIS VERIFIER DID NOT REFUSE, and it shipped here so the
    acceptance was demonstrable rather than merely declared. The entry hash takes no key, so
    anybody who can write the repository can append; above the last checkpoint no signature
    covers the event; and the envelope keys are all present, so the only thing that could
    refuse it was the per-kind field declaration - which FORMAT.md published nowhere (gap
    G08). Byte identity, all this reader had, catches a field added to a line that was
    ALREADY written and cannot catch a new one.

    Section 4.1 and `event-schema.json` closed it, and both readers refuse it now. It stays
    here as the input that proves they do: an acceptance that was named, built, and then
    removed is worth more as a standing test than as a paragraph saying it used to happen.
    """
    path = _segment(root)
    lines = _read_lines(path)
    last = strict_loads(lines[-1].decode("utf-8"))
    event = dict(last["event"])
    payload = event.get("payload")
    event["payload"] = {
        **(payload if isinstance(payload, dict) else {}),
        "forgedInsidePayload": "rides along",
    }
    tail = last["link"]["tail"]
    seq = last["link"]["seq"] + 1
    previous = last["link"]["hash"]
    lines.append(
        canonical_bytes(
            {
                "event": event,
                "link": {
                    "hash": entry_hash(canonical_bytes(event), tail, seq, previous),
                    "prev": previous,
                    "seq": seq,
                    "tail": tail,
                },
            }
        )
    )
    return _rewrite(path, lines), f"seq {seq} appended with an extra key inside its payload"


def keys_removed(root: str) -> tuple[bool, str]:
    """The keyring taken away - which is not a break, and is not coverage either.

    A verifier with no public keys has not found anything wrong; it has been unable to ask.
    This is the input that separates REFUSED from INCOMPLETE, and it exists because a
    mutation that turned the INCOMPLETE branch off left ZERO tests red: the third state was
    described in two places and asserted in none. A guard with no mutation behind it is a
    guard nobody has checked, and that goes for a verdict state as much as for a scan.
    """
    keys = os.path.join(root, "keys")
    if not os.path.isdir(keys):
        return False, "there is no keys directory to remove"
    shutil.rmtree(keys)
    return not os.path.exists(keys), "the whole keys/ directory removed"


def key_renamed(root: str) -> tuple[bool, str]:
    """A key file renamed onto a fingerprint its own material does not hash to."""
    keys = os.path.join(root, "keys")
    names = sorted(name for name in os.listdir(keys) if name.endswith(".pub"))
    if not names:
        return False, "there are no keys"
    target = os.path.join(keys, "a" * 64 + ".pub")
    shutil.move(os.path.join(keys, names[0]), target)
    return os.path.exists(target), f"{names[0]} renamed onto a fingerprint it does not hash to"


def tail_relocated(root: str) -> tuple[bool, str]:
    """A tail copied into a fabricated directory, relabelled and re-chained.

    No key is needed for any of it: the entry hash is keyless, so a party who can write
    the repository can copy a tail, choose a new directory name, rewrite every
    `link.tail`, and recompute the chain. Everything internal then agrees. What refuses
    it is the tail id's fingerprint not being a key the record carries (gap G22) - which
    section 3 states as a description of the shape and not as a requirement.
    """
    source = _tail_dir(root)
    fabricated = os.path.join(os.path.dirname(source), "f" * 64 + "-" + "0" * 32)
    shutil.copytree(source, fabricated)
    tail = os.path.basename(fabricated)
    for name in sorted(os.listdir(fabricated)):
        if not (name.endswith(".jsonl") and name[:-6].isdigit()):
            continue
        path = os.path.join(fabricated, name)
        records = [strict_loads(line.decode("utf-8")) for line in _read_lines(path)]
        previous: str | None = None
        for record in records:
            record["link"]["tail"] = tail
            record["link"]["prev"] = previous
            record["link"]["hash"] = entry_hash(
                canonical_bytes(record["event"]), tail, record["link"]["seq"], previous
            )
            previous = record["link"]["hash"]
        _write_lines(path, [canonical_bytes(record) for record in records])
    # The checkpoints of the original cannot be re-signed, so they go: the fabricated
    # tail rests on the hash chain alone, which is exactly the attack's shape.
    for leftover in ("checkpoints.jsonl", "tailproof.json"):
        stale = os.path.join(fabricated, leftover)
        if os.path.exists(stale):
            os.remove(stale)
    shutil.rmtree(os.path.join(fabricated, "witness"), ignore_errors=True)
    return os.path.isdir(fabricated), f"the tail copied into tails/{tail[:20]}... and re-chained"


def _append(root: str, event: dict) -> tuple[dict, int]:
    """Append one event to the tail, keylessly - the entry hash takes no key.

    Returns the link it wrote and the seq. This is the window every mutation below works
    in, and it is the honest shape of the attack: above the last checkpoint no signature
    covers anything, so whoever can write the repository can put a line there and close the
    chain behind it.
    """
    path = _segment(root)
    lines = _read_lines(path)
    last = strict_loads(lines[-1].decode("utf-8"))
    tail = last["link"]["tail"]
    seq = last["link"]["seq"] + 1
    previous = last["link"]["hash"]
    link = {
        "hash": entry_hash(canonical_bytes(event), tail, seq, previous),
        "prev": previous,
        "seq": seq,
        "tail": tail,
    }
    lines.append(canonical_bytes({"event": event, "link": link}))
    _rewrite(path, lines)
    return link, seq


def _last_event(root: str) -> dict:
    lines = _read_lines(_segment(root))
    return dict(strict_loads(lines[-1].decode("utf-8"))["event"])


def appended_event_missing_a_declared_field(root: str) -> tuple[bool, str]:
    """An event appended KEYLESSLY with a REQUIRED payload field left out.

    THE HALF OF A DECLARATION AN EXEMPLAR CANNOT CARRY. The published vectors give one event
    per kind; from one event, a field that is required and a field that is optional and
    happens to be present look exactly the same. So this is the mutation that says whether a
    reader has the DECLARATIONS or only an example: the line is well-formed JSON, canonical,
    correctly hashed, its envelope is complete, and every field it does carry is a field its
    kind declares. What refuses it is `content` being declared `string` rather than
    `string?` - which is written down in `event-schema.json` and in section 4.1, and nowhere
    at all before them.
    """
    event = _last_event(root)
    payload = event.get("payload")
    if not isinstance(payload, dict) or not payload:
        return False, "the last event carries no payload field to leave out"
    dropped = sorted(payload)[0]
    event["payload"] = {key: value for key, value in payload.items() if key != dropped}
    _, seq = _append(root, event)
    return True, f"seq {seq} appended with its payload.{dropped} left out"


def appended_event_by_an_unenrolled_key(root: str) -> tuple[bool, str]:
    """An event appended KEYLESSLY, naming a signer no enrolment ever authorized.

    NO KEY IS NEEDED TO BUILD THIS - not even the unenrolled one. The entry hash takes no
    key, and an event is not individually signed, so a party who can write the repository
    writes a line naming whatever `signerFp` they like. The public key is committed beside
    it, correctly named by its own material, so a reader that checks fingerprints finds a
    perfectly good key. What refuses it is section 6.2: no `identity.founded` and no
    `key.enrolled` ever brought that key under this anchor, so it is not valid for the
    `who` the event names.
    """
    fingerprint = _commit_the_unenrolled_key(root)
    event = _last_event(root)
    if event.get("signerFp") == fingerprint:
        return False, "the last event is already signed by the unenrolled key"
    event["signerFp"] = fingerprint
    _, seq = _append(root, event)
    return True, f"seq {seq} appended naming the unenrolled signer {fingerprint[:12]}..."


def appended_event_with_a_loose_instant(root: str) -> tuple[bool, str]:
    """An event appended KEYLESSLY whose `at` drops its milliseconds.

    `2026-08-23T06:03:01Z` is a perfectly good ISO-8601 instant and it is not the one this
    format writes: section 4.1 declares `at` under the rule `instant`, which is the exact
    spelling `toISOString` produces. The distinction is not pedantry - the reader's ordering
    across tails compares these strings, so two spellings of one instant are two positions.
    A reader implementing "some ISO-8601 string" accepts this and diverges.
    """
    event = _last_event(root)
    at = event.get("at")
    if not isinstance(at, str) or not at.endswith("Z") or "." not in at:
        return False, "the last event's `at` is not the millisecond form, so there is nothing to drop"
    event["at"] = at.split(".")[0] + "Z"
    _, seq = _append(root, event)
    return True, f"seq {seq} appended with `at` spelled {event['at']}"


def appended_event_with_a_wrong_typed_field(root: str) -> tuple[bool, str]:
    """A `channel.switched` appended KEYLESSLY whose `on` is the STRING "off".

    THE ONE BOOLEAN IN THE CATALOG, and the one rule that cannot be reached by touching the
    frozen records at all: no event in them is of this kind. So the event is fabricated -
    with the record's own anchor and its own signing fingerprint, so nothing about its
    identity is wrong and section 6.2 has no quarrel with it. What refuses it is `on` being
    declared `boolean`: `"off"`, `0` and a missing key are three ways for two readers to
    disagree about whether a channel was on, and this is the kind a product reads to decide
    whether it says anything at all.
    """
    template = _last_event(root)
    event = {
        "v": 1,
        "kind": "channel.switched",
        "at": template["at"],
        "who": template["who"],
        "signerFp": template["signerFp"],
        "subject": "edit-rules-push",
        "payload": {"on": "off", "reason": "a string where the declaration says boolean"},
    }
    _, seq = _append(root, event)
    return True, f"seq {seq} appended as a channel.switched whose `on` is the string \"off\""


def appended_event_from_a_newer_catalog(root: str) -> tuple[bool, str]:
    """An event appended KEYLESSLY claiming a version no published contract declares.

    Section 4.1: `kind` and `v` TOGETHER select one contract, and a reader refuses a pair
    the table does not declare rather than guessing at the fields. The alternative - reading
    an unknown version under the newest contract it happens to have - is how a forger gets a
    payload validated against rules that were never meant for it, and how an honest reader
    silently misreads a future event as a present one.
    """
    event = _last_event(root)
    event["v"] = int(event.get("v", 1)) + 1
    _, seq = _append(root, event)
    return True, f"seq {seq} appended claiming {event['kind']}@{event['v']}"


def checkpoint_by_an_unenrolled_key(root: str) -> tuple[bool, str]:
    """A GENUINELY SIGNED checkpoint, by a key no enrolment authorized - and nothing else wrong.

    This is section 6.2's `edited-event-chain-repaired`: everything the format checks below
    the enrolment layer CLOSES. The appended event's entry hash is right. The new checkpoint
    chains by `prev` to the one before it. Its content root folds over the event it covers.
    Its Ed25519 signature verifies, under a key whose committed material hashes to exactly
    the fingerprint it is filed under. Every requirement of sections 1 through 6 holds.

    The only thing wrong is the one the document did not use to say: the signer was never
    brought under the anchor its events name. A reader that stops at "the signature verifies"
    accepts this, which is what "the signature verifies" is worth on its own.
    """
    fingerprint = _commit_the_unenrolled_key(root)
    checkpoints = _checkpoints(root)
    if not os.path.exists(checkpoints):
        return False, "there is no checkpoints file to extend"
    lines = _read_lines(checkpoints)
    last = strict_loads(lines[-1].decode("utf-8"))
    if last["signerFp"] == fingerprint:
        return False, "the last checkpoint is already signed by the unenrolled key"

    event = _last_event(root)
    event["signerFp"] = fingerprint
    _, seq = _append(root, event)

    stored = {
        "contentRoot": content_root([canonical_bytes(event)]),
        "fromSeq": seq,
        "prev": hashlib.sha256(signed_message(last, CHECKPOINT_KEYS)).hexdigest(),
        "scheme": CHECKPOINT_SCHEME,
        "signerFp": fingerprint,
        "tail": _tail_dir(root).rsplit(os.sep, 1)[-1],
        "toSeq": seq,
    }
    message = signed_message(stored, CHECKPOINT_KEYS)
    lines.append(canonical_bytes({**stored, "sig": sign(UNENROLLED_SECRET, message).hex()}))
    return (
        _rewrite(checkpoints, lines),
        f"cp[{seq}..{seq}] genuinely signed by the unenrolled {fingerprint[:12]}...",
    )


def _flip_payload(payload: object) -> object:
    """Change one string in a payload, or add one if it holds none."""
    if isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(value, str):
                return {**payload, key: value + " (edited)"}
        return {**payload, "edited": "yes"}
    return {"edited": "yes"}


MUTATIONS = {
    "edited-event": edited_event,
    "edited-event-chain-repaired": edited_event_chain_repaired,
    "forged-extra-field": forged_extra_field,
    "checkpoint-other-key": checkpoint_other_key,
    "checkpoint-prev-broken": checkpoint_prev_broken,
    "checkpoint-dropped": checkpoint_dropped,
    "witness-header-bit": witness_header_bit,
    "witness-headers-swapped": witness_headers_swapped,
    "key-renamed": key_renamed,
    "keys-removed": keys_removed,
    "forged-payload-field-appended": forged_payload_field_appended,
    "appended-event-missing-a-declared-field": appended_event_missing_a_declared_field,
    "appended-event-by-an-unenrolled-key": appended_event_by_an_unenrolled_key,
    "appended-event-from-a-newer-catalog": appended_event_from_a_newer_catalog,
    "appended-event-with-a-loose-instant": appended_event_with_a_loose_instant,
    "appended-event-with-a-wrong-typed-field": appended_event_with_a_wrong_typed_field,
    "checkpoint-by-an-unenrolled-key": checkpoint_by_an_unenrolled_key,
    "tail-relocated": tail_relocated,
}


def main(argv: list[str]) -> int:
    if len(argv) == 1 and argv[0] == "list":
        json.dump(sorted(MUTATIONS), sys.stdout)
        sys.stdout.write("\n")
        return 0
    if len(argv) != 2 or argv[0] not in MUTATIONS:
        sys.stderr.write(f"usage: mutate.py <{'|'.join(sorted(MUTATIONS))}|list> <record>\n")
        return 2
    name, root = argv
    if not os.path.isdir(os.path.join(root, "tails")):
        sys.stderr.write(f"{root} does not look like a record\n")
        return 2
    applied, detail = MUTATIONS[name](root)
    json.dump({"mutation": name, "applied": applied, "detail": detail}, sys.stdout)
    sys.stdout.write("\n")
    return 0 if applied else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
