# @mnema/chain

The proof engine at the core of [mnema](https://github.com/felipesauer/mnema): a
tamper-evident, append-only event log for the work of AI agents. It records what
happened as typed, self-contained events, chains them so nothing can be silently
altered, and lets anyone verify the record — with or without the private key that
signed it.

This package is the part that carries the proof, so it is deliberately small: it
has **zero runtime dependencies** and knows nothing about databases, projections,
or the surfaces built on top of it. That isolation is the point — the code you
have to trust for tamper-evidence is auditable on its own.

## What it gives you

- **A typed event catalog** — a closed, versioned discriminated union of every
  fact the chain may hold, with deterministic canonicalization (event → bytes) and
  per-kind upcasters so the catalog can grow without rewriting the past. This
  line used to list four kinds by name (`task.created`, `task.transitioned`,
  `run.started`, `run.ended`); the catalog holds twenty, and a list in prose is a
  list that stops being true. `canonical-vectors.json` carries one frozen event
  per kind and is total over the catalog by type, so it is the list that cannot
  fall behind.
- **An append-only chain** — each machine writes its own tail (a JSONL file);
  entries are hash-chained so a changed or reordered event breaks the chain.
- **Signed checkpoints** — an Ed25519 signature over a root recomputed from the
  event *content*, taken every so many events and chained to the previous one.
- **A verifier** — reads every tail, checks the hash chain and the signatures,
  and reports honestly what is proven and what is not.

## What it proves — and what it does not

Being precise about which threats are covered is the whole job of an honest
proof engine. Two categories, kept apart because the guarantees differ.

**Altering what is there.** The local crypto covers this, and covers it without
any secret at verify time:

| Threat | Covered by |
|---|---|
| **Accidental corruption** — a truncated write, a flipped byte | The hash chain — keyless, always on. |
| **An edit made *without* the signing key** | Ed25519 checkpoints over a content-recomputed root. Editing content and re-chaining the keyless hashes is still caught, because the signed root folds the actual event bytes. |
| **An outside audit with only what was committed** — no secrets | The public key is committed by fingerprint; verification re-derives that fingerprint from the key it loads, so swapping the committed key for another is caught. |
| **An edit made *with* the signing key** | **Not covered by local crypto.** A key holder can rewrite and re-sign. Detecting that needs an external witness — a git remote, an anchor — a seam this package leaves open, never a guarantee it fakes. |

**Removing what was there, and trusting who signed.** A hash chain proves
nothing was *changed*; it cannot prove nothing was *deleted*, and it proves the
record is self-consistent, not that it is bound to any outside identity. These
are the honest gaps, and the same external witness closes them:

| Threat | Covered by |
|---|---|
| **Truncating a tail** — dropping the newest events off the end | Partly local. Checkpoints are chained, so dropping an *earlier* checkpoint while keeping a later one breaks the link and is caught (the later one's `prev` no longer resolves). But truncating off the *end* — dropping the last checkpoint and the events above it — leaves a shorter, internally consistent chain that verifies green: the hash chain cannot see events that are no longer there. `verify` already declares the window above the last checkpoint as unsigned (`fullySigned: false`, `uncheckpointedEvents`); end-truncation shrinks that window rather than tripping a break, so it is the residual an external witness closes. The verdict now NAMES how far it got: a shortened chain with some coverage left reads `verified (T1/T2/T4) up to the last checkpoint`, and one whose checkpoints went with the events reads `verified (T1 only) — no signature was checked`. It used to read `verified (T1/T2/T4)` in both cases, which was the sentence claiming a layer that had not run. *(A future direction: a consumer can seal a checkpoint at a meaningful boundary — the end of a run, a batch — so the residual at the points that matter is empty.)* |
| **Deleting a whole tail** | Partly local. A committed public key is written before its machine's first event and names its tail, so deleting the tail while leaving the key shows up: `verify` crosses `keys/` against the tails present and flags the orphaned key — a signal to look, not a verdict (a key can also outlive its tail innocently). What that signal could not say, until `tail.pruned` existed, is *which* of its three readings applied. A waiver written **before** the cut — while the tail is still there, so its head hash and event count are checked against the disk — makes the note name the account instead: who authorized it, how many events, through which head. It answers the third reading only; a merge that dropped a tail and a machine that never wrote produce no waiver and read exactly as they always did. Deleting the tail *and* its key together still leaves nothing on disk to cross — only an external witness sees the files that were removed. |
| **Trusting the signing key's origin** | **Not covered by local crypto.** The fingerprint binding proves *self-consistency* — the key that signed is the one committed — not a tie to any outside identity. Someone who rewrites everything, mints a fresh key, re-signs, and publishes the new public key passes green. The anchor that closes this is the key's provenance in an external witness: a committed public key has a history there. |
| **Ordering across tails** | Within one tail, ordering is unforgeable — the hash chain fixes it. Across tails, a merged timeline is deterministic but *conventional*: it is not a trusted clock, and each event's `at` is self-declared. An aggregated timeline is a weaker guarantee than the per-tail chain, and reads only as strong as the honesty of the machines that wrote it. |

`verify` reflects all of this. Its `ok` means *nothing verifiable is broken* —
the hash chain holds and every signature it found checks out. It does **not**
mean every event is signed: events written after the last checkpoint rest on the
hash chain alone, and `verify` reports that separately (`fullySigned`). Nor does
it mean nothing was removed: an orphaned key surfaces as a census note
(informational, never a failure), but a deletion that erased its own traces does
not. A cut that was **authorized in advance** is the one case the note can now
explain rather than merely flag — and a waiver is neither permission (anyone who
can write can sign one; it records who did) nor a cure (a tail that is present and
broken keeps every issue it had). It never touches `ok`, and it covers a whole tail
only: cutting *part* of one produces the seq gap and the checkpoint cascade it
always did.

Reading two fields and adding them up is what nobody should have to do, so the
result also carries the **level** it reached (`level`), and the one-line
`summary` is worded from it: `unreadable`, `broken`, `hash-chain-only`
(nothing signed was checked), `signed-through-last-checkpoint`, `fully-signed`.
A caller that wants a gate compares it with `meetsRequirement(level,
'chained' | 'signed' | 'witnessed')` rather than re-deriving the meaning.

The same verdict is handed over as the **clauses** it is made of (`clauses`), each
saying which part of the verdict it is — the level, the tail count, what the events
rest on, a census note, the external witness. It is there so a caller can show the
parts apart (a terminal paints the level's clause and dims the rest) without matching
text on a verdict, and `summary` is those clauses joined by the one function that
joins them, so no two readings of one verdict can disagree.

Every finding is **one line**, and that is part of what it means. An issue is
printed one per line under a count, and every value in one comes from the thing
under suspicion — a tail id is a directory name, a signer fingerprint is a field
of a stored entry, a reader's complaint quotes the bytes it choked on. A value
carrying a newline would put a second finding on the page about a tail nobody
has, so each of them is collapsed where the sentence is written. The rule is
published on its own at `@mnema/chain/one-line`, which imports nothing, because
the packages above word sentences of their own and a caller cannot apply a rule
to the inside of a sentence this package already joined.

The pattern is consistent: **local crypto covers alteration; an external
witness covers omission and ties the record to an identity.** That witness is
the last row of the first table — a git remote or an anchor — and committing
the chain to git is the recommended path for anyone who wants the strong
guarantee, because git both preserves the files that a deletion would remove and
gives the signing key a provenance the crypto alone cannot.

## Install

```sh
pnpm add @mnema/chain
```

Requires Node ≥ 22.12.0. The package is ESM-only.

## Usage

Open a chain for writing, append events, checkpoint, and verify:

```ts
import { openChainForWriting, taskBirth, verify } from '@mnema/chain';

// One writer owns this machine's tail. The signing key pair is loaded from the
// chain root, or created there on first use (the private key stays local).
const writer = openChainForWriting('.mnema/chain');

// A task's birth is two atomic events: it exists (task.created) and it has an
// initial state (task.transitioned from null). State lives only in transitions.
const envelope = {
  at: new Date().toISOString(),
  who: 'alice',        // the human who authorized the work — the root of authority
  which: 'claude',     // the agent that executed it
  subject: 'task-01',  // the entity this event is about
};
for (const event of taskBirth(envelope, { title: 'Ship the parser', initial: 'todo' })) {
  writer.append(event);
}

// Sign a checkpoint over everything appended so far.
writer.checkpoint();

// Anyone can verify the whole chain — aggregating every tail — from the root.
const result = verify('.mnema/chain');
console.log(result.level, result.ok, result.fullySigned, result.summary);
```

Verification needs no private key: it uses only the committed events and public
keys, which is what makes an outside audit possible.

## Layout on disk

Everything a chain needs lives under one root directory:

```
.mnema/chain/
  tails/<machine>/         one tail per machine — appends never collide
    <segment>.jsonl        the events, as sealed entries (size-segmented)
    checkpoints.jsonl      the signed checkpoints for this tail
  keys/<fingerprint>.pub   committed public keys, named by fingerprint
```

Only this tree is meant to be shared (committed to git, copied to a synced
folder). The private key is not part of it and must never be shared.

## The two halves of the package

- **`events/`** — the event core: the catalog (`catalog.ts`), the builders
  (`build.ts`), canonicalization (`canonical.ts`), parsing with a closed shape
  (`parse.ts`), and versioned upcasters (`upcaster.ts`, `registry.ts`).
- **`chain/`** — the log: the per-tail writer (`writer.ts`), the hash and content
  root (`hash.ts`), sealed entries (`entry.ts`), signed checkpoints
  (`checkpoint.ts`), keys and keystore (`keys.ts`, `keystore.ts`), tail storage
  (`store.ts`), how far a chain reaches on disk (`freshness.ts`), and the
  verifier (`verify.ts`).

The source is documented at the level of *why*; if you are auditing the proof,
reading `hash.ts` and `verify.ts` is the place to start.

## The format, written down

[`FORMAT.md`](./FORMAT.md) specifies the bytes: canonicalization, the framed
hashing, the entry hash, the stored line, the content root, and the signed
checkpoint. It is written for someone who did not write this code and wants to
implement a verifier from it — every claim in it names the test that holds it, and
the version tags in it are read out of the source by a guard.

`canonical-vectors.json` beside it is the machine-readable half: one frozen event
per catalog kind and the SHA-256 of its canonical bytes, plus the aggregate
digests. Canonicalize a row's `event`, hash the bytes, compare — that is the whole
check, and it needs nothing of ours.

What that does **not** buy is stated in the document itself, in the same terms as
the table above: it is not an open standard, there is no second implementation,
and publishing the format adds no external witness.

## License

See the repository root.
