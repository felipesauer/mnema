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

- **A typed event catalog** — a closed, versioned discriminated union of events
  (`task.created`, `task.transitioned`, `run.started`, `run.ended`), with
  deterministic canonicalization (event → bytes) and per-kind upcasters so the
  catalog can grow without rewriting the past.
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
| **Truncating a tail** — dropping the newest events off the end | Partly local. Checkpoints are chained, so dropping an *earlier* checkpoint while keeping a later one breaks the link and is caught (the later one's `prev` no longer resolves). But truncating off the *end* — dropping the last checkpoint and the events above it — leaves a shorter, internally consistent chain that verifies green: the hash chain cannot see events that are no longer there. `verify` already declares the window above the last checkpoint as unsigned (`fullySigned: false`, `uncheckpointedEvents`); end-truncation shrinks that window rather than tripping a break, so it is the residual an external witness closes. *(A future direction: a consumer can seal a checkpoint at a meaningful boundary — the end of a run, a batch — so the residual at the points that matter is empty.)* |
| **Deleting a whole tail** | Partly local. A committed public key is written before its machine's first event and names its tail, so deleting the tail while leaving the key shows up: `verify` crosses `keys/` against the tails present and flags the orphaned key — a signal to look, not a verdict (a key can also outlive its tail innocently). Deleting the tail *and* its key together leaves nothing on disk to cross — only an external witness sees the files that were removed. |
| **Trusting the signing key's origin** | **Not covered by local crypto.** The fingerprint binding proves *self-consistency* — the key that signed is the one committed — not a tie to any outside identity. Someone who rewrites everything, mints a fresh key, re-signs, and publishes the new public key passes green. The anchor that closes this is the key's provenance in an external witness: a committed public key has a history there. |
| **Ordering across tails** | Within one tail, ordering is unforgeable — the hash chain fixes it. Across tails, a merged timeline is deterministic but *conventional*: it is not a trusted clock, and each event's `at` is self-declared. An aggregated timeline is a weaker guarantee than the per-tail chain, and reads only as strong as the honesty of the machines that wrote it. |

`verify` reflects all of this. Its `ok` means *nothing verifiable is broken* —
the hash chain holds and every signature checks out. It does **not** mean every
event is signed: events written after the last checkpoint rest on the hash chain
alone, and `verify` reports that separately (`fullySigned`). Nor does it mean
nothing was removed: an orphaned key surfaces as a census note (informational,
never a failure), but a deletion that erased its own traces does not. Read the
result honestly and it never overstates the guarantee.

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

Requires Node ≥ 20. The package is ESM-only.

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
console.log(result.ok, result.fullySigned, result.summary);
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
  (`store.ts`), and the verifier (`verify.ts`).

The source is documented at the level of *why*; if you are auditing the proof,
reading `hash.ts` and `verify.ts` is the place to start.

## License

See the repository root.
