/**
 * `mnema guard <action> <id>` — a DRY-RUN of the workflow gate: "would this move
 * be allowed on this task, and if not, why?" — asked, never done.
 *
 * The fourth read on the surface, and the sibling of `task move`: it takes the
 * SAME action and id and simulates exactly what a move would decide, having
 * written nothing. Read-only in the strict sense the boundary means it: it opens
 * the projection cache, rebuilds, reads the task's current state, and calls the
 * copilot's PURE `guard` (which delegates to the core's gate) — no writer, no
 * event, no key minted. The verdict is the gate's own, so a guard that says
 * ALLOWED and a `task move` that succeeds can never drift: they consult the same
 * function on the same inputs.
 *
 * WHY IT RESOLVES THE `from` ITSELF. The gate takes the task's current state as
 * `from`, but a person asking "can I approve task X?" neither knows nor should
 * type that state. So the surface resolves it the way `next-actions` does: it
 * locates the task's home tree ({@link locateEntityScope}), opens that tree's
 * cache, and reads `getTask(id).state`. That is projection reading plus a pure
 * derivation, not domain logic — the transition table stays the gate's. An id no
 * visible tree holds is `UNKNOWN_TASK`; with no project at all, `NO_PROJECT`.
 *
 * WHY THE ACTOR IS EXPLICIT. Like every actor-bearing read on this surface,
 * guard needs a `who` and the CLI has no session to read one from. Deriving the
 * machine's `who` would touch key material (minting a key on a fresh machine),
 * which is a write and domain logic the surface must not own. So `--actor` is a
 * required flag: passing it keeps the read truly read-only, and it doubles as
 * the `who` the gate checks against `--which` (an agent asking on a human's
 * behalf simulates the who != which invariant).
 *
 * WHY IT SIMULATES THE PROOF. The dry-run must be FAITHFUL to what a move would
 * decide, so it accepts the same optional proof flags a move does (`--note`,
 * `--reason`, `--feedback`) and the same `--which`. With the required proof it
 * comes back ALLOWED; without it, REFUSED (MISSING_PROOF) — which is a USEFUL
 * answer ("the move is legal, you are just missing the note"), not a failure.
 */

import { catalogUpcasters, type TransitionFields } from '@mnema/chain';
import { type GateResult, guard } from '@mnema/copilot';
import {
  chainRootForScope,
  type DiscoveryEnv,
  locateEntityScope,
  ProjectionCache,
  resolveTrees,
} from '@mnema/core';

/** What the guard command needs — injected so it is testable. */
export interface GuardContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The proof a caller may simulate for a move — the surface's view of the fields. */
export interface GuardProof {
  /** Why a task was canceled, blocked, or reopened. */
  readonly reason?: string;
  /** What was done when completing or approving. */
  readonly note?: string;
  /** What must change when review is not approved. */
  readonly feedback?: string;
}

/** The gate rendered its verdict — ALLOWED or a typed refusal (the gate's own). */
export interface GuardVerdict {
  readonly ok: true;
  /** The gate's verdict, faithful — the same object a real move would act on. */
  readonly verdict: GateResult;
}

/** The dry-run could not be attempted — the task or project was not found. */
export type GuardRefused =
  /** There is no project here — a task read needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** No visible tree holds a task with this id. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_TASK' };

/**
 * Simulates the gate for a move on the task with `id` and returns its verdict
 * unchanged. Locates the task's home tree, opens that tree's cache, rebuilds,
 * reads the task's current state as the `from`, and calls the copilot's pure
 * `guard`. An ALLOWED verdict names the state the move would reach; a REFUSED one
 * carries the gate's own code and message (ILLEGAL_TRANSITION, MISSING_PROOF,
 * WHO_IS_WHICH, …) — the same answer a real `task move` would give. Read-only:
 * no writer, no event. With no project it refuses `NO_PROJECT`; with a project
 * but no tree holding the task, `UNKNOWN_TASK`.
 */
export function runGuard(
  ctx: GuardContext,
  input: { id: string; action: string; actor: string; proof?: GuardProof; which?: string },
): GuardVerdict | GuardRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // A task read needs a project, exactly as `next-actions` reasons: with no
  // project at all, the honest answer is NO_PROJECT (run `init` first), not a
  // hollow UNKNOWN_TASK.
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const upcasters = catalogUpcasters();
  // Find the task's home tree the same way a move does — a task lives in exactly
  // one tree, and its state must be read from there.
  const scope = locateEntityScope(trees, input.id, upcasters);
  if (scope === undefined) {
    return { ok: false, reason: 'UNKNOWN_TASK' };
  }
  const root = chainRootForScope(trees, scope) as string;
  const cache = ProjectionCache.open(root, { upcasters });
  cache.rebuild();
  const task = cache.getTask(input.id);
  // `locateEntityScope` found a birth, so a null here means the tail is truncated
  // below it (the birth is not replayable) — report it as unknown rather than
  // simulating a move from a state we cannot read.
  if (task === null) {
    return { ok: false, reason: 'UNKNOWN_TASK' };
  }
  const fields = proofToFields(input.proof);
  const verdict = guard({
    from: task.state,
    action: input.action,
    who: input.actor,
    ...(fields !== undefined ? { fields } : {}),
    ...(input.which !== undefined ? { which: input.which } : {}),
  });
  return { ok: true, verdict };
}

/**
 * Builds the chain's proof fields from the flags a caller supplied, dropping any
 * that were absent. Returns undefined when none were given, so a simulated move
 * that needs no proof carries no `fields` — the gate then requires nothing. Only
 * the three textual proof fields the gate can ever require are surfaced; this is
 * the same shape `task move` forwards, so the dry-run and the real move see the
 * identical request.
 */
function proofToFields(proof: GuardProof | undefined): TransitionFields | undefined {
  if (proof === undefined) return undefined;
  const fields: { reason?: string; note?: string; feedback?: string } = {};
  if (proof.reason !== undefined) fields.reason = proof.reason;
  if (proof.note !== undefined) fields.note = proof.note;
  if (proof.feedback !== undefined) fields.feedback = proof.feedback;
  return Object.keys(fields).length > 0 ? fields : undefined;
}
