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

The record faces four distinct threats. Being precise about which are covered is
the whole job of an honest proof engine:

| Threat | Covered by |
|---|---|
| **Accidental corruption** — a truncated write, a flipped byte | The hash chain — keyless, always on. |
| **An edit made *without* the signing key** | Ed25519 checkpoints over a content-recomputed root. Editing content and re-chaining the keyless hashes is still caught, because the signed root folds the actual event bytes. |
| **An outside audit with only what was committed** — no secrets | The public key is committed by fingerprint; verification re-derives that fingerprint from the key it loads, so swapping the committed key for another is caught. |
| **An edit made *with* the signing key** | **Not covered by local crypto.** A key holder can rewrite and re-sign. Detecting that needs an external witness — a git remote, an anchor — a seam this package leaves open, never a guarantee it fakes. |

`verify` reflects this exactly. Its `ok` means *nothing verifiable is broken* — the
hash chain holds and every signature checks out. It does **not** mean every event is
signed: events written after the last checkpoint rest on the hash chain alone, and
`verify` reports that separately (`fullySigned`) rather than dressing it up as more
than it is. Read the result honestly and it never overstates the guarantee.

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
