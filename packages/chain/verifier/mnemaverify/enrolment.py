"""Section 6.2 - which key was AUTHORIZED, folded from the record itself.

GAP G21, CLOSED. Section 6 asks that a signature verify under the key its `signerFp` names,
and that is a claim about WHICH key made it, not about whether that key was allowed to.
This reader used to stop at the first claim and say so, and the honesty of saying so did
not make it any less of a hole: it accepted a signer no enrolment authorized, which the
product refuses. The kinds that carry the authorization - `key.enrolled`, `key.revoked` -
were in the published vectors the whole time; the rule that reads them was not written
anywhere. It is section 6.2 now, and this module is that section and nothing else.

The shape, from the document:

    anchor(fp) = "mnid:" + SHA-256( UTF-8 of the 64-character lower-case fingerprint )

    identity.founded   signerFp == payload.foundingFp, subject == anchor(foundingFp),
                       who == subject                          -> adds foundingFp
    key.enrolled       who == subject, signerFp valid for the anchor AT THIS POINT, and
                       reverseSig verifies under the key newFp names, over the UTF-8 of
                       `enroll:<anchor>:<newFp>`              -> adds newFp
    key.revoked        who == subject, signerFp valid at this point
                                                              -> removes revokedFp

    checker.enrolled   subject == anchor(checkerFp), signerFp valid for `who` at this point,
                       and reverseSig verifies under the key checkerFp names, over the
                       UTF-8 of `check-enroll:<who>:<checkerFp>`  -> checkerFp is a checker
    checker.retired    subject == anchor(checkerFp), signerFp valid for `who` at this point
                       -> when COVERED, checkerFp is a checker no longer, and is retired
    check.passed,      signerFp is a checker at this point, and who == anchor(signerFp)
    check.failed
    any other kind     signed by a checker key: refused, whatever it is
    any kind at all    signed by a retired key: refused; a checker.enrolled naming one too

    agent.enrolled     who == subject, signerFp valid for the anchor at this point and not an
                       agent key, name trimmed of nothing in IDENTITY_TRIM and not who, agentFp
                       in no set and holding no role, and reverseSig verifies under the key
                       agentFp names, over the UTF-8 of `agent-enroll:<anchor>:<agentFp>:<name>`
                       -> adds agentFp to the anchor's set, as an AGENT named name
    agent.retired      who == subject, signerFp valid for the anchor at this point and not an
                       agent key, agentFp an agent key of this anchor
                       -> when COVERED, removes agentFp from the set, and it is retired
    any kind at all    signed by an agent key: refused when its who is not the anchor that
                       enrolled the key, its which is not the name byte for byte, or its kind
                       changes who may sign (AGENT_NEVER_SIGNS)

    backup.declared    who == subject, signerFp valid for the anchor at this point, and
                       backupFp valid for the anchor at this point
                       -> when COVERED, backupFp is the anchor's declared backup (6.5)

    every other event  signerFp is in the set of its own `who` at its point in the fold

THE TWO GATES ARE THE PART A READER GETS WRONG BY OMISSION. An event above the last
verified checkpoint of its tail rests on the hash chain alone, and the entry hash takes no
key - so anybody who can write the repository can put one there. A revocation in that
window is IGNORED, because honouring it would let a keyless party remove a member and flip
an honest fully-signed chain to failing. An addition that would RESTORE a key some covered
revocation removed is ignored in that window too, for the mirror reason: it would undo a
signed removal. A first enrolment restores nothing and is not gated.

WHY THE FOLD RUNS OVER EVERY TAIL AT ONCE: a key enrolled on one machine authorizes events
on another, so the order is the merge the document specifies - `seq` within a tail, which
the hash chain proves and which nothing may override, and across tails the smallest `at`
among the heads whose citations (`after`) have been taken, ties broken by tail id ascending.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, NamedTuple

from .checkpoint import IDENTITY_TRIM
from .ed25519 import verify as ed25519_verify
from .entry import Entry
from .keys import PublicKey

ANCHOR_PREFIX = "mnid:"

# Section 6.2: the kinds an agent key never signs - every fact that changes who may sign, or
# what a key may sign. A check result is not here: it already needs a checker key.
AGENT_NEVER_SIGNS = frozenset(
    {
        "identity.founded",
        "key.enrolled",
        "key.revoked",
        "backup.declared",
        "checker.enrolled",
        "checker.retired",
        "agent.enrolled",
        "agent.retired",
        "account.linked",
    }
)


def anchor_of(fingerprint: str) -> str:
    """Section 6.2's derivation. The hash is over the fingerprint's HEX TEXT, not its bytes."""
    return ANCHOR_PREFIX + hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def enrolment_message(anchor: str, new_fp: str) -> bytes:
    """What a new key signs to prove it consented: `enroll:<anchor>:<newFp>`, in UTF-8."""
    return f"enroll:{anchor}:{new_fp}".encode("utf-8")


def checker_message(anchor: str, checker_fp: str) -> bytes:
    """What a key signs to consent to sign check results: `check-enroll:<anchor>:<fp>`."""
    return f"check-enroll:{anchor}:{checker_fp}".encode("utf-8")


def agent_message(anchor: str, agent_fp: str, name: str) -> bytes:
    """What a key signs to consent to be the agent `name` of `anchor`:
    `agent-enroll:<anchor>:<agentFp>:<name>`, in UTF-8. The name is last and taken whole."""
    return f"agent-enroll:{anchor}:{agent_fp}:{name}".encode("utf-8")


class Issue(NamedTuple):
    tail: str
    seq: int
    detail: str


class Resolution(NamedTuple):
    """What the fold answers: the refusals, and what it leaves standing at the end."""

    issues: list[Issue]
    # The keys valid for each anchor once every tail is folded.
    members: dict[str, set[str]]
    # Section 6.5: the keys a COVERED backup.declared names, each with its anchor.
    backups: dict[str, str]
    # "Reading many tails": (tail, seq, hash) of every citation of an entry the record lacks.
    not_held: list[tuple[str, int, str]]
    # (tail, seq, milliseconds) of every event stamped before an entry it cites.
    behind: list[tuple[str, int, int]]
    # Section 6.2, "What a reader learns from it": (agentFp, anchor, name, events) of every agent
    # key that signed an accepted fact, and (which, events) of every `which` a key without the
    # role stated on one. Informational: nothing here moves the verdict.
    attested: list[tuple[str, str, str, int]]
    declared: list[tuple[str, int]]


def _merged(entries_by_tail: dict[str, list[Entry]]) -> Merged:
    """Section 6.2's order, "Reading many tails" in full: `seq` within a tail; across tails the
    smallest `at` among the heads whose citations (`after`) have all been taken, then tail id.

    A citation resolves among the record's own entries; one naming a hash the record does not
    hold is ignored and returned. If no head is ready - a cycle, which takes a SHA-256
    collision - the smallest `at` among all heads goes anyway, so the order is total.
    """
    tails = sorted(tail for tail, entries in entries_by_tail.items() if entries)
    cited = {
        hash_
        for tail in tails
        for entry in entries_by_tail[tail]
        for hash_ in _after(entry)
    }
    where: dict[str, list[tuple[str, int]]] = {}
    if cited:
        for tail in tails:
            for position, entry in enumerate(entries_by_tail[tail]):
                if entry.stored_hash in cited:
                    where.setdefault(entry.stored_hash, []).append((tail, position))
    waits: dict[tuple[str, int], list[tuple[str, int]]] = {}
    not_held: list[tuple[str, int, str]] = []
    held: list[tuple[str, int, str, int]] = []
    for tail in tails:
        for position, entry in enumerate(entries_by_tail[tail]):
            for hash_ in _after(entry):
                found = where.get(hash_)
                if found is None:
                    not_held.append((tail, entry.seq, hash_))
                    continue
                for cited_at in found:
                    waits.setdefault((tail, position), []).append(cited_at)
                    held.append((tail, position, cited_at[0], cited_at[1]))
    cursors = {tail: 0 for tail in tails}

    def ready(tail: str) -> bool:
        return all(
            cursors.get(other, len(entries_by_tail[other])) > position
            for other, position in waits.get((tail, cursors[tail]), [])
        )

    def first(candidates: list[str]) -> str | None:
        chosen: str | None = None
        for tail in candidates:  # already in tail-id order, so a tie keeps the smaller id
            if chosen is None or _at(entries_by_tail[tail][cursors[tail]]) < _at(
                entries_by_tail[chosen][cursors[chosen]]
            ):
                chosen = tail
        return chosen

    merged: list[tuple[str, Entry]] = []
    forced = 0
    while cursors:
        live = sorted(cursors)
        chosen = first([tail for tail in live if ready(tail)])
        if chosen is None:
            chosen = first(live)
            forced += 1
        assert chosen is not None  # noqa: S101 - the loop condition guarantees it
        merged.append((chosen, entries_by_tail[chosen][cursors[chosen]]))
        cursors[chosen] += 1
        if cursors[chosen] >= len(entries_by_tail[chosen]):
            del cursors[chosen]

    behind: dict[tuple[str, int], int] = {}
    for tail, position, cited_tail, cited_position in held:
        citing = entries_by_tail[tail][position]
        cited_ms = _millis(_at(entries_by_tail[cited_tail][cited_position]))
        citing_ms = _millis(_at(citing))
        if cited_ms is None or citing_ms is None:
            continue
        gap = cited_ms - citing_ms
        if gap > 0:
            key = (tail, citing.seq)
            behind[key] = max(gap, behind.get(key, 0))
    return Merged(merged, not_held, [(t, s, g) for (t, s), g in behind.items()], forced)


class Merged(NamedTuple):
    """The order, and what it made of the citations: ignored ones, and clocks behind."""

    order: list[tuple[str, Entry]]
    # (tail, seq, hash) of every citation of an entry the record does not hold.
    not_held: list[tuple[str, int, str]]
    # (tail, seq, milliseconds) of every event stamped before an entry it cites.
    behind: list[tuple[str, int, int]]
    forced: int


def _after(entry: Entry) -> list[str]:
    value = entry.event.get("after")
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _millis(at: str) -> int | None:
    """An instant in section 4.1's one spelling, as milliseconds since the epoch."""
    try:
        moment = datetime.strptime(at, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    since = moment - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return since.days * 86_400_000 + since.seconds * 1000 + since.microseconds // 1000


def _at(entry: Entry) -> str:
    value = entry.event.get("at")
    return value if isinstance(value, str) else ""


def resolve(
    entries_by_tail: dict[str, list[Entry]],
    covered_through: dict[str, int],
    ring: dict[str, PublicKey],
) -> Resolution:
    """Fold the enrolment facts and answer every event whose signer was not authorized."""
    issues: list[Issue] = []
    # Section 6.5: the keys a covered declaration says are an anchor's backup.
    backups: dict[str, str] = {}
    valid: dict[str, set[str]] = {}
    # Keys a signature-covered revocation removed, as `<anchor>|<fp>`. An addition that
    # would restore one takes effect only when it is itself covered.
    covered_revoked: set[str] = set()
    # Keys enrolled as checkers: they sign check results and nothing else.
    checkers: set[str] = set()
    # Keys a covered checker.retired took out of the role: they sign nothing, ever again.
    retired: set[str] = set()
    # Keys enrolled as agents, each with (the anchor that enrolled it, its name). The role stays
    # with the key from its enrolment on, a key.revoked naming it included.
    agents: dict[str, tuple[str, str]] = {}
    # Agent keys a covered agent.retired took out: they sign nothing, ever again.
    retired_agents: set[str] = set()
    # (tail, seq, agent key or None, which) of every event that reached its kind's conditions,
    # so the census counts, after the fold, only the ones no issue names.
    judged: list[tuple[str, int, str | None, Any]] = []

    def keys_of(anchor: str) -> set[str]:
        return valid.setdefault(anchor, set())

    def in_any_identity(fp: Any) -> bool:
        return any(fp in keys for keys in valid.values())

    def is_covered(tail: str, seq: int) -> bool:
        return seq <= covered_through.get(tail, -1)

    def add_key(anchor: str, fp: str, tail: str, seq: int) -> bool:
        token = f"{anchor}|{fp}"
        if token in covered_revoked:
            if not is_covered(tail, seq):
                issues.append(
                    Issue(
                        tail,
                        seq,
                        f"re-adds {fp[:12]}... which a signature-covered revocation removed, "
                        "without being covered itself",
                    )
                )
                return False
            covered_revoked.discard(token)
        keys_of(anchor).add(fp)
        return True

    merged = _merged(entries_by_tail)
    for tail, entry in merged.order:
        event = entry.event
        seq = entry.seq
        kind = event.get("kind")
        who = event.get("who")
        subject = event.get("subject")
        signer = event.get("signerFp")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        is_result = kind in ("check.passed", "check.failed")
        if signer in retired:
            issues.append(Issue(tail, seq, f"{kind} is signed by a retired checker key, which signs nothing"))
            continue
        if signer in retired_agents:
            issues.append(Issue(tail, seq, f"{kind} is signed by a retired agent key, which signs nothing"))
            continue
        if not is_result and signer in checkers:
            issues.append(
                Issue(tail, seq, f"{kind} is signed by a checker key, which signs check results only")
            )
            continue
        # The agent's role, judged before the kind's own conditions: its facts speak for the
        # identity that enrolled it, under the name it was enrolled as - byte for byte, both
        # canonical - and never change who may sign.
        role = agents.get(signer) if isinstance(signer, str) else None
        which = event.get("which")
        if role is not None:
            role_anchor, role_name = role
            refusal = None
            if who != role_anchor:
                refusal = "for an identity other than the one that enrolled it"
            elif which != role_name:
                refusal = "and its which is not the name the key was enrolled under"
            elif kind in AGENT_NEVER_SIGNS:
                refusal = "which signs no change to who may sign or what a key may sign"
            if refusal is not None:
                issues.append(Issue(tail, seq, f"{kind} is signed by an agent key, {refusal}"))
                continue
        judged.append((tail, seq, signer if role is not None else None, which))

        if kind == "agent.enrolled":
            anchor = subject
            agent = payload.get("agentFp")
            name = payload.get("name")
            if who != anchor or not isinstance(anchor, str):
                issues.append(Issue(tail, seq, "agent.enrolled who is not the anchor it enrols into"))
                continue
            if signer not in keys_of(anchor):
                issues.append(
                    Issue(tail, seq, "agent.enrolled is signed by a key not valid for the anchor at this point")
                )
                continue
            # Section 6.2's set, written out - not str.strip(), which takes U+001C..U+001F too.
            if not isinstance(name, str) or name != name.strip(IDENTITY_TRIM):
                issues.append(
                    Issue(tail, seq, "agent.enrolled name begins or ends with a character of section 6.2's set")
                )
                continue
            if name == who:
                issues.append(Issue(tail, seq, "agent.enrolled name is its who"))
                continue
            if (
                not isinstance(agent, str)
                or in_any_identity(agent)
                or agent in checkers
                or agent in agents
                or agent in retired
                or agent in retired_agents
            ):
                issues.append(
                    Issue(tail, seq, "agent.enrolled names a key already in an identity, or holds a role")
                )
                continue
            if not _consent_ok(ring, agent_message(anchor, agent, name), agent, payload.get("reverseSig")):
                issues.append(
                    Issue(tail, seq, "agent.enrolled reverse signature does not prove the agent consented to this name")
                )
                continue
            if add_key(anchor, agent, tail, seq):
                agents[agent] = (anchor, name)
            continue

        if kind == "agent.retired":
            anchor = subject
            agent = payload.get("agentFp")
            if who != anchor or not isinstance(anchor, str):
                issues.append(Issue(tail, seq, "agent.retired who is not the anchor it retires from"))
                continue
            if signer not in keys_of(anchor):
                issues.append(
                    Issue(tail, seq, "agent.retired is signed by a key not valid for the anchor at this point")
                )
                continue
            if not isinstance(agent, str) or agents.get(agent, ("", ""))[0] != anchor:
                issues.append(
                    Issue(tail, seq, "agent.retired names a key that is not an agent key of its identity")
                )
                continue
            # The revocation's gate: an uncovered retirement is ignored rather than honoured.
            if not is_covered(tail, seq):
                continue
            keys_of(anchor).discard(agent)
            retired_agents.add(agent)
            continue

        if kind == "checker.enrolled":
            checker = payload.get("checkerFp")
            if not isinstance(checker, str) or subject != anchor_of(checker):
                issues.append(
                    Issue(tail, seq, "checker.enrolled subject is not the anchor its checker key derives")
                )
                continue
            if not isinstance(who, str) or signer not in keys_of(who):
                issues.append(
                    Issue(tail, seq, "checker.enrolled is signed by a key not valid for its who at this point")
                )
                continue
            if not _consent_ok(ring, checker_message(who, checker), checker, payload.get("reverseSig")):
                issues.append(
                    Issue(tail, seq, "checker.enrolled reverse signature does not prove the checker consented")
                )
                continue
            if checker in retired or checker in retired_agents:
                issues.append(
                    Issue(tail, seq, "checker.enrolled names a retired checker key, which is never enrolled again")
                )
                continue
            checkers.add(checker)
            continue

        if kind == "checker.retired":
            checker = payload.get("checkerFp")
            if not isinstance(checker, str) or subject != anchor_of(checker):
                issues.append(
                    Issue(tail, seq, "checker.retired subject is not the anchor its checker key derives")
                )
                continue
            if not isinstance(who, str) or signer not in keys_of(who):
                issues.append(
                    Issue(tail, seq, "checker.retired is signed by a key not valid for its who at this point")
                )
                continue
            # The revocation's gate: it refuses the key's LATER results, so an uncovered one,
            # which a keyless party could have appended, is ignored rather than honoured.
            if not is_covered(tail, seq):
                continue
            checkers.discard(checker)
            retired.add(checker)
            continue

        if is_result:
            if signer not in checkers:
                issues.append(
                    Issue(tail, seq, f"{kind} is signed by a key not enrolled as a checker at this point")
                )
                continue
            if not isinstance(signer, str) or who != anchor_of(signer):
                issues.append(Issue(tail, seq, f"{kind} who is not the anchor of the checker key that signed it"))
            continue

        if kind == "identity.founded":
            founding = payload.get("foundingFp")
            if signer != founding:
                issues.append(Issue(tail, seq, "identity.founded is not self-signed by its founding key"))
                continue
            if not isinstance(founding, str) or subject != anchor_of(founding):
                issues.append(
                    Issue(tail, seq, "identity.founded subject is not the anchor its founding key derives")
                )
                continue
            if who != subject:
                issues.append(Issue(tail, seq, "identity.founded who is not the anchor it founds"))
                continue
            add_key(str(subject), founding, tail, seq)
            continue

        if kind == "key.enrolled":
            anchor = subject
            new_fp = payload.get("newFp")
            reverse = payload.get("reverseSig")
            if who != anchor or not isinstance(anchor, str):
                issues.append(Issue(tail, seq, "key.enrolled who is not the anchor it enrolls into"))
                continue
            if signer not in keys_of(anchor):
                issues.append(
                    Issue(tail, seq, "key.enrolled is signed by a key not valid for the anchor at this point")
                )
                continue
            if not _reverse_signature_ok(ring, anchor, new_fp, reverse):
                issues.append(
                    Issue(tail, seq, "key.enrolled reverse signature does not prove possession of the new key")
                )
                continue
            add_key(anchor, str(new_fp), tail, seq)
            continue

        if kind == "backup.declared":
            anchor = subject
            backup = payload.get("backupFp")
            if who != anchor or not isinstance(anchor, str):
                issues.append(Issue(tail, seq, "backup.declared who is not the anchor it declares for"))
                continue
            if signer not in keys_of(anchor):
                issues.append(
                    Issue(tail, seq, "backup.declared is signed by a key not valid for the anchor at this point")
                )
                continue
            if not isinstance(backup, str) or backup not in keys_of(anchor):
                issues.append(
                    Issue(
                        tail,
                        seq,
                        "backup.declared names a key that is not a member of its identity at this point",
                    )
                )
                continue
            # Section 6.5's gate: the declaration quiets the warning a removed tail raises, so an
            # uncovered one, which a keyless party could have appended, is ignored.
            if not is_covered(tail, seq):
                continue
            backups[backup] = anchor
            continue

        if kind == "key.revoked":
            anchor = subject
            if who != anchor or not isinstance(anchor, str):
                issues.append(Issue(tail, seq, "key.revoked who is not the anchor it revokes from"))
                continue
            if signer not in keys_of(anchor):
                issues.append(
                    Issue(tail, seq, "key.revoked is signed by a key not valid for the anchor at this point")
                )
                continue
            # Section 6.2's gate: a revocation removes a key that judges OTHER, possibly
            # checkpointed events, so an uncovered one is ignored rather than honoured.
            if not is_covered(tail, seq):
                continue
            revoked = payload.get("revokedFp")
            # Section 4 refuses a key.revoked with no string revokedFp; if one got here anyway,
            # discarding None removes nothing.
            keys_of(anchor).discard(revoked)  # type: ignore[arg-type]
            covered_revoked.add(f"{anchor}|{revoked}")
            continue

        if not isinstance(who, str) or signer not in keys_of(who):
            issues.append(
                Issue(
                    tail,
                    seq,
                    f"the signer {str(signer)[:12]}... is not a key enrolled for "
                    f"{str(who)[:20]}... at this point",
                )
            )
    # What the accepted facts name as their agent: an event some issue names was refused, and a
    # refused fact names nobody.
    refused = {(issue.tail, issue.seq) for issue in issues}
    attested: dict[str, int] = {}
    declared: dict[str, int] = {}
    for tail, seq, agent_key, which in judged:
        if (tail, seq) in refused:
            continue
        if agent_key is not None:
            attested[agent_key] = attested.get(agent_key, 0) + 1
        elif isinstance(which, str):
            declared[which] = declared.get(which, 0) + 1
    return Resolution(
        issues,
        valid,
        backups,
        merged.not_held,
        merged.behind,
        [(fp, agents[fp][0], agents[fp][1], count) for fp, count in attested.items()],
        list(declared.items()),
    )


def _reverse_signature_ok(
    ring: dict[str, PublicKey], anchor: str, new_fp: Any, reverse: Any
) -> bool:
    """The new key's own proof of possession, checked against the key `newFp` NAMES.

    The keyring is indexed by RECOMPUTED fingerprint (section 6), so looking the key up by
    `newFp` here is what stops a member enrolling a key it does not hold and then swapping
    the committed file for one whose signature they can make.
    """
    if not isinstance(new_fp, str):
        return False
    return _consent_ok(ring, enrolment_message(anchor, new_fp), new_fp, reverse)


def _consent_ok(ring: dict[str, PublicKey], message: bytes, fp: Any, reverse: Any) -> bool:
    """A key's proof of possession over `message`, under the committed key `fp` names."""
    if not isinstance(fp, str) or not isinstance(reverse, str):
        return False
    key = ring.get(fp)
    if key is None:
        return False
    try:
        signature = bytes.fromhex(reverse)
    except ValueError:
        return False
    return ed25519_verify(key.raw, signature, message)
