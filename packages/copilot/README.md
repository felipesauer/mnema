# @mnema/copilot

The layer of [mnema](https://github.com/felipesauer/mnema) that guides an agent
by reading the proof: read-only derivations that turn the recorded work into the
context an agent needs — where a person left off, what they may do next, whether
a move is allowed.

This package sits ABOVE the domain. It depends on `@mnema/core` (its projections
and its workflow gate) and never the other way around. Its defining property is
that it only READS and COMPOSES: it never emits an event, never writes state,
never decides a fact. Everything here is a view of what the chain already proves,
so if two clones ever disagreed about it, the chain is the one that decides.

## What it gives you

- **`bootstrap`** — the opening context for a session, focused on one actor:
  where they left off (their latest run and open focus) plus the actionable work,
  freshest first, each task carrying the moves the workflow allows on it.
- **`focus` / `resume`** — what an actor is touching now (their open runs) and
  where they left off (their most recent run, open or ended, with its goal).
- **`nextActions`** — from a task's state, the moves the workflow allows next,
  read straight from the transition table (a terminal state yields none).
- **`guard`** — the workflow gate asked as a question: "may I do this move, and
  if not, why?" — the gate's own typed verdict, returned without writing anything.

## What it guarantees — and what it does not

The proof lives one layer down, in `@mnema/core` and the chain beneath it. This
layer makes no proof of its own; being clear about that is the point.

- **Everything here is a derivation, never a fact.** These functions read the
  projected state and compose it. Nothing they return is recorded, and nothing
  they do changes the record. The strength of what you read is exactly the
  strength the chain's `verify` reports for the events behind it — a derivation
  cannot make a weakly-signed fact any stronger.
- **`guard` decides nothing new.** It calls the core's gate and returns its
  verdict unchanged. It is a read-only question, not an enforcement point: it
  does not intercept or block an action, because there is no action here to stop
  — only an answer. The authorization rule lives in one place, the gate, and this
  layer never re-implements or relaxes it.
- **An honest limit on "the actor's work".** A run records the identity that
  authorized it, so an actor's runs are known. A task's projected state does not
  carry that identity, so the tasks an actor is working cannot yet be attributed
  to them. `focus` therefore scopes to the actor's runs, and `bootstrap`'s work
  list is workspace-wide, not the actor's own. When a later version ties a task
  to the actor, those views narrow with no change to their shape.

## Install

```sh
pnpm add @mnema/copilot
```

Requires Node ≥ 20. The package is ESM-only.

## Usage

Given a rebuilt `ProjectionCache` over your chain (see `@mnema/core`), read the
opening context for an actor and ask whether a move is allowed:

```ts
import { bootstrap, guard } from '@mnema/copilot';

// Where did I leave off, and what can I do next?
const opening = bootstrap(cache, { actor: 'alice' });
const lastGoal = opening.resume.lastRun?.goal; // "ship the parser"
const firstJob = opening.work[0]; // the freshest actionable task
const moves = firstJob?.actions.map((a) => a.action); // e.g. ["block", "complete", ...]

// Before asking to move a task, is the move even allowed?
const verdict = guard({
  from: 'IN_PROGRESS',
  action: 'complete',
  who: 'alice',
  which: 'claude',
});
// verdict.ok === false, verdict.code === "MISSING_PROOF" (complete needs a note)
```

Every function here takes the actor (or the move) as a parameter and reads the
cache — none of them resolve "who am I" or touch a writer. That is the surface's
job, not a derivation's.

## The modules

- **`context/`** — the session context derivations: `bootstrap` (the opening
  read), `focus`/`resume` (an actor's current and last work), and `next-action`
  (the moves a state allows).
- **`guard/`** — `guard`, the workflow gate exposed as a read-only consultation.

To understand the boundary that justifies this being a package of its own, read
`boundaries.test.ts`: it fails the moment the source references anything that
writes.

## License

See the repository root.
