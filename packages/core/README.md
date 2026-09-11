# @mnema/core

The work domain of [mnema](https://github.com/felipesauer/mnema), built on top of
[`@mnema/chain`](../chain). Where the chain holds the signed record of *what
happened*, core turns those events into something you can work with: the
projections that replay the chain into a queryable cache, the workflow and the
gate that decides which changes are allowed, and the identity layer that gives
an entity a human-facing name without that name ever becoming its identity.

The chain stays the source of truth. Core never invents state — every row it holds
is folded from events the chain already proved, and it can be thrown away and rebuilt
at any time.

## What it gives you

- **Projections** — pure folds from the ordered event stream into current state
  (tasks, runs, decisions), materialized into a SQLite **cache**. The projection
  functions are pure and testable without a database; persistence is a separate layer.
- **A workflow and a write-time gate** — a fixed, typed state machine for tasks and
  for decisions. The gate is the single point of enforcement: it runs *before* an
  event is written and only lets a change through if it is authorized, legal, and
  carries its required proof.
- **Identity** — `deriveAlias` (a short human-facing label like `t-3a9f`, derived
  from an id, never stored, and always shown beside it), and the canonical forms of a
  person (`canonicalIdentity`) and of an id (`canonicalId`) that keep what is
  validated equal to what is written.

## What it proves — and what it does not

Core proves nothing on its own: proof is the chain's job and core rests on it. What
it holds to is narrower than that, and each of these says where it stops:

| Property | What holds |
|---|---|
| **The cache is not the source** | Every projection is derived from the chain. `rebuild` drops the SQLite database and replays the chain into it; nothing is authored directly. A stale or deleted cache is never a loss — rebuild reproduces the exact same state. There are no data migrations: the schema is disposable. |
| **Projections replay, they do not re-judge** | A projection never re-validates a fact. The gate already decided, at write time, that the event was allowed; the projection trusts the recorded fact and only folds it. This is why replaying old events yields the state that *happened*, not one re-derived from today's rules. |
| **The gate enforces on write, not on read** | Authority (a human authorized it, and is not the agent that executed it), legality (the transition is one the workflow allows), and proof (the required fields are present) are checked before the event is appended. A read trusts what a write already gated. |
| **A human name is never an identity** | The alias and the citable `ADR-42` label are display only. The entity's identity is its id; a label can collide between offline clones and that is a signal to reconcile, never a broken record. The signal is `adrCollisions`, asked of ONE chain — the only unit the number is sequential in, since two trees each numbering their first decision `ADR-1` is the design working. |

What core does **not** do, beyond making no proof of its own: it does not talk to the
outside world (no MCP, no CLI); those are thin adapters built on top, in another
package. And it does not resolve *who wins* when two machines change the same entity
offline — the projection is deterministic, but the merge policy is a separate concern.

## Install

```sh
pnpm add @mnema/core
```

Requires Node ≥ 22.12.0. ESM-only. Depends on `@mnema/chain` and `better-sqlite3`.

## Usage

Record work through the gate, then read it back from the cache:

```ts
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { ProjectionCache } from '@mnema/core';
import { createTask, transitionTask } from '@mnema/core/write';

// The chain is committed and shared; the private key is not, so the two roots are separate.
const root = '.mnema/chain';
const keyRoot = '/a/path/outside/the/repository';

// A write reads state from the chain and appends to it; the context names both.
const writer = openChainForWriting(root, { keyRoot });
const ctx = { writer, layout: { root }, upcasters: catalogUpcasters() };

// Create a task and move it — each write runs the gate first. The caller supplies
// neither the id nor the author. The id is MINTED here, from randomness, so two
// offline clones never mint the same one; `who` is derived from the writing key,
// so authorship cannot be forged by typing a name. `which` — the agent that
// carried the work out — IS the caller's, because an agent has no key.
const created = createTask(ctx, { title: 'Ship the parser', which: 'claude' });
if (created.ok) {
  // DRAFT → READY: `submit` requires no proof fields, so none are needed. The id
  // to move with is the one the create handed back.
  transitionTask(ctx, { id: created.id, action: 'submit', which: 'claude' });
  // An action that carries proof supplies it — e.g. cancelling requires a reason:
  // transitionTask(ctx, { id: created.id, action: 'cancel', which: 'claude',
  //   fields: { reason: 'superseded by a new approach' } });
}

// Read state from the cache — rebuilt from the chain, never authored directly.
const cache = ProjectionCache.open(root);
cache.rebuild();
const task = created.ok ? cache.getTask(created.id) : null;
// task is { id, title, state: 'READY', … }, or null for an id nothing created.
```

A refused write (unauthorized, illegal transition, or missing proof) returns a typed
error and appends nothing — the chain never records a change the gate rejected.

## The three capabilities

- **`projections/`** — the pure folds (`projectTasks`, `projectRuns`, `projectDecisions`)
  and their SQLite materialization; `orderedEvents` (the deterministic k-way merge of
  all tails), `rebuild` (drop-and-replay), and the `ProjectionCache` facade.
- **`workflow/`** — the typed states and transitions for tasks and decisions, the pure
  gates (`gate`, `decisionGate`), and the gated write operations (`createTask`/
  `transitionTask`, `recordDecision`/`acceptDecision`/`rejectDecision`/`supersedeDecision`).
- **`identity/`** — `deriveAlias` (the display label) and
  `canonicalIdentity`/`canonicalId` (the canonical forms that keep validate and write
  in agreement).

The source is documented at the level of *why*; the gate and the projections are the
places where the design's rules live.

## License

See the repository root.
